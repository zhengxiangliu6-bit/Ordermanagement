import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { hasPermissions } from '@om/shared';
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
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.reviewRecord.count({ where }),
    ]).then(([records, total]) => ({
      records: records.map((record) =>
        sanitizeShipmentPayload(record, viewerPermissions),
      ),
      total,
      page,
      pageSize,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
    }));
  }

  async get(id: string, viewerPermissions: string[] = ['*']) {
    const record = await this.prisma.reviewRecord.findUnique({ where: { id } });
    if (!record) throw new NotFoundException('Review record not found.');
    return sanitizeShipmentPayload(record, viewerPermissions);
  }

  /** Approves a pending record and merges its staged content (per type). */
  async approve(id: string, userId: string, userPermissions: string[]) {
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
      const payload = record.payload as unknown as { order: ExternalOrder };
      const store = await this.prisma.store.findUniqueOrThrow({
        where: { id: record.storeId! },
      });
      await this.sync.createOfficialExternalOrder(store, payload.order);
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

  private async getChecked(id: string) {
    const record = await this.prisma.reviewRecord.findUnique({ where: { id } });
    if (!record) throw new NotFoundException('Review record not found.');
    return record;
  }
}
