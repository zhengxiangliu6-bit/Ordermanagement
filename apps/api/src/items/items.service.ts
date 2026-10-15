import {
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
  async searchVariants(search?: string) {
    return this.prisma.itemVariant.findMany({
      where: {
        archivedAt: null,
        ...(search
          ? {
              OR: [
                { itemCode: { contains: search, mode: 'insensitive' } },
                { name: { contains: search, mode: 'insensitive' } },
                { item: { name: { contains: search, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        itemCode: true,
        name: true,
        item: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  }

  async create(dto: CreateItemDto, userId: string): Promise<ItemWithRelations> {
    const item = await this.prisma.item.create({
      data: {
        name: dto.name,
        description: dto.description,
        category: dto.category,
        tags: dto.tags ?? [],
        images: (dto.images ?? undefined) as Prisma.InputJsonValue,
        createdBy: userId,
      },
      include: itemInclude,
    });
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
    const item = await this.prisma.item.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        category: dto.category,
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
