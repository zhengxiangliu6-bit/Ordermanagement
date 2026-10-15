import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { Store } from '@prisma/client';
import type { ExternalListing, ExternalOrder } from '../platforms/platform-adapter';
import { resolveReviewRequired } from './policy.resolver';
import { detectConflict, stableHash } from './conflict';

export interface SyncSummary {
  listings: { total: number; merged: number; staged: number; skipped: number };
  orders: { total: number; merged: number; staged: number; skipped: number; conflicts: number };
}

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
    variants: listing.variants.map((variant) => ({
      externalVariantId: variant.externalVariantId,
      externalSku: variant.externalSku ?? null,
      optionValues: variant.optionValues ?? null,
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
    const payloadHash = hashPayload(payload);
    const contentType = existing ? 'listings.updates' : 'listings.new';
    const reviewRequired = resolveReviewRequired(store.reviewPolicy, contentType);

    // Deduplicate: same content already pending or already rejected (§15).
    const duplicate = await this.prisma.reviewRecord.findFirst({
      where: {
        type: 'listing',
        storeId: store.id,
        payloadHash,
        OR: [{ status: 'pending' }, { status: 'rejected' }],
      },
    });
    if (duplicate) return 'skipped';
    if (existing && externalEquals(await this.currentListingSnapshot(existing.id), payload)) {
      return 'skipped';
    }

    if (!reviewRequired) {
      await this.mergeListing(store, listing, existing?.id ?? null);
      return 'merged';
    }

    await this.prisma.reviewRecord.create({
      data: {
        type: 'listing',
        status: 'pending',
        storeId: store.id,
        subjectId: existing?.id ?? null,
        payload: {
          kind: existing ? 'update' : 'new',
          externalListingId: listing.externalListingId,
          listing: payload,
        } as Prisma.InputJsonValue,
        payloadHash,
      },
    });
    return 'staged';
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
            externalSku: variant.externalSku,
            optionValues: (variant.optionValues ?? undefined) as Prisma.InputJsonValue,
          },
          update: {
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
    const incoming = orderExternalView(order);
    const payloadHash = stableHash(incoming);

    if (!existing) {
      const reviewRequired = resolveReviewRequired(store.reviewPolicy, 'orders.new');
      if (!reviewRequired) {
        await this.createOfficialExternalOrder(store, order);
        return 'merged';
      }
      await this.stageOrderReview(store, order, 'new_order', payloadHash);
      return 'staged';
    }

    if (existing.lastAcceptedExternal) {
      const verdict = detectConflict({
        lastAcceptedExternal: existing.lastAcceptedExternal,
        currentInternal: {
          statusRaw: existing.statusRaw,
          customerSnapshot: existing.customerSnapshot,
          buyerNote: existing.buyerNote,
          deliveryMethod: existing.deliveryMethod,
        },
        incomingExternal: incoming,
      });
      if (verdict === 'no-change') {
        // Display-only mirror: platform-side fulfillments may have changed
        // without touching any reviewable field; keep them current silently.
        await this.refreshPlatformFulfillmentMirror(existing, order);
        return 'skipped';
      }

      const policyReview = resolveReviewRequired(store.reviewPolicy, 'orders.updates');
      if (verdict === 'conflict' || policyReview) {
        await this.stageOrderReview(store, order, 'order_update', payloadHash, verdict === 'conflict');
        return 'staged';
      }
    } else {
      // First update after import: remember the accepted external base.
      await this.prisma.order.update({
        where: { id: existing.id },
        data: { lastAcceptedExternal: orderExternalView(order) as Prisma.InputJsonValue },
      });
      await this.refreshPlatformFulfillmentMirror(existing, order);
      return 'skipped';
    }

    await this.applyExternalUpdate(existing.id, order);
    return 'merged';
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
        customerSnapshot: externalView.customerSnapshot as Prisma.InputJsonValue,
        buyerNote: order.buyerNote,
        deliveryMethod: order.deliveryMethod,
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
