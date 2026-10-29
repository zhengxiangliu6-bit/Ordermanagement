import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { categoryForVariants, requireOrderRegion, resolveOrderVariant } from '../orders/order-product-links';
import { Prisma } from '@prisma/client';
import { hasPermissions } from '@om/shared';
import { normalizeFulfillmentStatus } from '../orders/fulfillment';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SyncService } from '../sync/sync.service';
import { ShipmentService } from '../shipping/shipment.service';
import type { ExternalListing, ExternalOrder } from '../platforms/platform-adapter';

export const REVIEW_QUEUE_TYPES = [
  'new_order',
  'order_update',
  'listing',
  'shipment',
] as const;
export type ReviewQueueType = (typeof REVIEW_QUEUE_TYPES)[number];

export function assertQueueType(type: string): asserts type is ReviewQueueType {
  if (!REVIEW_QUEUE_TYPES.includes(type as ReviewQueueType)) {
    throw new NotFoundException(`Unknown review queue type: ${type}`);
  }
}

/** Permission required per queue type (§20.2 scopes). */
export function requiredPermissionFor(
  type: ReviewQueueType,
  action: 'read' | 'review',
): string {
  if (type === 'listing') return action === 'read' ? 'listings:read' : 'listings:review';
  if (type === 'shipment') return action === 'read' ? 'shipping:read' : 'shipping:review';
  return action === 'read' ? 'orders:read' : 'orders:review';
}

export function assertTypePermission(
  user: { permissions: string[] },
  type: ReviewQueueType,
  action: 'read' | 'review',
): void {
  const required = requiredPermissionFor(type, action);
  if (!hasPermissions(user.permissions, [required])) {
    throw new ForbiddenException(`Missing permission: ${required}`);
  }
}

type SanitizableRecord = {
  type: string;
  payload: Prisma.JsonValue | null;
};

/**
 * Shipment queue payloads carry the sensitive carrier pair (§12.14): it is
 * stripped for viewers without carrier-source:read. Non-shipment records
 * pass through untouched.
 */
function sanitizeShipmentPayload<T extends SanitizableRecord>(
  record: T,
  viewerPermissions: string[],
): T {
  if (record.type !== 'shipment') return record;
  if (hasPermissions(viewerPermissions, ['carrier-source:read'])) return record;
  const payload = (record.payload ?? {}) as Record<string, unknown>;
  const sanitized = { ...payload };
  delete sanitized.carrierKey;
  delete sanitized.carrierName;
  delete sanitized.originalTrackingNumber;
  return { ...record, payload: sanitized as Prisma.JsonValue };
}

@Injectable()
export class ReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sync: SyncService,
    private readonly shipments: ShipmentService,
  ) {}

  list(
    type: ReviewQueueType,
    storeId: string | undefined,
    page: number,
    pageSize: number,
    conflict?: boolean,
    viewerPermissions: string[] = ['*'],
  ) {
    // Conflicts live on their own surface (boss decision): the Order Updates
    // queue excludes conflict records, the dedicated Conflicts view filters
    // for them via payload.conflict.
    const conflictFilter: Prisma.ReviewRecordWhereInput | undefined =
      conflict === undefined
        ? undefined
        : conflict
          ? { payload: { path: ['conflict'], equals: true } }
          : { NOT: { payload: { path: ['conflict'], equals: true } } };
    const where: Prisma.ReviewRecordWhereInput = {
      type,
      status: 'pending',
      ...(storeId ? { storeId } : {}),
      ...conflictFilter,
    };
    return this.prisma.$transaction([
      this.prisma.reviewRecord.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.reviewRecord.count({ where }),
    ]).then(async ([records, total]) => {
      // M7 R3: enrich new_order records with prior order count for the
      // same customer (how many orders this person has placed before).
      if (type === 'new_order') {
        const enriched = await Promise.all(
          records.map(async (record) => {
            const payload = record.payload as { order?: { customer?: { email?: string; name?: string } } };
            const email = payload.order?.customer?.email;
            const name = payload.order?.customer?.name;
            let priorOrderCount = 0;
            if (email || name) {
              priorOrderCount = await this.prisma.order.count({
                where: {
                  AND: [
                    { id: { not: record.subjectId ?? undefined } },
                    email
                      ? { customerSnapshot: { path: ['email'], string_contains: email } }
                      : { customerSnapshot: { path: ['name'], string_contains: name ?? '' } },
                  ],
                },
              });
            }
            const current = record.subjectId ? await this.prisma.order.findUnique({ where: { id: record.subjectId }, include: { lines: { select: { itemVariantId: true } } } }) : null;
            const categoryId = current?.categoryId ?? (current ? await categoryForVariants(this.prisma, current.lines.map(line => line.itemVariantId)) : null);
            return {
              ...sanitizeShipmentPayload(record, viewerPermissions),
              payload: { ...(record.payload as Record<string, unknown>), ...(current ? { shippingRegionId: current.shippingRegionId, categoryId } : {}) },
              priorOrderCount,
            };
          }),
        );
        return {
          records: enriched,
          total, page, pageSize,
          pageCount: Math.max(1, Math.ceil(total / pageSize)),
        };
      }
      return {
        records: records.map((record) =>
          sanitizeShipmentPayload(record, viewerPermissions),
        ),
        total, page, pageSize,
        pageCount: Math.max(1, Math.ceil(total / pageSize)),
      };
    });
  }

  async get(id: string, viewerPermissions: string[] = ['*']) {
    const record = await this.prisma.reviewRecord.findUnique({ where: { id } });
    if (!record) throw new NotFoundException('Review record not found.');
    return sanitizeShipmentPayload(record, viewerPermissions);
  }

  /** M7: save a reviewer note on a pending record before deciding. */
  async saveNote(id: string, note: string | null) {
    const record = await this.getChecked(id);
    if (record.status !== 'pending') {
      throw new ConflictException('This record has already been decided.');
    }
    const updated = await this.prisma.reviewRecord.update({
      where: { id },
      data: { reviewerNote: note },
    });
    return { ok: true, reviewerNote: updated.reviewerNote };
  }

  /** Approves a pending record and merges its staged content (per type). */
  async approve(
    id: string,
    userId: string,
    userPermissions: string[],
    assignment?: { shippingRegionId?: string; categoryId?: string | null; note?: string },
  ) {
    const record = await this.getChecked(id);
    assertTypePermission({ permissions: userPermissions }, record.type as ReviewQueueType, 'review');
    if (record.status !== 'pending') {
      throw new ConflictException('This record has already been decided.');
    }

    if (record.type === 'listing') {
      const payload = record.payload as unknown as {
        externalListingId: string;
        listing: ExternalListing;
      };
      await this.sync.mergeListing(
        { id: record.storeId! },
        { ...payload.listing, externalListingId: payload.externalListingId },
        record.subjectId,
      );
    } else if (record.type === 'new_order') {
      const payload = record.payload as unknown as {
        order: ExternalOrder;
        existingOrder?: boolean;
      };
      let orderId: string;
      if (payload.existingOrder) {
        // Manual orders (including copies) already exist; approval only
        // confirms them and applies the reviewer's assignment.
        if (!record.subjectId) {
          throw new ConflictException('Existing-order review has no subject order.');
        }
        orderId = record.subjectId;
      } else {
        const store = await this.prisma.store.findUniqueOrThrow({
          where: { id: record.storeId! },
        });
        orderId = await this.sync.createOfficialExternalOrder(store, payload.order);
      }
      // M7 R3: reviewer assigns the shipping method and may set/adjust the
      // product category at approval; the note is preserved on the order.
      await this.applyOrderAssignment(orderId, userId, assignment);
    } else if (record.type === 'order_update') {
      const payload = record.payload as unknown as {
        order: ExternalOrder;
        conflict?: boolean;
      };
      const externalView = {
        statusRaw: payload.order.statusRaw ?? {},
        customerSnapshot: payload.order.customer ?? {},
        buyerNote: payload.order.buyerNote ?? null,
        deliveryMethod: payload.order.deliveryMethod ?? null,
      };
      if (!record.subjectId) {
        throw new ConflictException('Order update record has no official order.');
      }
      await this.prisma.$transaction([
        this.prisma.order.update({
          where: { id: record.subjectId },
          data: {
            statusRaw: payload.order.statusRaw as unknown as Prisma.InputJsonValue,
            fulfillmentStatus: normalizeFulfillmentStatus(payload.order.statusRaw),
            customerSnapshot: externalView.customerSnapshot as Prisma.InputJsonValue,
            buyerNote: payload.order.buyerNote,
            deliveryMethod: payload.order.deliveryMethod,
            lastAcceptedExternal: externalView as unknown as Prisma.InputJsonValue,
          },
        }),
        this.prisma.orderRevision.create({
          data: {
            orderId: record.subjectId,
            reason: 'External update accepted via review queue.',
            before: {},
            after: externalView as unknown as Prisma.InputJsonValue,
            userId,
          },
        }),
      ]);
    } else if (record.type === 'shipment') {
      // Outbound shipping approval: schedule the shipment for sending
      // (approval never bypasses the schedule, §12.8/§12.10).
      await this.shipments.approveOutbound(record, userId);
    }

    await this.prisma.reviewRecord.update({
      where: { id },
      data: { status: 'approved', decidedBy: userId, decidedAt: new Date() },
    });
    await this.audit.record({
      actorId: userId,
      action: `review.approved.${record.type}`,
      objectType: 'ReviewRecord',
      objectId: id,
      metadata: { subjectId: record.subjectId },
    });
    return { ok: true };
  }

  async approveBatch(ids: string[], userId: string, userPermissions: string[]) {
    let approved = 0;
    const failures: Array<{ id: string; error: string }> = [];
    for (const id of ids) {
      try {
        await this.approve(id, userId, userPermissions);
        approved += 1;
      } catch (error) {
        failures.push({ id, error: String((error as Error).message ?? error) });
      }
    }
    return { approved, failures };
  }

  async reject(id: string, userId: string, userPermissions: string[]) {
    const record = await this.getChecked(id);
    assertTypePermission({ permissions: userPermissions }, record.type as ReviewQueueType, 'review');
    if (record.status !== 'pending') {
      throw new ConflictException('This record has already been decided.');
    }
    // M7: unfulfilled-order review is approve-only. A new order is either
    // accepted or cancelled on the platform; there is no "reject" outcome.
    if (record.type === 'new_order') {
      throw new ConflictException(
        'New orders cannot be rejected; approve the order instead.',
      );
    }
    if (record.type === 'shipment') {
      // Rejection returns the shipment for correction (§12.10/§12.12).
      await this.shipments.rejectOutbound(record, userId);
    }
    await this.prisma.reviewRecord.update({
      where: { id },
      data: { status: 'rejected', decidedBy: userId, decidedAt: new Date() },
    });
    await this.audit.record({
      actorId: userId,
      action: `review.rejected.${record.type}`,
      objectType: 'ReviewRecord',
      objectId: id,
      metadata: { subjectId: record.subjectId },
    });
    return { ok: true };
  }

  /** Confirms the order and applies the reviewer's region/category/note. */
  private async applyOrderAssignment(
    orderId: string,
    userId: string,
    assignment?: { shippingRegionId?: string; categoryId?: string | null; note?: string },
  ): Promise<void> {
    await this.prisma.$transaction(async tx => {
      const order = await tx.order.findUnique({ where: { id: orderId } });
      if (!order) throw new NotFoundException('Order not found.');

      const regionId = assignment?.shippingRegionId ?? order.shippingRegionId;
      const lines = await tx.orderLine.findMany({ where: { orderId }, select: { itemVariantId: true } });
      const categoryId = assignment?.categoryId ?? order.categoryId ?? await categoryForVariants(tx, lines.map(line => line.itemVariantId));
      if (!regionId || !categoryId) {
        throw new BadRequestException(
          'Select a shipping region and a product category before approving.',
        );
      }

      const region = await requireOrderRegion(tx, regionId);
      const category = await tx.category.findUnique({ where: { id: categoryId } });
      if (!category?.enabled) throw new BadRequestException('Select an enabled category.');
      for (const line of lines) {
        if (line.itemVariantId) await resolveOrderVariant(tx, line.itemVariantId, region.warehouse);
      }

      const hasAssignment = Boolean(
        assignment &&
          (assignment.shippingRegionId ||
            assignment.categoryId !== undefined ||
            assignment.note),
      );
      if (hasAssignment && assignment) {
        await tx.order.update({
          where: { id: orderId },
          data: {
            ...(assignment.shippingRegionId
              ? { shippingRegionId: assignment.shippingRegionId }
              : {}),
            ...(assignment.categoryId !== undefined && assignment.categoryId !== null
              ? { categoryId: assignment.categoryId }
              : {}),
          },
        });
        if (assignment.note) {
          await tx.note.create({
            data: {
              ownerType: 'order',
              ownerId: orderId,
              // The relation column drives order.notes; ownerType/id alone is
              // not enough (the detail view reads the relation).
              orderOwnerId: orderId,
              body: `[Review] ${assignment.note}`,
              createdBy: userId,
            },
          });
        }
      }

      // Approval moves the order into the packing queue. The conditional
      // update makes concurrent approvals safe (only one wins).
      const claimed = await tx.order.updateMany({
        where: { id: orderId, stage: 'review', version: order.version },
        data: {
          stage: 'packing',
          shippingRegionId: regionId,
          categoryId,
          stageUpdatedAt: new Date(),
          stageUpdatedBy: userId,
          version: { increment: 1 },
        },
      });
      if (claimed.count === 0) {
        throw new ConflictException(
          'This order was already moved out of review; refresh the queue.',
        );
      }
      await tx.orderStageEvent.create({
        data: {
          orderId,
          fromStage: 'review',
          toStage: 'packing',
          action: 'reviewed',
          actorId: userId,
          note: assignment?.note ?? null,
          metadata: {
            shippingRegionId: assignment?.shippingRegionId ?? null,
            categoryId: assignment?.categoryId ?? null,
          },
        },
      });
    });
  }

  private async getChecked(id: string) {
    const record = await this.prisma.reviewRecord.findUnique({ where: { id } });
    if (!record) throw new NotFoundException('Review record not found.');
    return record;
  }
}
