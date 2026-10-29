import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';

/** Shared by manual entry, review edits, and packing; stock 0 is selectable. */
export async function resolveOrderVariant(
  db: Prisma.TransactionClient,
  id: string,
  warehouse?: string | null,
) {
  const variant = await db.itemVariant.findUnique({
    where: { id },
    include: { item: true, stocks: true },
  });
  if (!variant) throw new NotFoundException('Item variant not found.');
  if (
    variant.archivedAt ||
    variant.item.archivedAt ||
    (warehouse &&
      variant.stocks.some((s) => s.warehouse === warehouse && s.archivedAt))
  ) {
    throw new ConflictException(
      'This product is archived in the selected warehouse.',
    );
  }
  const version = await db.itemContentVersion.findFirst({
    where: { itemId: variant.itemId },
    orderBy: { effectiveAt: 'desc' },
    select: { id: true },
  });
  return { variant, itemContentVersionId: version?.id ?? null };
}

export async function requireOrderRegion(
  db: Prisma.TransactionClient,
  id: string,
) {
  const region = await db.shippingRegion.findUnique({ where: { id } });
  if (
    !region?.enabled ||
    !['china', 'canada'].includes(region.warehouse ?? '')
  ) {
    throw new BadRequestException(
      'Select an enabled shipping region linked to a warehouse.',
    );
  }
  return region;
}

/** A uniform product category suggests the order category; mixed orders need review. */
export async function categoryForVariants(
  db: Prisma.TransactionClient,
  ids: Array<string | null | undefined>,
) {
  if (!ids.length || ids.some((id) => !id)) return null;
  const variants = await db.itemVariant.findMany({
    where: { id: { in: [...new Set(ids as string[])] } },
    select: { item: { select: { categoryId: true } } },
  });
  const categories = new Set(variants.map((v) => v.item.categoryId));
  if (categories.size !== 1 || categories.has(null)) return null;
  const id = [...categories][0];
  const category = id ? await db.category.findUnique({ where: { id } }) : null;
  return category?.enabled ? category.id : null;
}
