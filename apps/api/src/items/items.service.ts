import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { generateItemCode } from './item-code';
import {
  CreateItemDto,
  CreateItemVariantDto,
  ListItemsQueryDto,
  UpdateItemDto,
  UpdateItemVariantDto,
} from './dto/item.dto';

const itemInclude = {
  variants: { orderBy: { createdAt: 'asc' as const } },
  _count: { select: { variants: true, notes: true } },
} satisfies Prisma.ItemInclude;

export type ItemWithRelations = Prisma.ItemGetPayload<{ include: typeof itemInclude }>;

function contentSnapshot(item: ItemWithRelations) {
  return {
    name: item.name,
    description: item.description,
    category: item.category,
    categoryId: item.categoryId,
    tags: item.tags,
    images: item.images,
    variants: item.variants.map((variant) => ({
      itemCode: variant.itemCode,
      name: variant.name,
      optionValues: variant.optionValues,
      images: variant.images,
      archivedAt: variant.archivedAt,
    })),
  };
}

@Injectable()
export class ItemsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Variant picker search: code, variant name, or parent item name (§8.3). */
  async searchVariants(search?: string, warehouse?: string) {
    return this.prisma.itemVariant.findMany({
      where: {
        archivedAt: null,
        item: { archivedAt: null },
        ...(warehouse ? { stocks: { none: { warehouse, archivedAt: { not: null } } } } : {}),
        ...(search
          ? {
              OR: [
                { itemCode: { contains: search, mode: 'insensitive' } },
                { name: { contains: search, mode: 'insensitive' } },
                { nameEn: { contains: search, mode: 'insensitive' } },
                { item: { nameEn: { contains: search, mode: 'insensitive' } } },
                { item: { name: { contains: search, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        itemCode: true,
        name: true,
        images: true,
        item: { select: { id: true, name: true, categoryId: true } },
        stocks: { select: { warehouse: true, quantity: true, archivedAt: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async create(dto: CreateItemDto, userId: string): Promise<ItemWithRelations> {
    const category = await this.resolveCategory(dto);
    const item = await this.prisma.item.create({
      data: {
        name: dto.name,
        nameEn: dto.nameEn ?? '',
        description: dto.description,
        ...category,
        tags: dto.tags ?? [],
        images: (dto.images ?? undefined) as Prisma.InputJsonValue,
        createdBy: userId,
      },
      include: itemInclude,
    });
    // Every item carries at least one variant (Shopify convention): a
    // default variant keeps variant-less products mappable (§8.2).
    await this.createVariantRow(item.id, { name: 'Default' });
    await this.createContentVersion(item.id, userId);
    await this.audit.record({
      actorId: userId,
      action: 'item.created',
      objectType: 'Item',
      objectId: item.id,
      after: { name: item.name },
    });
    return item;
  }

  private async resolveCategory(dto: { categoryId?: string | null; category?: string }, existingCategoryId?: string | null) {
    if (dto.categoryId === undefined && dto.category === undefined) return {};
    if (dto.categoryId === null || dto.categoryId === '' || (dto.categoryId === undefined && !dto.category?.trim())) {
      return { categoryId: null, category: null };
    }
    const category = await this.prisma.category.findUnique({
      where: dto.categoryId ? { id: dto.categoryId } : { name: dto.category!.trim() },
    });
    if (!category || (!category.enabled && category.id !== existingCategoryId)) throw new BadRequestException('Select an enabled category from category management.');
    return { categoryId: category.id, category: category.name };
  }

  /** Creates one ItemVariant row, retrying generated code collisions. */
  private async createVariantRow(
    itemId: string,
    data: { name: string; nameEn?: string; optionValues?: Record<string, unknown> },
  ): Promise<{ id: string; itemCode: string }> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        return await this.prisma.itemVariant.create({
          data: {
            itemId,
            itemCode: generateItemCode(),
            name: data.name,
            nameEn: data.nameEn ?? '',
            optionValues: (data.optionValues ?? undefined) as Prisma.InputJsonValue,
          },
          select: { id: true, itemCode: true },
        });
      } catch (error) {
        const isUniqueViolation =
          (error as Prisma.PrismaClientKnownRequestError).code === 'P2002';
        if (!isUniqueViolation) throw error;
      }
    }
    throw new Error('Could not generate a unique item code.');
  }

  /**
   * Batch variant generation from option axes (2026-10-15 UX ruling): the
   * admin types each axis once ("Color" = "Ice, Dawn, …") and the system
   * creates the cartesian product, naming variants after their values
   * ("Ice", "Ice / M", …). Caps at 200 combinations.
   */
  async createVariantsBatch(
    itemId: string,
    dto: { axes: Array<{ name: string; values: string[] }> },
    userId: string,
  ): Promise<{ created: number }> {
    await this.get(itemId);
    const axes = dto.axes
      .map((axis) => ({
        name: axis.name.trim(),
        values: axis.values.map((value) => value.trim()).filter(Boolean),
      }))
      .filter((axis) => axis.name.length > 0 && axis.values.length > 0);
    if (axes.length === 0) {
      throw new BadRequestException('At least one axis with values is required.');
    }
    const combinations: Array<{ name: string; optionValues: Record<string, string> }> = [{}].map(
      () => ({ name: '', optionValues: {} }),
    );
    combinations.length = 0;
    let current: Array<{ name: string; optionValues: Record<string, string> }> = [
      { name: '', optionValues: {} },
    ];
    for (const axis of axes) {
      const next: typeof current = [];
      for (const partial of current) {
        for (const value of axis.values) {
          next.push({
            name: partial.name ? `${partial.name} / ${value}` : value,
            optionValues: { ...partial.optionValues, [axis.name]: value },
          });
        }
      }
      current = next;
    }
    if (current.length > 200) {
      throw new BadRequestException(
        `Batch generates ${current.length} variants; the limit is 200.`,
      );
    }
    for (const combination of current) {
      await this.createVariantRow(itemId, {
        name: combination.name,
        optionValues: combination.optionValues,
      });
    }
    await this.audit.record({
      actorId: userId,
      action: 'item.variants.batch_created',
      objectType: 'Item',
      objectId: itemId,
      after: { axes: axes.map((axis) => `${axis.name}(${axis.values.length})`), created: current.length },
    });
    return { created: current.length };
  }

  async list(query: ListItemsQueryDto) {
    const where: Prisma.ItemWhereInput = {
      ...(query.archived ? { archivedAt: { not: null } } : { archivedAt: null }),
      ...(query.search
        ? { name: { contains: query.search, mode: 'insensitive' } }
        : {}),
      ...(query.category
        ? { category: { contains: query.category, mode: 'insensitive' } }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.item.findMany({
        where,
        include: { _count: { select: { variants: true, notes: true } } },
        orderBy: { updatedAt: 'desc' },
        skip: (query.page! - 1) * query.pageSize!,
        take: query.pageSize!,
      }),
      this.prisma.item.count({ where }),
    ]);
    return {
      items,
      total,
      page: query.page!,
      pageSize: query.pageSize!,
      pageCount: Math.max(1, Math.ceil(total / query.pageSize!)),
    };
  }

  async get(id: string): Promise<ItemWithRelations> {
    const item = await this.prisma.item.findUnique({
      where: { id },
      include: {
        ...itemInclude,
        notes: {
          orderBy: { createdAt: 'desc' },
          include: {
            revisions: true,
            createdByUser: { select: { id: true, name: true } },
            updatedByUser: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!item) throw new NotFoundException('Item not found.');
    return item;
  }

  async update(id: string, dto: UpdateItemDto, userId: string): Promise<ItemWithRelations> {
    const before = await this.get(id);
    const category = await this.resolveCategory(dto, before.categoryId);
    const item = await this.prisma.item.update({
      where: { id },
      data: {
        name: dto.name,
        nameEn: dto.nameEn,
        description: dto.description,
        ...category,
        tags: dto.tags,
        images: (dto.images ?? undefined) as Prisma.InputJsonValue | undefined,
      },
      include: itemInclude,
    });
    await this.createContentVersion(id, userId);
    await this.audit.record({
      actorId: userId,
      action: 'item.updated',
      objectType: 'Item',
      objectId: id,
      before: contentSnapshot(before),
      after: contentSnapshot(item),
    });
    return item;
  }

  async archive(id: string, userId: string): Promise<ItemWithRelations> {
    const before = await this.get(id);
    if (before.archivedAt) return before;
    const item = await this.prisma.item.update({
      where: { id },
      data: { archivedAt: new Date() },
      include: itemInclude,
    });
    await this.audit.record({
      actorId: userId,
      action: 'item.archived',
      objectType: 'Item',
      objectId: id,
      before: { archivedAt: null },
      after: { archivedAt: item.archivedAt },
    });
    return item;
  }

  async restore(id: string, userId: string): Promise<ItemWithRelations> {
    const before = await this.get(id);
    const item = await this.prisma.item.update({
      where: { id },
      data: { archivedAt: null },
      include: itemInclude,
    });
    await this.audit.record({
      actorId: userId,
      action: 'item.restored',
      objectType: 'Item',
      objectId: id,
      before: { archivedAt: before.archivedAt },
      after: { archivedAt: null },
    });
    return item;
  }

  async remove(id: string, userId: string): Promise<void> {
    const before = await this.get(id);
    await this.prisma.item.delete({ where: { id } });
    await this.audit.record({
      actorId: userId,
      action: 'item.deleted',
      objectType: 'Item',
      objectId: id,
      before: contentSnapshot(before),
    });
  }

  async createVariant(
    itemId: string,
    dto: CreateItemVariantDto,
    userId: string,
  ): Promise<ItemWithRelations> {
    await this.get(itemId);
    // Item Codes are permanent identities: retry the generated code if it
    // collides (astronomically unlikely, but identity must hold).
    let variant;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        variant = await this.prisma.itemVariant.create({
          data: {
            itemId,
            itemCode: generateItemCode(),
            name: dto.name,
            nameEn: dto.nameEn ?? '',
            optionValues: (dto.optionValues ?? undefined) as Prisma.InputJsonValue,
            images: (dto.images ?? undefined) as Prisma.InputJsonValue,
          },
        });
        break;
      } catch (error) {
        const target = (error as Prisma.PrismaClientKnownRequestError).meta
          ?.target as string[] | undefined;
        const isUniqueViolation =
          (error as Prisma.PrismaClientKnownRequestError).code === 'P2002';
        if (!isUniqueViolation || !target?.includes('itemCode') || attempt === 4) {
          throw error;
        }
      }
    }
    await this.createContentVersion(itemId, userId);
    await this.audit.record({
      actorId: userId,
      action: 'item_variant.created',
      objectType: 'ItemVariant',
      objectId: variant!.id,
      after: { itemId, itemCode: variant!.itemCode, name: variant!.name },
    });
    return this.get(itemId);
  }

  async updateVariant(
    itemId: string,
    variantId: string,
    dto: UpdateItemVariantDto,
    userId: string,
  ): Promise<ItemWithRelations> {
    const before = await this.get(itemId);
    const variant = before.variants.find((candidate) => candidate.id === variantId);
    if (!variant) throw new NotFoundException('Item variant not found.');
    await this.prisma.itemVariant.update({
      where: { id: variantId },
      data: {
        name: dto.name,
        nameEn: dto.nameEn,
        optionValues: (dto.optionValues ?? undefined) as Prisma.InputJsonValue | undefined,
        images: (dto.images ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
    // Variant content is part of the item snapshot: record a new version.
    await this.createContentVersion(itemId, userId);
    await this.audit.record({
      actorId: userId,
      action: 'item_variant.updated',
      objectType: 'ItemVariant',
      objectId: variantId,
      before: { name: variant.name, optionValues: variant.optionValues },
      after: dto,
    });
    return this.get(itemId);
  }

  /**
   * Permanently deletes a variant when nothing references it (order lines
   * or a mapping); referenced variants can only be archived (2026-10-16
   * ruling — permanent item codes must not orphan history).
   */
  async deleteVariant(
    itemId: string,
    variantId: string,
    userId: string,
  ): Promise<ItemWithRelations> {
    const before = await this.get(itemId);
    const variant = before.variants.find((candidate) => candidate.id === variantId);
    if (!variant) throw new NotFoundException('Item variant not found.');
    const [lineRefs, mappingRefs] = await Promise.all([
      this.prisma.orderLine.count({ where: { itemVariantId: variantId } }),
      this.prisma.listingVariant.count({ where: { itemVariantId: variantId } }),
    ]);
    if (lineRefs > 0 || mappingRefs > 0) {
      throw new ConflictException(
        `This variant is referenced by ${lineRefs} order line(s) / ${mappingRefs} mapping(s) and cannot be deleted; archive it instead.`,
      );
    }
    await this.prisma.itemVariant.delete({ where: { id: variantId } });
    await this.createContentVersion(itemId, userId);
    await this.audit.record({
      actorId: userId,
      action: 'item_variant.deleted',
      objectType: 'ItemVariant',
      objectId: variantId,
      before: { itemCode: variant.itemCode, name: variant.name },
    });
    return this.get(itemId);
  }

  async archiveVariant(
    itemId: string,
    variantId: string,
    userId: string,
  ): Promise<ItemWithRelations> {
    await this.get(itemId);
    const variant = await this.prisma.itemVariant.findUnique({ where: { id: variantId } });
    if (!variant || variant.itemId !== itemId) {
      throw new NotFoundException('Item variant not found.');
    }
    if (!variant.archivedAt) {
      await this.prisma.itemVariant.update({
        where: { id: variantId },
        data: { archivedAt: new Date() },
      });
      await this.createContentVersion(itemId, userId);
      await this.audit.record({
        actorId: userId,
        action: 'item_variant.archived',
        objectType: 'ItemVariant',
        objectId: variantId,
        after: { archivedAt: 'set' },
      });
    }
    return this.get(itemId);
  }

  /** Restores an archived variant of an item. */
  async restoreVariant(
    itemId: string,
    variantId: string,
    userId: string,
  ): Promise<ItemWithRelations> {
    await this.get(itemId);
    const variant = await this.prisma.itemVariant.findUnique({ where: { id: variantId } });
    if (!variant || variant.itemId !== itemId) {
      throw new NotFoundException('Item variant not found.');
    }
    if (variant.archivedAt) {
      await this.prisma.itemVariant.update({
        where: { id: variantId },
        data: { archivedAt: null },
      });
      await this.createContentVersion(itemId, userId);
      await this.audit.record({
        actorId: userId,
        action: 'item_variant.restored',
        objectType: 'ItemVariant',
        objectId: variantId,
        before: { archivedAt: 'set' },
        after: { archivedAt: null },
      });
    }
    return this.get(itemId);
  }

  /** Content changes immediately create a shared version (§9.2). */
  private async createContentVersion(itemId: string, userId: string): Promise<void> {
    const item = await this.prisma.item.findUniqueOrThrow({
      where: { id: itemId },
      include: { variants: true },
    });
    await this.prisma.itemContentVersion.create({
      data: {
        itemId,
        snapshot: contentSnapshot({
          ...item,
          _count: { variants: item.variants.length, notes: 0 },
        }) as Prisma.InputJsonValue,
        createdBy: userId,
      },
    });
  }
}
