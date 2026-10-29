import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { requireOrderRegion, resolveOrderVariant } from '../orders/order-product-links';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { AuditService } from '../audit/audit.service';
import { ShipmentService } from './shipment.service';
import { OutboundExecutorService } from './outbound-executor.service';
import type {
  CreateAddOnDto,
  PackShipmentDto,
  ShipmentEntryDto,
  TailTrackingDto,
} from './dto/shipping.dto';

const queueOrderInclude = {
  shippingRegion: { select: { id: true, name: true, warehouse: true } },
  category: { select: { id: true, name: true } },
  lines: {
    orderBy: { createdAt: 'asc' as const },
    select: {
      id: true,
      title: true,
      quantity: true,
      itemVariant: { select: { itemCode: true, name: true } },
    },
  },
  notes: {
    orderBy: { createdAt: 'asc' as const },
    select: { body: true, createdAt: true },
  },
  addOns: {
    orderBy: { createdAt: 'asc' as const },
    include: { itemVariant: { select: { id: true, itemCode: true, name: true } } },
  },
} satisfies Prisma.OrderInclude;

const queueShipmentInclude = {
  carrier: { select: { id: true, key: true, name: true, crossBorder: true } },
} satisfies Prisma.ShipmentInclude;

@Injectable()
export class ShippingWorkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly shipments: ShipmentService,
    private readonly executor: OutboundExecutorService,
    private readonly inventory: InventoryService,
  ) {}

  /** Stage 1 queue: approved, unfulfilled orders waiting to be packed. */
  packingQueue() {
    return this.prisma.order.findMany({
      where: {
        stage: 'packing',
        deletedAt: null,
        archivedAt: null,
        cancelledAt: null,
      },
      orderBy: { createdAt: 'desc' },
      include: queueOrderInclude,
    });
  }

  /** Stage 2 queue: packed orders waiting for carrier + tracking. */
  async orderingQueue() {
    const orders = await this.prisma.order.findMany({
      where: {
        stage: 'ordering',
        deletedAt: null,
        archivedAt: null,
        cancelledAt: null,
      },
      orderBy: { createdAt: 'desc' },
      include: {
        ...queueOrderInclude,
        shipments: { where: { voidedAt: null }, include: queueShipmentInclude },
      },
    });
    return orders;
  }

  /** Stage 3 queue: tracking entered, waiting for spot-check. */
  async inspectionQueue() {
    const orders = await this.prisma.order.findMany({
      where: {
        stage: 'inspection',
        deletedAt: null,
        archivedAt: null,
        cancelledAt: null,
      },
      orderBy: { createdAt: 'desc' },
      include: {
        ...queueOrderInclude,
        shipments: { where: { voidedAt: null }, include: queueShipmentInclude },
      },
    });
    return orders;
  }

  /** Completed cross-border shipments still missing tail tracking. */
  async tailQueue() {
    const shipments = await this.prisma.shipment.findMany({
      where: {
        voidedAt: null,
        tailTrackingNumber: null,
        carrier: { crossBorder: true },
        order: { stage: 'completed' },
      },
      orderBy: { order: { createdAt: 'desc' } },
      include: {
        carrier: { select: { id: true, key: true, name: true } },
        order: {
          select: {
            id: true,
            displayNumber: true,
            customerSnapshot: true,
            shippingRegion: { select: { id: true, name: true, warehouse: true } },
          },
        },
      },
    });
    return shipments;
  }

  /** Packing second-confirmation data: order summary + stock deduction rows. */
  async packingPreview(orderId: string) {
    await this.requireStage(orderId, 'packing');
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        shippingRegion: { select: { id: true, name: true, warehouse: true } },
        notes: { orderBy: { createdAt: 'asc' }, select: { body: true } },
        lines: {
          include: { itemVariant: { include: { item: true, stocks: true } } },
        },
        addOns: {
          include: { itemVariant: { include: { item: true, stocks: true } } },
        },
      },
    });
    if (!order) throw new NotFoundException('Order not found.');
    const warehouse = order.shippingRegion?.warehouse ?? null;

    // Stock is tracked per product variant (catalog consolidation).
    const required = new Map<string, { title: string; qty: number }>();
    const collect = (
      variant: { id: string; name: string; item: { name: string } } | null,
      qty: number,
    ) => {
      if (!variant || qty <= 0) return;
      const current = required.get(variant.id);
      required.set(variant.id, {
        qty: (current?.qty ?? 0) + qty,
        title: current?.title ?? `${variant.item.name} / ${variant.name}`,
      });
    };
    for (const line of order.lines) {
      collect(line.itemVariant, line.quantity);
    }
    for (const addOn of order.addOns) {
      collect(addOn.itemVariant, addOn.quantity);
    }

    const ids = warehouse && warehouse.length > 0 ? [...required.keys()] : [];
    const variants = [...order.lines, ...order.addOns]
      .map((row) => row.itemVariant)
      .filter((variant): variant is NonNullable<typeof variant> => !!variant);
    const rows = ids.map((id) => {
      const variant = variants.find((v) => v.id === id);
      const stock = variant?.stocks.find((s) => s.warehouse === warehouse);
      const qty = required.get(id)!.qty;
      const current = stock?.quantity ?? 0;
      return {
        itemVariantId: id,
        title: required.get(id)!.title,
        warehouse,
        current,
        required: qty,
        after: current - qty,
        low: stock?.lowThreshold != null && stock.lowThreshold >= 0 && current - qty <= stock.lowThreshold,
      };
    });
    return {
      orderId,
      displayNumber: order.displayNumber,
      customer: order.customerSnapshot,
      region: order.shippingRegion?.name ?? null,
      lines: order.lines.map((line) => ({ title: line.title, quantity: line.quantity })),
      addOns: order.addOns.map((addOn) => ({ title: addOn.title, quantity: addOn.quantity })),
      reviewNotes: (order.notes ?? [])
        .filter((note) => note.body.startsWith('[Review] '))
        .map((note) => note.body.replace(/^\[Review\]\s*/, '')),
      warehouse,
      rows,
    };
  }

  /** Packing confirm: weight/dimensions create the shipment, stage -> ordering. */
  async pack(orderId: string, dto: PackShipmentDto, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.order.updateMany({
        where: { id: orderId, stage: 'packing', stockDeductedAt: null, cancelledAt: null, deletedAt: null, archivedAt: null },
        data: { stage: 'ordering', stageUpdatedAt: new Date(), stageUpdatedBy: userId, version: { increment: 1 } },
      });
      if (!claimed.count) throw new ConflictException('Order already handled or stock already deducted; refresh the queue.');
      const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { shippingRegion: true } });
      const warehouse = order.shippingRegion?.warehouse;
      if (!order.shippingRegion?.enabled || !warehouse || !['china', 'canada'].includes(warehouse)) {
        throw new ConflictException('The shipping region must be linked to a warehouse before packing.');
      }
      await this.inventory.deductForOrder(orderId, warehouse, userId, 'packing outbound', tx);
      const packed = await this.shipments.createPackedShipment(orderId, dto, userId, tx);
      await tx.orderStageEvent.create({ data: { orderId, fromStage: 'packing', toStage: 'ordering', action: 'packed', actorId: userId,
        note: dto.note?.trim() || null, metadata: { ...packed, shippingRegion: order.shippingRegion.name } } });
      if (dto.note?.trim()) await tx.note.create({ data: { ownerType: 'order', ownerId: orderId, orderOwnerId: orderId, body: `[Packing] ${dto.note.trim()}`, createdBy: userId } });
      await this.audit.record({ actorId: userId, action: 'order.stage.packed', objectType: 'Order', objectId: orderId,
        after: { fromStage: 'packing', toStage: 'ordering' } }, tx);
      return tx.order.findUniqueOrThrow({ where: { id: orderId }, include: queueOrderInclude });
    });
  }

  /** Adds a gift/extra item while the order is being packed. */
  async addAddOn(orderId: string, dto: CreateAddOnDto, userId: string) {
    return this.prisma.$transaction(async tx => {
        const claimed = await tx.order.updateMany({ where: { id: orderId, stage: 'packing', stockDeductedAt: null }, data: { version: { increment: 1 } } });
        if (!claimed.count) throw new ConflictException('Order is no longer available for gift edits.');
      const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
      const region = order.shippingRegionId ? await requireOrderRegion(tx, order.shippingRegionId) : null;
      if (!region) throw new ConflictException('Select a shipping warehouse first.');
      let title = dto.title.trim();
      if (dto.itemVariantId) {
        const { variant } = await resolveOrderVariant(tx, dto.itemVariantId, region.warehouse);
        if (!title) title = `${variant.item.name} / ${variant.name}`;
      }
      const addOn = await tx.orderAddOn.create({
        data: {
          orderId,
          itemVariantId: dto.itemVariantId ?? null,
          title,
          quantity: dto.quantity ?? 1,
          note: dto.note?.trim() || null,
          addedBy: userId,
        },
        include: { itemVariant: { select: { id: true, itemCode: true, name: true } } },
      });
      await this.audit.record({
        actorId: userId,
        action: 'order.add_on_added',
        objectType: 'Order',
        objectId: orderId,
        after: { addOnId: addOn.id, title, quantity: addOn.quantity },
      }, tx);
      return addOn;
    });
  }

  async removeAddOn(orderId: string, addOnId: string, userId: string) {
    return this.prisma.$transaction(async tx => {
        const claimed = await tx.order.updateMany({ where: { id: orderId, stage: 'packing', stockDeductedAt: null }, data: { version: { increment: 1 } } });
        if (!claimed.count) throw new ConflictException('Order is no longer available for gift edits.');
      const result = await tx.orderAddOn.deleteMany({
        where: { id: addOnId, orderId },
      });
      if (result.count === 0) throw new NotFoundException('Add-on not found.');
      await this.audit.record({
        actorId: userId,
        action: 'order.add_on_removed',
        objectType: 'Order',
        objectId: orderId,
        before: { addOnId },
      }, tx);
      return { ok: true };
    });
  }

  /**
   * Returns an order from packing back to the unfulfilled review (e.g. a
   * verbal "don't ship / change address" instruction). The review record is
   * flagged so the reviewer can spot returned orders and fix the address or
   * cancel the order.
   */
  async returnToReview(orderId: string, userId: string, note?: string) {
    const order = await this.requireStageIn(orderId, ['packing', 'ordering']);
    const fromStage = order.stage;
    const now = new Date();
    await this.claim(orderId, fromStage, 'review', 'returned_to_review', userId);
    await this.prisma.shipment.updateMany({
      where: { orderId, voidedAt: null },
      data: { voidedAt: now, voidedBy: userId, voidReason: note?.trim() || 'returned to review' },
    });
    // Returning to review gives back any stock deducted at packing.
    await this.inventory.returnForOrder(orderId, userId, 'returned to review');

    const existing = await this.prisma.reviewRecord.findFirst({
      where: { type: 'new_order', subjectId: orderId, status: 'pending' },
    });
    const lines = await this.prisma.orderLine.findMany({
      where: { orderId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, title: true, quantity: true },
    });
    if (existing) {
      const payload = (existing.payload ?? {}) as Record<string, unknown>;
      await this.prisma.reviewRecord.update({
        where: { id: existing.id },
        data: {
          payload: {
            ...payload,
            returnedFromPacking: true,
            returnedFromStage: fromStage,
            returnedNote: note?.trim() || null,
            shippingRegionId: order.shippingRegionId,
            categoryId: order.categoryId,
          } as Prisma.InputJsonValue,
        },
      });
    } else {
      const dbOrder = await this.prisma.order.findUniqueOrThrow({
        where: { id: orderId },
        include: { lines: { orderBy: { createdAt: 'asc' } } },
      });
      await this.prisma.reviewRecord.create({
        data: {
          type: 'new_order',
          status: 'pending',
          storeId: dbOrder.storeId,
          subjectId: orderId,
          payload: {
            existingOrder: true,
            returnedFromPacking: true,
            returnedFromStage: fromStage,
            returnedNote: note?.trim() || null,
            shippingRegionId: order.shippingRegionId,
            categoryId: order.categoryId,
            order: {
              displayNumber: dbOrder.displayNumber,
              statusRaw: (dbOrder.statusRaw ?? {}) as Prisma.InputJsonValue,
              customer: (dbOrder.customerSnapshot ?? {}) as Prisma.InputJsonValue,
              buyerNote: dbOrder.buyerNote,
              deliveryMethod: dbOrder.deliveryMethod,
              sourceUpdatedAt: now.toISOString(),
              lines: lines.map((line) => ({
                title: line.title ?? '',
                quantity: line.quantity,
              })),
            },
          } as unknown as Prisma.InputJsonValue,
        },
      });
    }
    await this.event(
      orderId,
      'packing',
      'review',
      'returned_to_review',
      userId,
      undefined,
      note,
    );
    return this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { shippingRegion: { select: { id: true, name: true, warehouse: true } } },
    });
  }

  /** Ordering confirm: carrier + tracking, stage -> inspection (no push yet). */
  async setTracking(orderId: string, dto: ShipmentEntryDto, userId: string) {
    await this.requireStage(orderId, 'ordering');
    await this.claim(orderId, 'ordering', 'inspection', 'tracked', userId);
    try {
      const tracking = await this.shipments.setTrackingForPackedShipment(
        orderId,
        dto,
        userId,
      );
      await this.event(orderId, 'ordering', 'inspection', 'tracked', userId, tracking, dto.note, 'Ordering');
      return tracking;
    } catch (error) {
      await this.prisma.order.updateMany({
        where: { id: orderId, stage: 'inspection' },
        data: { stage: 'ordering' },
      });
      throw error;
    }
  }

  /**
   * Inspection confirm: order/stage become completed, the shipment is marked
   * dispatched, and the platform fulfillment is pushed immediately. Push
   * failures land in the "needs attention" shipments view.
   */
  async inspect(orderId: string, userId: string, note?: string) {
    const order = await this.requireStage(orderId, 'inspection');
    const shipment = await this.prisma.shipment.findFirst({
      where: { orderId, voidedAt: null },
    });
    if (!shipment) {
      throw new ConflictException('This order has no shipment to inspect.');
    }
    if (!shipment.originalTrackingNumber) {
      throw new ConflictException('Enter a tracking number before inspection.');
    }

    await this.claim(orderId, 'inspection', 'completed', 'inspected', userId);
    await this.shipments.markInspected(shipment.id, userId);
    await this.prisma.order.update({
      where: { id: orderId },
      data: { fulfillmentStatus: 'FULFILLED' },
    });
    await this.event(
      orderId,
      'inspection',
      'completed',
      'inspected',
      userId,
      {
        shipmentId: shipment.id,
        trackingNumber: shipment.originalTrackingNumber,
      },
      note,
      'Inspection',
    );

    // Manual orders have no platform to write back to.
    if (!order.storeId) {
      await this.prisma.shipment.update({
        where: { id: shipment.id },
        data: { remoteSyncStatus: 'not_applicable' },
      });
      return { ok: true, push: 'not_applicable' as const };
    }

    // Schedule immediately, then execute synchronously so the operator sees
    // the platform result before leaving the queue.
    await this.prisma.shipment.update({
      where: { id: shipment.id },
      data: { remoteSyncStatus: 'scheduled', nextSendAt: new Date() },
    });
    try {
      const result = await this.executor.executeShipment(shipment.id, userId);
      return { ok: true, push: result.skipped ? 'skipped' : 'sent', result };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.prisma.shipment.update({
        where: { id: shipment.id },
        data: {
          remoteSyncStatus: 'failed',
          platformResults: { error: message, at: new Date().toISOString() },
        },
      });
      return { ok: true, push: 'failed' as const, error: message };
    }
  }

  /** Tail tracking can be added after the order is completed. */
  async setTail(orderId: string, dto: TailTrackingDto, userId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found.');
    if (order.stage !== 'completed') {
      throw new ConflictException('Tail tracking can only be added after shipping.');
    }
    const shipment = await this.prisma.shipment.findFirst({
      where: { orderId, voidedAt: null },
      include: { carrier: { select: { crossBorder: true } } },
    });
    if (!shipment) throw new ConflictException('This order has no shipment.');
    if (!shipment.carrier?.crossBorder) {
      throw new ConflictException('Tail tracking applies to cross-border carriers only.');
    }
    await this.shipments.setTailTracking(shipment.id, dto, userId);
    await this.event(
      orderId,
      'completed',
      'completed',
      'tail_saved',
      userId,
      {
        shipmentId: shipment.id,
        tailTrackingNumber: dto.tailTrackingNumber,
      },
      dto.note,
      'Tail',
    );
    return { ok: true };
  }

  private async requireStage(orderId: string, stage: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { shippingRegion: { select: { name: true } } },
    });
    if (!order) throw new NotFoundException('Order not found.');
    if (order.stage !== stage) {
      throw new ConflictException({
        code: 'STAGE_CONFLICT',
        message: 'This order is no longer in the expected stage; refresh the queue.',
      });
    }
    return order;
  }

  private async requireStageIn(orderId: string, stages: string[]) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { shippingRegion: { select: { name: true } } },
    });
    if (!order) throw new NotFoundException('Order not found.');
    if (!stages.includes(order.stage)) {
      throw new ConflictException({
        code: 'STAGE_CONFLICT',
        message: 'This order is no longer in the expected stage; refresh the queue.',
      });
    }
    return order;
  }

  /** Atomic stage claim: only one actor can move an order out of a stage. */
  private async claim(
    orderId: string,
    fromStage: string,
    toStage: string,
    action: string,
    actorId: string,
  ) {
    const updated = await this.prisma.order.updateMany({
      where: { id: orderId, stage: fromStage },
      data: {
        stage: toStage,
        stageUpdatedAt: new Date(),
        stageUpdatedBy: actorId,
        version: { increment: 1 },
      },
    });
    if (updated.count === 0) {
      throw new ConflictException({
        code: 'STAGE_CONFLICT',
        message: 'This order was just handled by someone else; refresh the queue.',
      });
    }
    await this.audit.record({
      actorId,
      action: `order.stage.${action}`,
      objectType: 'Order',
      objectId: orderId,
      after: { fromStage, toStage },
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
    noteKind?: string,
  ) {
    const trimmed = note?.trim() || null;
    await this.prisma.orderStageEvent.create({
      data: {
        orderId,
        fromStage,
        toStage,
        action,
        actorId,
        note: trimmed,
        ...(metadata
          ? { metadata: metadata as unknown as Prisma.InputJsonValue }
          : {}),
      },
    });
    // Step notes are shown in the order notes section, not the workflow
    // history. The kind prefix lets the UI localize the label.
    if (trimmed && noteKind) {
      await this.prisma.note.create({
        data: {
          ownerType: 'order',
          ownerId: orderId,
          orderOwnerId: orderId,
          body: `[${noteKind}] ${trimmed}`,
          createdBy: actorId,
        },
      });
    }
  }
}
