import { platformImages } from '../orders/order-line-images';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { generateItemCode } from '../items/item-code';

interface UnmappedListingVariant {
  id: string;
  externalVariantId: string;
  externalTitle: string | null;
  externalSku: string | null;
  optionValues: unknown;
  listing: {
    id: string;
    snapshot: { title?: string | null; status?: string | null };
    store: { displayName: string };
  };
}

/** Unmapped listing variants grouped per store (§8.4). */
@Injectable()
export class MappingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * One-click mapping (2026-10-15): generates an internal item per unmapped
   * listing (one variant per unmapped listing variant, names copied from the
   * platform) and links them. dryRun=true returns the plan without writing;
   * the UI always previews before executing.
   */
  async autoCreate(
    storeId: string | undefined,
    userId: string,
    dryRun: boolean,
  ): Promise<{
    dryRun: boolean;
    itemsToCreate: Array<{ title: string; store: string; variants: string[] }>;
    itemsCreated?: number;
    variantsMapped?: number;
  }> {
    const rows = await this.prisma.listingVariant.findMany({
      where: {
        itemVariantId: null,
        ...(storeId ? { listing: { storeId } } : {}),
      },
      orderBy: { createdAt: 'asc' },
      include: {
        listing: {
          select: {
            id: true,
            store: { select: { displayName: true } },
            currentVersion: { select: { snapshot: true } },
          },
        },
      },
    });
    const groups = new Map<string, UnmappedListingVariant[]>();
    for (const row of rows) {
      const snapshot = ((row.listing.currentVersion?.snapshot ?? {}) as {
        title?: string | null;
      }).title;
      const entry: UnmappedListingVariant = {
        id: row.id,
        externalVariantId: row.externalVariantId,
        externalTitle: row.externalTitle,
        externalSku: row.externalSku,
        optionValues: row.optionValues,
        listing: {
          id: row.listing.id,
          snapshot: { title: snapshot ?? row.externalVariantId },
          store: { displayName: row.listing.store.displayName },
        },
      };
      const list = groups.get(row.listing.id) ?? [];
      list.push(entry);
      groups.set(row.listing.id, list);
    }

    const plan = [...groups.values()].map((variants) => ({
      title: variants[0].listing.snapshot.title ?? variants[0].externalVariantId,
      store: variants[0].listing.store.displayName,
      variants: variants.map((variant) => variant.externalTitle ?? variant.externalSku ?? variant.externalVariantId),
    }));

    if (dryRun) {
      return { dryRun: true, itemsToCreate: plan };
    }

    let itemsCreated = 0;
    let variantsMapped = 0;
    for (const variants of groups.values()) {
      const item = await this.prisma.item.create({
        data: {
          name: variants[0].listing.snapshot.title ?? variants[0].externalVariantId,
          createdBy: userId,
        },
      });
      itemsCreated += 1;
      for (const variant of variants) {
        const created = await this.prisma.itemVariant.create({
          data: {
            itemId: item.id,
            itemCode: generateItemCode(),
            name: variant.externalTitle ?? variant.externalSku ?? variant.externalVariantId,
            optionValues: (variant.optionValues ?? undefined) as never,
          },
        });
        await this.prisma.listingVariant.update({
          where: { id: variant.id },
          data: { itemVariantId: created.id },
        });
        variantsMapped += 1;
      }
      // Every item carries a content-version snapshot (§9.2): record one
      // after the generated variants exist.
      const reloaded = await this.prisma.item.findUniqueOrThrow({
        where: { id: item.id },
        include: { variants: true },
      });
      await this.prisma.itemContentVersion.create({
        data: {
          itemId: item.id,
          snapshot: {
            name: reloaded.name,
            description: reloaded.description,
            category: reloaded.category,
            tags: reloaded.tags,
            images: reloaded.images,
            variants: reloaded.variants.map((variant) => ({
              itemCode: variant.itemCode,
              name: variant.name,
              optionValues: variant.optionValues,
            })),
          } as never,
          createdBy: userId,
        },
      });
      await this.audit.record({
        actorId: userId,
        action: 'mapping.auto_created',
        objectType: 'Item',
        objectId: item.id,
        after: { name: item.name, variants: variants.length },
      });
    }
    return { dryRun: false, itemsToCreate: [], itemsCreated, variantsMapped };
  }

  queue(storeId: string | undefined) {
    return this.prisma.listingVariant.findMany({
      where: {
        itemVariantId: null,
        ...(storeId
          ? { listing: { storeId } }
          : {}),
      },
      select: {
        id: true,
        externalVariantId: true,
        externalTitle: true,
        externalSku: true,
        optionValues: true,
        itemVariantId: true,
        listing: {
          select: {
            id: true,
            status: true,
            store: { select: { id: true, displayName: true } },
            currentVersion: { select: { snapshot: true } },
          },
        },
        orderLines: { select: { id: true } },
      },
      orderBy: { createdAt: 'asc' },
    }).then((rows) =>
      rows.map((row) => ({
        ...row,
        // The listing title lives in the content-version snapshot; surface
        // it so mapping decisions do not require SKU archaeology.
        ...platformImages(row.listing.currentVersion?.snapshot, row.externalVariantId),
        listingTitle:
          ((row.listing.currentVersion?.snapshot ?? {}) as { title?: string | null }).title ??
          null,
        listing: {
          id: row.listing.id,
          status: row.listing.status,
          store: row.listing.store,
        },
      })),
    );
  }

  /** Currently mapped listing variants (management view: inspect/unbind/remap). */
  mapped(storeId: string | undefined) {
    return this.prisma.listingVariant.findMany({
      where: {
        itemVariantId: { not: null },
        ...(storeId ? { listing: { storeId } } : {}),
      },
      select: {
        id: true,
        externalVariantId: true,
        externalTitle: true,
        externalSku: true,
        itemVariantId: true,
        listing: {
          select: {
            id: true,
            status: true,
            store: { select: { id: true, displayName: true } },
            currentVersion: { select: { snapshot: true } },
          },
        },
        itemVariant: {
          select: {
            id: true,
            itemCode: true,
            name: true,
            images: true,
            item: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { updatedAt: 'asc' },
    }).then((rows) =>
      rows.map((row) => ({
        id: row.id,
        externalVariantId: row.externalVariantId,
        externalTitle: row.externalTitle,
        externalSku: row.externalSku,
        ...platformImages(row.listing.currentVersion?.snapshot, row.externalVariantId),
        listingTitle:
          ((row.listing.currentVersion?.snapshot ?? {}) as { title?: string | null }).title ??
          null,
        store: row.listing.store,
        itemVariant: row.itemVariant
          ? {
              images: row.itemVariant.images,
              itemCode: row.itemVariant.itemCode,
              name: row.itemVariant.name,
              itemName: row.itemVariant.item.name,
            }
          : null,
      })),
    );
  }

  resolve(listingVariantId: string, itemVariantId: string, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const variant = await tx.listingVariant.findUnique({
        where: { id: listingVariantId },
      });
      if (!variant) throw new NotFoundException('Listing variant not found.');
      const itemVariant = await tx.itemVariant.findUnique({
        where: { id: itemVariantId },
      });
      if (!itemVariant) throw new NotFoundException('Item variant not found.');

      await tx.listingVariant.update({
        where: { id: listingVariantId },
        data: { itemVariantId },
      });

      // Backfill: every unresolved order line for this listing variant
      // receives the item identity plus the applicable content version (§8.4).
      const unresolved = await tx.orderLine.findMany({
        where: { listingVariantId, itemVariantId: null },
        select: { id: true },
      });
      const version = await tx.itemContentVersion.findFirst({
        where: { itemId: itemVariant.itemId },
        orderBy: { effectiveAt: 'desc' },
        select: { id: true },
      });
      if (unresolved.length > 0 && version) {
        await tx.orderLine.updateMany({
          where: { id: { in: unresolved.map((line) => line.id) } },
          data: { itemVariantId, itemContentVersionId: version.id },
        });
      }

      await this.audit.record({
        actorId: userId,
        action: 'mapping.resolved',
        objectType: 'ListingVariant',
        objectId: listingVariantId,
        after: {
          itemVariantId,
          itemCode: itemVariant.itemCode,
          backfilledLines: unresolved.length,
        },
      });
      return { ok: true, backfilledLines: unresolved.length };
    });
  }

  async unbind(listingVariantId: string, userId: string) {
    const variant = await this.prisma.listingVariant.findUnique({
      where: { id: listingVariantId },
    });
    if (!variant) throw new NotFoundException('Listing variant not found.');
    if (!variant.itemVariantId) {
      throw new ConflictException('This listing variant has no mapping.');
    }
    await this.prisma.listingVariant.update({
      where: { id: listingVariantId },
      data: { itemVariantId: null },
    });
    await this.audit.record({
      actorId: userId,
      action: 'mapping.removed',
      objectType: 'ListingVariant',
      objectId: listingVariantId,
      before: { itemVariantId: variant.itemVariantId },
    });
    return { ok: true };
  }
}
