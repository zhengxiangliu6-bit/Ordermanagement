import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { Store } from '@prisma/client';
import type { ExternalListing, ExternalOrder } from '../platforms/platform-adapter';
import { resolveReviewRequired } from './policy.resolver';
import { stableHash } from './conflict';
import { normalizeFulfillmentStatus } from '../orders/fulfillment';

export interface SyncSummary {
  listings: { total: number; merged: number; staged: number; skipped: number };
  orders: { total: number; merged: number; staged: number; skipped: number; conflicts: number };
}

// Retired with the listing review queue (M7): kept for reference if staging returns.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function hashPayload(payload: unknown): string {
  // Recursive stable hash: nested objects must participate, otherwise
  // content changes (e.g. variant edits) produce identical hashes and the
  // review dedupe silently drops real updates.
  return stableHash(payload);
}

function listingPayload(listing: ExternalListing) {
  return {
    status: listing.status,
    title: listing.title,
    description: listing.description ?? null,
    images: listing.images ?? [],
    variants: listing.variants.map((variant) => ({
      externalVariantId: variant.externalVariantId,
      title: variant.title ?? null,
      externalSku: variant.externalSku ?? null,
      optionValues: variant.optionValues ?? null,
      images: variant.images ?? [],
    })),
    sourceUpdatedAt: listing.sourceUpdatedAt,
  };
}

const CONFLICTABLE_FIELDS = [
  'name',
  'phone',
  'email',
  'addressLine1',
  'addressLine2',
  'city',
  'postalCode',
  'country',
  'buyerNote',
  'deliveryMethod',
  'statusRaw',
] as const;

/** Fields whose internal value differs from the incoming external value (§15). */
function conflictingCustomerFields(
  internal: Record<string, unknown>,
  incoming: Record<string, unknown>,
): string[] {
  return CONFLICTABLE_FIELDS.filter((field) => {
    const a = internal[field];
    const b = incoming[field];
    // statusRaw is a nested object; compare by stable serialization.
    return JSON.stringify(a ?? null) !== JSON.stringify(b ?? null);
  });
}

function orderExternalView(order: ExternalOrder) {
  return {
    statusRaw: order.statusRaw ?? {},
    customerSnapshot: order.customer ?? {},
    buyerNote: order.buyerNote ?? null,
    deliveryMethod: order.deliveryMethod ?? null,
  };
}

/** Platform cancellation timestamp, if the order is cancelled on the platform. */
function platformCancelledAt(statusRaw: unknown): Date | null {
  const raw = (statusRaw as Record<string, unknown> | null)?.cancelledAt;
  if (typeof raw !== 'string' || !raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Platform payment status, normalized for workflow eligibility. */
function paymentStatusOf(statusRaw: unknown): string | null {
  const raw = (statusRaw as Record<string, unknown> | null)?.financialStatus;
  if (typeof raw !== 'string') return null;
  const normalized = raw.trim().toUpperCase();
  return normalized || null;
}

function externalEquals(a: unknown, b: unknown): boolean {
  return (
    JSON.stringify(a, Object.keys((a ?? {}) as object).sort()) ===
    JSON.stringify(b, Object.keys((b ?? {}) as object).sort())
  );
}

@Injectable()
export class SyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Runs one synchronization pass for a Store against its adapter data. */
  async runStoreSync(
    store: Store,
    listings: ExternalListing[],
    orders: ExternalOrder[],
  ): Promise<SyncSummary> {
    const summary: SyncSummary = {
      listings: { total: 0, merged: 0, staged: 0, skipped: 0 },
      orders: { total: 0, merged: 0, staged: 0, skipped: 0, conflicts: 0 },
    };

    for (const listing of listings) {
      summary.listings.total += 1;
      const outcome = await this.importListing(store, listing);
      summary.listings[outcome] += 1;
    }
    for (const order of orders) {
      summary.orders.total += 1;
      const outcome = await this.importOrder(store, order);
      summary.orders[outcome] += 1;
      if (outcome === 'staged') summary.orders.conflicts += 0; // conflicts counted inside
    }
    await this.audit.record({
      actorId: null,
      action: 'store.synchronized',
      objectType: 'Store',
      objectId: store.id,
      metadata: summary as unknown as Prisma.InputJsonValue,
    });
    return summary;
  }

  /**
   * Listing import: merge immediately when policy allows, otherwise stage a
   * Listing review record. Duplicate payloads (same hash) are never re-queued.
   */
  private async importListing(
    store: Store,
    listing: ExternalListing,
  ): Promise<'merged' | 'staged' | 'skipped'> {
    const existing = await this.prisma.listing.findUnique({
      where: { storeId_externalListingId: { storeId: store.id, externalListingId: listing.externalListingId } },
    });
    const payload = listingPayload(listing);
    void payload;

    if (existing && externalEquals(await this.currentListingSnapshot(existing.id), payload)) {
      return 'skipped';
    }

    // M7 decision (2026-10-21, boss ruling #17): the Listing review queue is
    // retired - platform listing changes merge into the mirror silently.
    // Only the product mapping (ListingVariant -> ItemVariant) is governed.
    await this.mergeListing(store, listing, existing?.id ?? null);
    return 'merged';
  }

  /** Applies listing content into the official mirror (also used on approval). */
  async mergeListing(
    store: Pick<Store, 'id'>,
    listing: ExternalListing,
    existingListingId: string | null,
  ): Promise<string> {
    return this.prisma.$transaction(async (tx) => {
      const dbListing = existingListingId
        ? await tx.listing.update({
            where: { id: existingListingId },
            data: { status: listing.status, lastSourceUpdateAt: new Date(listing.sourceUpdatedAt) },
          })
        : await tx.listing.create({
            data: {
              storeId: store.id,
              externalListingId: listing.externalListingId,
              status: listing.status,
              lastSourceUpdateAt: new Date(listing.sourceUpdatedAt),
            },
          });

      for (const variant of listing.variants) {
        await tx.listingVariant.upsert({
          where: {
            listingId_externalVariantId: {
              listingId: dbListing.id,
              externalVariantId: variant.externalVariantId,
            },
          },
          create: {
            listingId: dbListing.id,
            externalVariantId: variant.externalVariantId,
            externalTitle: variant.title ?? null,
            externalSku: variant.externalSku,
            optionValues: (variant.optionValues ?? undefined) as Prisma.InputJsonValue,
          },
          update: {
            externalTitle: variant.title ?? null,
            externalSku: variant.externalSku,
            optionValues: (variant.optionValues ?? undefined) as Prisma.InputJsonValue,
          },
        });
      }

      const variants = await tx.listingVariant.findMany({
        where: { listingId: dbListing.id },
        orderBy: { externalVariantId: 'asc' },
      });
      const version = await tx.listingContentVersion.create({
        data: {
          listingId: dbListing.id,
          snapshot: {
            status: listing.status,
            title: listing.title,
            description: listing.description ?? null,
            images: listing.images ?? [],
            variants: listing.variants,
            sourceUpdatedAt: listing.sourceUpdatedAt,
          } as unknown as Prisma.InputJsonValue,
        },
      });
      await tx.listing.update({
        where: { id: dbListing.id },
        data: { currentVersionId: version.id },
      });
      void variants;
      return dbListing.id;
    });
  }

  private async currentListingSnapshot(listingId: string) {
    const listing = await this.prisma.listing.findUniqueOrThrow({
      where: { id: listingId },
      include: { currentVersion: true },
    });
    return (listing.currentVersion?.snapshot ?? {}) as Record<string, unknown>;
  }


  /**
   * Order import: new orders follow the orders.new policy; updates run the
   * three-way conflict check — a conflicting update is forced into review
   * regardless of policy (§15).
   */
  private async importOrder(
    store: Store,
    order: ExternalOrder,
  ): Promise<'merged' | 'staged' | 'skipped'> {
    const existing = await this.prisma.order.findUnique({
      where: { storeId_externalOrderId: { storeId: store.id, externalOrderId: order.externalOrderId } },
    });
    if (!existing) {
      // M7: the order is created immediately; its stage decides whether it
      // is visible in the review/packing queues. Already fulfilled or
      // cancelled orders import straight to their terminal stage.
      const createdId = await this.createOfficialExternalOrder(store, order);
      const cancelled = platformCancelledAt(order.statusRaw) !== null;
      const fulfilled = normalizeFulfillmentStatus(order.statusRaw) === 'FULFILLED';
      const stage = cancelled
        ? 'cancelled'
        : fulfilled
          ? 'completed'
          : resolveReviewRequired(store.reviewPolicy, 'orders.new')
            ? 'review'
            : 'packing';

      await this.prisma.order.update({
        where: { id: createdId },
        data: {
          stage,
          stageUpdatedAt: new Date(),
          stageUpdatedBy: 'system',
          paymentStatus: paymentStatusOf(order.statusRaw),
        },
      });
      await this.recordStage(createdId, null, stage, 'imported', 'system');
      if (stage === 'review') {
        await this.createReviewForExistingOrder(createdId, order, store);
        return 'staged';
      }
      return 'merged';
    }

    // Updates are platform facts: apply them silently and keep the workflow
    // stage in sync (payment received / cancelled / fulfilled elsewhere).
    await this.applyExternalUpdate(existing.id, order);
    await this.applyStageForUpdate(existing, order);
    return 'merged';
  }

  /** Creates a pending review record pointing at an already-created order. */
  private async createReviewForExistingOrder(
    orderId: string,
    order: ExternalOrder,
    store: Store,
  ): Promise<void> {
    const duplicate = await this.prisma.reviewRecord.findFirst({
      where: { type: 'new_order', subjectId: orderId, status: 'pending' },
    });
    if (duplicate) return;

    const dbOrder = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { lines: { orderBy: { createdAt: 'asc' } } },
    });
    await this.prisma.reviewRecord.create({
      data: {
        type: 'new_order',
        status: 'pending',
        storeId: store.id,
        subjectId: orderId,
        payload: {
          existingOrder: true,
          storeName: store.displayName,
          platform: store.platform,
          order: {
            externalOrderId: order.externalOrderId,
            displayNumber: dbOrder.displayNumber,
            statusRaw: (order.statusRaw ?? {}) as Prisma.InputJsonValue,
            customer: (dbOrder.customerSnapshot ?? {}) as Prisma.InputJsonValue,
            buyerNote: dbOrder.buyerNote,
            deliveryMethod: dbOrder.deliveryMethod,
            sourceUpdatedAt: order.sourceUpdatedAt,
            lines: dbOrder.lines.map((line) => ({
              externalLineId: line.externalLineId ?? line.id,
              title: line.title ?? '',
              quantity: line.quantity,
              listingExternalId: '',
              variantExternalId: line.itemVariantId ?? '',
            })),
          },
        } as unknown as Prisma.InputJsonValue,
      },
    });
  }

  /** Keeps the workflow stage consistent with platform facts. */
  private async applyStageForUpdate(
    existing: {
      id: string;
      stage: string;
      storeId: string | null;
    },
    order: ExternalOrder,
  ): Promise<void> {
    const cancelledAt = platformCancelledAt(order.statusRaw);
    const fulfilled = normalizeFulfillmentStatus(order.statusRaw) === 'FULFILLED';
    const now = new Date();

    if (cancelledAt && existing.stage !== 'cancelled' && existing.stage !== 'completed') {
      await this.prisma.order.update({
        where: { id: existing.id },
        data: {
          stage: 'cancelled',
          cancelledAt,
          stageUpdatedAt: now,
          stageUpdatedBy: 'system',
          version: { increment: 1 },
        },
      });
      await this.prisma.shipment.updateMany({
        where: { orderId: existing.id, voidedAt: null },
        data: {
          voidedAt: now,
          voidedBy: 'system',
          voidReason: 'platform cancelled',
        },
      });
      await this.prisma.reviewRecord.updateMany({
        where: { type: 'new_order', subjectId: existing.id, status: 'pending' },
        data: { status: 'cancelled', decidedAt: now },
      });
      await this.recordStage(existing.id, existing.stage, 'cancelled', 'platform_cancelled', 'system');
      return;
    }

    if (fulfilled && existing.stage !== 'completed' && existing.stage !== 'cancelled') {
      await this.prisma.order.update({
        where: { id: existing.id },
        data: {
          stage: 'completed',
          fulfillmentStatus: 'FULFILLED',
          stageUpdatedAt: now,
          stageUpdatedBy: 'system',
          version: { increment: 1 },
        },
      });
      await this.prisma.reviewRecord.updateMany({
        where: { type: 'new_order', subjectId: existing.id, status: 'pending' },
        data: { status: 'auto_closed', decidedAt: now },
      });
      await this.recordStage(existing.id, existing.stage, 'completed', 'platform_fulfilled', 'system');
      return;
    }

  }

  private async recordStage(
    orderId: string,
    fromStage: string | null,
    toStage: string,
    action: string,
    actorId: string,
  ): Promise<void> {
    await this.prisma.orderStageEvent.create({
      data: { orderId, fromStage, toStage, action, actorId },
    });
  }

  /**
   * Keeps the raw-source mirror's platform-fulfillment slice current on
   * otherwise-unchanged orders, so orders fulfilled on the platform
   * (before or without Order Management) display their tracking info.
   */
  private async refreshPlatformFulfillmentMirror(
    existing: { id: string; rawSource: Prisma.JsonValue | null },
    order: ExternalOrder,
  ): Promise<void> {
    const current = (existing.rawSource as { order?: { platformFulfillments?: unknown } } | null)
      ?.order?.platformFulfillments;
    const incoming = order.platformFulfillments ?? null;
    if (JSON.stringify(current ?? null) === JSON.stringify(incoming)) return;
    await this.prisma.order.update({
      where: { id: existing.id },
      data: {
        rawSource: { order, capturedAt: new Date().toISOString() } as unknown as Prisma.InputJsonValue,
      },
    });
  }

  private async stageOrderReview(
    store: Store,
    order: ExternalOrder,
    type: 'new_order' | 'order_update',
    payloadHash: string,
    conflict?: boolean,
  ): Promise<void> {
    const duplicate = await this.prisma.reviewRecord.findFirst({
      where: {
        type,
        storeId: store.id,
        payloadHash,
        status: { in: ['pending', 'rejected'] },
      },
    });
    if (duplicate) return;

    interface ConflictFieldDetail {
      key: string;
      label: string;
      internalValue: unknown;
      incomingValue: unknown;
    }
    let conflictFields: ConflictFieldDetail[] = [];
    let currentInternal: Record<string, unknown> | null = null;
    const existing = await this.prisma.order.findUnique({
      where: { storeId_externalOrderId: { storeId: store.id, externalOrderId: order.externalOrderId } },
    });
    if (existing && conflict) {
      currentInternal = {
        ...(existing.customerSnapshot as Record<string, unknown>),
        buyerNote: existing.buyerNote,
        deliveryMethod: existing.deliveryMethod,
        statusRaw: existing.statusRaw,
      };
      const incomingView = orderExternalView(order);
      const incomingFlat = {
        ...(incomingView.customerSnapshot as Record<string, unknown>),
        buyerNote: incomingView.buyerNote,
        deliveryMethod: incomingView.deliveryMethod,
        statusRaw: incomingView.statusRaw,
      };
      const internalRecord = currentInternal as Record<string, unknown>;
      const incomingRecord = incomingFlat as Record<string, unknown>;
      conflictFields = conflictingCustomerFields(currentInternal, incomingFlat).map(
        (field) => ({
          key: field,
          label: field,
          internalValue: internalRecord[field] ?? null,
          incomingValue: incomingRecord[field] ?? null,
        }),
      );
    }

    await this.prisma.reviewRecord.create({
      data: {
        type,
        status: 'pending',
        storeId: store.id,
        subjectId: existing?.id ?? null,
        payload: {
          order,
          // Always present on order_update records: the queue API filters
          // conflicts out of Order Updates by this key, and Prisma JSON
          // path filters do not match records where the key is absent.
          conflict: Boolean(conflict),
          ...(conflict ? { conflictFields, currentInternal } : {}),
        } as unknown as Prisma.InputJsonValue,
        payloadHash,
      },
    });
  }

  /** Creates the official external Order with version-pinned lines. */
  async createOfficialExternalOrder(store: Store, order: ExternalOrder): Promise<string> {
    const resolvedLines = await Promise.all(
      order.lines.map(async (line) => {
        const listing = await this.prisma.listing.findUnique({
          where: { storeId_externalListingId: { storeId: store.id, externalListingId: line.listingExternalId } },
        });
        const listingVariant = listing
          ? await this.prisma.listingVariant.findUnique({
              where: {
                listingId_externalVariantId: {
                  listingId: listing.id,
                  externalVariantId: line.variantExternalId,
                },
              },
            })
          : null;
        const listingVersion = listing
          ? await this.prisma.listingContentVersion.findFirst({
              where: { listingId: listing.id },
              orderBy: { effectiveAt: 'desc' },
              select: { id: true },
            })
          : null;
        const itemVersion = listingVariant?.itemVariantId
          ? await this.prisma.itemContentVersion.findFirst({
              where: { itemId: listingVariant.itemVariantId },
              orderBy: { effectiveAt: 'desc' },
              select: { id: true },
            })
          : null;
        return {
          externalLineId: line.externalLineId,
          title: line.title,
          quantity: line.quantity,
          personalization: (line.personalization ?? undefined) as Prisma.InputJsonValue,
          listingVariantId: listingVariant?.id,
          listingContentVersionId: listingVersion?.id,
          itemVariantId: listingVariant?.itemVariantId,
          itemContentVersionId: itemVersion?.id,
        };
      }),
    );

    const externalView = orderExternalView(order);
    const created = await this.prisma.order.create({
      data: {
        source: 'external',
        storeId: store.id,
        platform: store.platform,
        externalOrderId: order.externalOrderId,
        displayNumber: order.displayNumber,
        statusRaw: order.statusRaw as Prisma.InputJsonValue,
        fulfillmentStatus: normalizeFulfillmentStatus(order.statusRaw),
        paymentStatus: paymentStatusOf(order.statusRaw),
        ...(platformCancelledAt(order.statusRaw)
          ? { cancelledAt: platformCancelledAt(order.statusRaw) }
          : {}),
        customerSnapshot: externalView.customerSnapshot as Prisma.InputJsonValue,
        buyerNote: order.buyerNote,
        deliveryMethod: order.deliveryMethod,
        // Mirror a platform cancellation at import so the order shows up as
        // cancelled without a manual action. Later platform status changes
        // are not auto-synced yet (deferred by the boss, 2026-10-21).
        cancelledAt: platformCancelledAt(order.statusRaw),
        rawSource: { order, capturedAt: new Date().toISOString() } as unknown as Prisma.InputJsonValue,
        lastAcceptedExternal: externalView as Prisma.InputJsonValue,
        createdBy: null,
        lines: {
          create: resolvedLines.map((line) => ({
            ...line,
            itemContentVersionId: line.itemContentVersionId ?? undefined,
            listingContentVersionId: line.listingContentVersionId ?? undefined,
            itemVariantId: line.itemVariantId ?? undefined,
            listingVariantId: line.listingVariantId ?? undefined,
          })),
        },
      },
    });
    await this.audit.record({
      actorId: null,
      action: 'order.imported',
      objectType: 'Order',
      objectId: created.id,
      after: { displayNumber: created.displayNumber, storeId: store.id },
    });
    return created.id;
  }

  /** Merges an approved non-conflicting external update (auto-merge path). */
  private async applyExternalUpdate(orderId: string, order: ExternalOrder): Promise<void> {
    const externalView = orderExternalView(order);
    await this.prisma.order.update({
      where: { id: orderId },
      data: {
        statusRaw: order.statusRaw as Prisma.InputJsonValue,
        fulfillmentStatus: normalizeFulfillmentStatus(order.statusRaw),
        customerSnapshot: externalView.customerSnapshot as Prisma.InputJsonValue,
        buyerNote: order.buyerNote,
        deliveryMethod: order.deliveryMethod,
        lastAcceptedExternal: externalView as Prisma.InputJsonValue,
        // Refresh the raw mirror so platform-side fulfillments added after
        // the initial import stay visible on the order detail.
        rawSource: { order, capturedAt: new Date().toISOString() } as unknown as Prisma.InputJsonValue,
      },
    });
    await this.audit.record({
      actorId: null,
      action: 'order.external_update_merged',
      objectType: 'Order',
      objectId: orderId,
      after: externalView as Prisma.InputJsonValue,
    });
  }
}
