import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrdersService } from '../orders/orders.service';
import { InventoryService } from '../inventory/inventory.service';
import type {
  CreateProblemDto,
  ResolveProblemDto,
} from './dto/shipping.dto';

/**
 * M7c problem items: any workflow stage can raise a problem; the reviewer
 * either cancels the order, restarts the original from packing, or copies a
 * new order and closes the original.
 */
@Injectable()
export class ProblemItemsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly orders: OrdersService,
    private readonly inventory: InventoryService,
  ) {}

  async report(orderId: string, dto: CreateProblemDto & { source?: 'work' | 'detail' }, userId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found.');
    if (order.stage === 'cancelled') {
      throw new ConflictException('Cancelled orders cannot raise a problem.');
    }
    const open = await this.prisma.problemItem.findFirst({
      where: { orderId, status: 'open' },
    });
    if (open) {
      throw new ConflictException('This order already has an open problem item.');
    }

    const now = new Date();
    const item = await this.prisma.problemItem.create({
      data: {
        orderId,
        stageAtReport: order.stage,
        type: dto.type,
        content: dto.content.trim(),
        source: dto.source ?? 'work',
        reportedBy: userId,
      },
    });
    await this.prisma.order.update({
      where: { id: orderId },
      data: {
        stage: 'problem',
        stageUpdatedAt: now,
        stageUpdatedBy: userId,
        version: { increment: 1 },
      },
    });
    await this.closePendingReviews(orderId, 'cancelled', userId, now);
    await this.event(
      orderId,
      order.stage,
      'problem',
      'problem_reported',
      userId,
      { type: dto.type, problemItemId: item.id },
      dto.content.trim(),
    );
    await this.audit.record({
      actorId: userId,
      action: 'problem.reported',
      objectType: 'ProblemItem',
      objectId: item.id,
      after: { orderId, type: dto.type, stage: order.stage },
    });
    return item;
  }

  async list() {
    const items = await this.prisma.problemItem.findMany({
      where: { status: 'open' },
      orderBy: { reportedAt: 'desc' },
      include: {
        order: {
          select: {
            id: true,
            displayNumber: true,
            stage: true,
            customerSnapshot: true,
            shippingRegion: { select: { id: true, name: true } },
          },
        },
      },
    });
    const reporterIds = [...new Set(items.map((item) => item.reportedBy))];
    const users = reporterIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: reporterIds } },
          select: { id: true, name: true },
        })
      : [];
    const names = new Map(users.map((user) => [user.id, user.name]));
    return items.map((item) => ({
      ...item,
      reportedByName: names.get(item.reportedBy) ?? null,
    }));
  }

  async resolve(id: string, dto: ResolveProblemDto, userId: string) {
    const item = await this.prisma.problemItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Problem item not found.');
    if (item.status !== 'open') {
      throw new ConflictException('This problem item is already resolved.');
    }
    const order = await this.prisma.order.findUnique({
      where: { id: item.orderId },
    });
    if (!order) throw new NotFoundException('Order not found.');

    const now = new Date();
    const note = dto.note?.trim() || null;
    let copiedOrderId: string | null = null;
    let status: string;

    if (dto.resolution === 'cancel') {
      await this.cancelOrder(order.id, userId, note ?? 'problem cancelled');
      status = 'cancelled';
      await this.event(order.id, 'problem', 'cancelled', 'problem_cancelled', userId, undefined, note ?? undefined);
    } else if (dto.resolution === 'restart') {
      const returnStage = dto.returnStage ?? 'packing';
      if (returnStage === 'packing' && order.stockDeductedAt) {
        await this.inventory.returnForOrder(order.id, userId, 'problem restart');
      }
      await this.prisma.order.update({
        where: { id: order.id },
        data: {
          stage: returnStage,
          ...(returnStage === 'packing' ? { fulfillmentStatus: null } : {}),
          stageUpdatedAt: now,
          stageUpdatedBy: userId,
          version: { increment: 1 },
        },
      });
      status = 'resolved_restart';
      await this.event(order.id, 'problem', returnStage, 'problem_restarted', userId, { returnStage }, note ?? undefined);
    } else {
      // Copy a new order, keep the region/category, and close the original.
      const copy = await this.orders.copyOrder(order.id, userId);
      copiedOrderId = copy.id;
      await this.prisma.order.update({
        where: { id: copy.id },
        data: {
          shippingRegionId: order.shippingRegionId,
          categoryId: order.categoryId,
          stage: 'packing',
          stageUpdatedAt: now,
          stageUpdatedBy: userId,
          version: { increment: 1 },
        },
      });
      await this.closePendingReviews(copy.id, 'auto_closed', userId, now);
      await this.event(
        copy.id,
        'review',
        'packing',
        'copied_from_problem',
        userId,
        { originalOrderId: order.id },
        note ?? undefined,
      );
      await this.cancelOrder(order.id, userId, 'transferred to copy');
      status = 'resolved_copied';
      await this.event(
        order.id,
        'problem',
        'cancelled',
        'problem_copied',
        userId,
        { copiedOrderId: copy.id },
        note ?? undefined,
      );
    }

    await this.prisma.problemItem.update({
      where: { id },
      data: {
        status,
        handledBy: userId,
        handledAt: now,
        resolutionNote: note,
        copiedOrderId,
      },
    });
    // The resolution note is recorded in the order notes section too.
    if (note?.trim()) {
      await this.prisma.note.create({
        data: {
          ownerType: 'order',
          ownerId: order.id,
          orderOwnerId: order.id,
          body: `[Problem] ${note.trim()}`,
          createdBy: userId,
        },
      });
    }
    await this.audit.record({
      actorId: userId,
      action: 'problem.resolved',
      objectType: 'ProblemItem',
      objectId: id,
      after: { status, resolution: dto.resolution, copiedOrderId },
    });
    return { ok: true, status, copiedOrderId };
  }

  private async cancelOrder(orderId: string, userId: string, reason: string) {
    const now = new Date();
    await this.prisma.order.update({
      where: { id: orderId },
      data: {
        cancelledAt: now,
        cancelledBy: userId,
        cancelledReason: reason,
        stage: 'cancelled',
        stageUpdatedAt: now,
        stageUpdatedBy: userId,
        version: { increment: 1 },
      },
    });
    await this.voidActiveShipments(orderId, userId, reason);
    await this.closePendingReviews(orderId, 'cancelled', userId, now);
  }

  private async voidActiveShipments(
    orderId: string,
    userId: string,
    reason: string,
  ) {
    await this.prisma.shipment.updateMany({
      where: { orderId, voidedAt: null },
      data: { voidedAt: new Date(), voidedBy: userId, voidReason: reason },
    });
  }

  private async closePendingReviews(
    orderId: string,
    status: string,
    userId: string,
    at: Date,
  ) {
    await this.prisma.reviewRecord.updateMany({
      where: { type: 'new_order', subjectId: orderId, status: 'pending' },
      data: { status, decidedBy: userId, decidedAt: at },
    });
  }

  private async event(
    orderId: string,
    fromStage: string,
    toStage: string,
    action: string,
    actorId: string,
    metadata?: Record<string, unknown>,
    note?: string,
  ) {
    await this.prisma.orderStageEvent.create({
      data: {
        orderId,
        fromStage,
        toStage,
        action,
        actorId,
        note: note?.trim() || null,
        ...(metadata
          ? { metadata: metadata as unknown as Prisma.InputJsonValue }
          : {}),
      },
    });
  }
}
