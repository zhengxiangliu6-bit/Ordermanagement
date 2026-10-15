import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

/** Unmapped listing variants grouped per store (§8.4). */
@Injectable()
export class MappingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

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
        externalSku: true,
        optionValues: true,
        itemVariantId: true,
        listing: {
          select: {
            id: true,
            status: true,
            store: { select: { id: true, displayName: true } },
          },
        },
        orderLines: { select: { id: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
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
