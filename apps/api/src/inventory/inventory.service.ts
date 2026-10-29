import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

export const INVENTORY_WAREHOUSES = ['china', 'canada'] as const;
export type InventoryWarehouse = (typeof INVENTORY_WAREHOUSES)[number];

export const INVENTORY_MOVEMENT_TYPES = [
  'outbound',
  'return',
  'adjust_in',
  'adjust_out',
  'stocktake',
] as const;
export type InventoryMovementType = (typeof INVENTORY_MOVEMENT_TYPES)[number];

export interface MovementListOptions {
  page?: number;
  pageSize?: number;
  /** Filters to one variant (item movements endpoint). */
  variantId?: string;
  /** Filters by movement type (outbound / return / adjust_in / …). */
  type?: string;
  /** Filters to one warehouse. */
  warehouse?: string;
  /** createdAt direction; desc (newest first) is the default. */
  order?: 'asc' | 'desc';
}

type Tx = Prisma.TransactionClient;

/**
 * Inventory management (M7d, consolidated 2026-10-27): the product catalog
 * (Item/ItemVariant) is the single product entity; stock and the movement
 * ledger hang directly off ItemVariant, one row per warehouse. The old
 * product↔inventory mapping layer is gone.
 */
@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Warehouse-scoped write guard: the global `inventory:manage` key grants
   * every warehouse; otherwise the request needs `inventory:<warehouse>:manage`.
   */
  private assertWarehouseManage(permissions: readonly string[] | undefined, warehouse: string) {
    const granted = permissions ?? [];
    if (
      granted.includes('*') ||
      granted.includes('inventory:manage') ||
      granted.includes(`inventory:${warehouse}:manage`)
    ) {
      return;
    }
    throw new ForbiddenException(`No manage permission for warehouse "${warehouse}".`);
  }

  /** Lists catalog items with their variants and per-warehouse stock. */
  async listItems() {
    const items = await this.prisma.item.findMany({
      orderBy: { createdAt: 'asc' },
      include: {
        variants: {
          orderBy: { createdAt: 'asc' },
          include: { stocks: true },
        },
      },
    });
    return items.map((item) => ({
      id: item.id,
      name: item.name,
      nameEn: item.nameEn,
      images: item.images,
      archivedAt: item.archivedAt,
      variants: item.variants.map((variant) => ({
        id: variant.id,
        itemCode: variant.itemCode,
        name: variant.name,
        nameEn: variant.nameEn,
        archivedAt: variant.archivedAt,
        stocks: variant.stocks,
        total: variant.stocks.reduce((sum, stock) => sum + stock.quantity, 0),
        low: variant.stocks.some(
          (stock) =>
            stock.lowThreshold != null && stock.quantity <= stock.lowThreshold,
        ),
      })),
      total: item.variants.reduce(
        (sum, variant) =>
          sum + variant.stocks.reduce((s, stock) => s + stock.quantity, 0),
        0,
      ),
    }));
  }

  /** Detail view for one product variant (its own inventory page). */
  async variantDetail(variantId: string) {
    const variant = await this.prisma.itemVariant.findUnique({
      where: { id: variantId },
      include: {
        item: { select: { id: true, name: true, nameEn: true, archivedAt: true } },
        stocks: true,
      },
    });
    if (!variant) throw new NotFoundException('Product variant not found.');
    return {
      id: variant.id,
      itemCode: variant.itemCode,
      name: variant.name,
      nameEn: variant.nameEn,
      images: variant.images,
      archivedAt: variant.archivedAt,
      item: variant.item,
      stocks: variant.stocks,
      total: variant.stocks.reduce((sum, stock) => sum + stock.quantity, 0),
      low: variant.stocks.some(
        (stock) =>
          stock.lowThreshold != null && stock.quantity <= stock.lowThreshold,
      ),
    };
  }

  async itemMovements(itemId: string, options: MovementListOptions = {}) {
    const variants = await this.prisma.itemVariant.findMany({
      where: { itemId },
      select: { id: true, name: true },
    });
    const allIds = variants.map((variant) => variant.id);
    const scopedIds = options.variantId
      ? allIds.filter((id) => id === options.variantId)
      : allIds;
    const result = await this.movementsPage(
      {
        itemVariantId: { in: scopedIds },
        ...(options.type ? { type: options.type } : {}),
        ...(options.warehouse ? { warehouse: options.warehouse } : {}),
      },
      options,
    );
    const variantNames = new Map(variants.map((variant) => [variant.id, variant.name]));
    return {
      ...result,
      rows: result.rows.map((row) => ({
        ...row,
        variantName: variantNames.get(row.itemVariantId) ?? null,
      })),
    };
  }

  /** Paginated movement history for one product variant. */
  async variantMovements(variantId: string, options: MovementListOptions = {}) {
    const variant = await this.prisma.itemVariant.findUnique({
      where: { id: variantId },
      select: { id: true },
    });
    if (!variant) throw new NotFoundException('Product variant not found.');
    return this.movementsPage(
      {
        itemVariantId: variantId,
        ...(options.type ? { type: options.type } : {}),
        ...(options.warehouse ? { warehouse: options.warehouse } : {}),
      },
      options,
    );
  }

  /** Shared paginated movement query with actor names and order links. */
  private async movementsPage(
    where: Prisma.InventoryMovementWhereInput,
    options: MovementListOptions,
  ) {
    const safePage = Math.max(1, Math.floor(options.page ?? 1) || 1);
    const safeSize = Math.min(100, Math.max(1, Math.floor(options.pageSize ?? 20) || 20));
    const direction = options.order === 'asc' ? 'asc' : 'desc';
    const [rows, total] = await Promise.all([
      this.prisma.inventoryMovement.findMany({
        where,
        orderBy: { createdAt: direction },
        skip: (safePage - 1) * safeSize,
        take: safeSize,
      }),
      this.prisma.inventoryMovement.count({ where }),
    ]);
    const actorIds = [...new Set(rows.map((row) => row.actorId))];
    const users = actorIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, name: true },
        })
      : [];
    const names = new Map(users.map((user) => [user.id, user.name]));
    const orderIds = [
      ...new Set(rows.map((row) => row.orderId).filter((id): id is string => !!id)),
    ];
    const orders = orderIds.length
      ? await this.prisma.order.findMany({
          where: { id: { in: orderIds } },
          select: { id: true, displayNumber: true },
        })
      : [];
    const orderNumbers = new Map(orders.map((order) => [order.id, order.displayNumber]));
    return {
      rows: rows.map((row) => ({
        ...row,
        actorName: row.actorId === 'system' ? null : names.get(row.actorId) ?? null,
        orderDisplayNumber: row.orderId ? orderNumbers.get(row.orderId) ?? null : null,
      })),
      total,
      page: safePage,
      pageSize: safeSize,
    };
  }

  /** Applies a signed stock change, writing a movement row. */
  private async applyChange(
    tx: Tx,
    itemVariantId: string,
    warehouse: string,
    delta: number,
    allowNegative = false,
  ) {
    if (allowNegative) {
      const stock = await tx.inventoryStock.upsert({
        where: { itemVariantId_warehouse: { itemVariantId, warehouse } },
        create: { itemVariantId, warehouse, quantity: delta },
        update: { quantity: { increment: delta } },
      });
      return stock.quantity;
    }
    // Ensure the stock row exists before a conditional decrement.
    await tx.inventoryStock.upsert({
      where: { itemVariantId_warehouse: { itemVariantId, warehouse } },
      create: { itemVariantId, warehouse, quantity: 0 },
      update: {},
    });
    const updated = await tx.inventoryStock.updateMany({
      where: { itemVariantId, warehouse, quantity: { gte: -delta } },
      data: { quantity: { increment: delta } },
    });
    if (updated.count === 0) {
      throw new ConflictException({
        code: 'INSUFFICIENT_STOCK',
        message: '库存不足，请先入库或调整库存。',
      });
    }
    const stock = await tx.inventoryStock.findUnique({
      where: { itemVariantId_warehouse: { itemVariantId, warehouse } },
    });
    return stock?.quantity ?? 0;
  }

  async adjust(
    itemVariantId: string,
    warehouse: string,
    delta: number,
    userId: string,
    note?: string,
    permissions?: readonly string[],
  ) {
    this.assertWarehouseManage(permissions, warehouse);
    if (delta === 0) throw new BadRequestException('Adjustment must be non-zero.');
    const variant = await this.prisma.itemVariant.findUnique({
      where: { id: itemVariantId },
    });
    if (!variant) throw new NotFoundException('Product variant not found.');

    const result = await this.prisma.$transaction(async (tx) => {
      const quantity = await this.applyChange(
        tx,
        itemVariantId,
        warehouse,
        delta,
      );
      await tx.inventoryMovement.create({
        data: {
          itemVariantId,
          warehouse,
          type: delta > 0 ? 'adjust_in' : 'adjust_out',
          quantity: delta,
          resultQuantity: quantity,
          actorId: userId,
          note: note?.trim() || null,
        },
      });
      return quantity;
    });
    await this.audit.record({
      actorId: userId,
      action: 'inventory.adjusted',
      objectType: 'ItemVariant',
      objectId: itemVariantId,
      after: { warehouse, delta, resultQuantity: result },
    });
    return { ok: true, quantity: result };
  }

  /** Stocktaking: sets the counted quantity, recording the difference. */
  async stocktake(
    itemVariantId: string,
    warehouse: string,
    countedQuantity: number,
    userId: string,
    note?: string,
    permissions?: readonly string[],
  ) {
    this.assertWarehouseManage(permissions, warehouse);
    if (countedQuantity < 0) {
      throw new BadRequestException('Counted quantity must be non-negative.');
    }
    const variant = await this.prisma.itemVariant.findUnique({
      where: { id: itemVariantId },
    });
    if (!variant) throw new NotFoundException('Product variant not found.');

    const result = await this.prisma.$transaction(async (tx) => {
      const stockBefore = await tx.inventoryStock.findUnique({
        where: { itemVariantId_warehouse: { itemVariantId, warehouse } },
      });
      const delta = countedQuantity - (stockBefore?.quantity ?? 0);
      await tx.inventoryStock.upsert({
        where: { itemVariantId_warehouse: { itemVariantId, warehouse } },
        create: { itemVariantId, warehouse, quantity: countedQuantity },
        update: { quantity: countedQuantity },
      });
      await tx.inventoryMovement.create({
        data: {
          itemVariantId,
          warehouse,
          type: 'stocktake',
          quantity: delta,
          resultQuantity: countedQuantity,
          actorId: userId,
          note: note?.trim() || null,
        },
      });
      return countedQuantity;
    });
    await this.audit.record({
      actorId: userId,
      action: 'inventory.stocktake',
      objectType: 'ItemVariant',
      objectId: itemVariantId,
      after: { countedQuantity },
    });
    return { ok: true, quantity: result };
  }

  async setThreshold(
    itemVariantId: string,
    warehouse: string,
    lowThreshold: number,
    userId: string,
  ) {
    await this.prisma.inventoryStock.upsert({
      where: { itemVariantId_warehouse: { itemVariantId, warehouse } },
      create: { itemVariantId, warehouse, quantity: 0, lowThreshold },
      update: { lowThreshold },
    });
    await this.audit.record({
      actorId: userId,
      action: 'inventory.threshold_set',
      objectType: 'ItemVariant',
      objectId: itemVariantId,
      after: { warehouse, lowThreshold },
    });
    return { ok: true };
  }

  /** Batch stocktake with per-entry and batch notes. */
  async stocktakeBatch(
    entries: Array<{
      itemVariantId: string;
      warehouse: string;
      countedQuantity: number;
      note?: string;
    }>,
    batchNote: string | null,
    userId: string,
    permissions?: readonly string[],
  ) {
    for (const entry of entries) {
      this.assertWarehouseManage(permissions, entry.warehouse);
    }
    const results: Array<{ itemVariantId: string; warehouse: string; quantity: number }> = [];
    for (const entry of entries) {
      const res = await this.stocktake(
        entry.itemVariantId,
        entry.warehouse,
        entry.countedQuantity,
        userId,
        [batchNote, entry.note].filter(Boolean).join(' · ') || undefined,
      );
      results.push({
        itemVariantId: entry.itemVariantId,
        warehouse: entry.warehouse,
        quantity: res.quantity,
      });
    }
    return { ok: true, count: results.length, results };
  }

  /**
   * Warehouse-scoped archive: the same variant can be archived in one
   * warehouse while staying active in the other.
   */
  async setVariantArchivedInWarehouse(
    itemVariantId: string,
    warehouse: string,
    archived: boolean,
    userId: string,
    permissions?: readonly string[],
  ) {
    this.assertWarehouseManage(permissions, warehouse);
    const variant = await this.prisma.itemVariant.findUnique({
      where: { id: itemVariantId },
      select: { id: true },
    });
    if (!variant) throw new NotFoundException('Product variant not found.');
    await this.prisma.inventoryStock.upsert({
      where: { itemVariantId_warehouse: { itemVariantId, warehouse } },
      create: {
        itemVariantId,
        warehouse,
        quantity: 0,
        archivedAt: archived ? new Date() : null,
      },
      update: { archivedAt: archived ? new Date() : null },
    });
    await this.audit.record({
      actorId: userId,
      action: archived
        ? 'inventory.variant_warehouse_archived'
        : 'inventory.variant_warehouse_restored',
      objectType: 'ItemVariant',
      objectId: itemVariantId,
      after: { warehouse, archived },
    });
    return { ok: true, warehouse, archived };
  }

  /**
   * Deletes one warehouse's stock row for a variant (the direct-delete
   * action on warehouse-archived stock). The movement ledger is kept.
   */
  async deleteWarehouseStock(
    itemVariantId: string,
    warehouse: string,
    userId: string,
    permissions?: readonly string[],
  ) {
    this.assertWarehouseManage(permissions, warehouse);
    const variant = await this.prisma.itemVariant.findUnique({
      where: { id: itemVariantId },
      select: { id: true },
    });
    if (!variant) throw new NotFoundException('Product variant not found.');
    const stock = await this.prisma.inventoryStock.findUnique({
      where: { itemVariantId_warehouse: { itemVariantId, warehouse } },
    });
    if (!stock) throw new NotFoundException('No stock record in this warehouse.');
    await this.prisma.inventoryStock.delete({
      where: { itemVariantId_warehouse: { itemVariantId, warehouse } },
    });
    await this.audit.record({
      actorId: userId,
      action: 'inventory.warehouse_stock_deleted',
      objectType: 'ItemVariant',
      objectId: itemVariantId,
      before: { warehouse, quantity: stock.quantity, archivedAt: stock.archivedAt },
    });
    return { ok: true, warehouse };
  }

  /** Resolves the warehouse for an order via its shipping region. */
  async warehouseForOrder(orderId: string): Promise<string | null> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { shippingRegion: { select: { warehouse: true } } },
    });
    return order?.shippingRegion?.warehouse ?? null;
  }

  /**
   * Computes the stock requirements for an order (lines + add-ons) against
   * the order's region warehouse. Stock is tracked per product variant.
   */
  async requirementsForOrder(orderId: string): Promise<{
    warehouse: string | null;
    rows: Array<{
      itemVariantId: string;
      title: string;
      warehouse: string;
      current: number;
      required: number;
      after: number | null;
      mapped: boolean;
    }>;
  }> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        shippingRegion: true,
        lines: { include: { itemVariant: { include: { item: true, stocks: true } } } },
        addOns: { include: { itemVariant: { include: { item: true, stocks: true } } } },
      },
    });
    if (!order) throw new NotFoundException('Order not found.');
    const warehouse = order.shippingRegion?.warehouse ?? null;
    if (!warehouse) return { warehouse: null, rows: [] };

    const required = new Map<string, { title: string; qty: number }>();
    const collect = (variant: { id: string; name: string; item: { name: string } } | null, qty: number) => {
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
    if (required.size === 0) return { warehouse, rows: [] };

    const rows = [...required.entries()].map(([itemVariantId, { title, qty }]) => {
      const variant = [...order.lines, ...order.addOns]
        .map((row) => row.itemVariant)
        .find((variant) => variant?.id === itemVariantId);
      const stock = variant?.stocks.find((s) => s.warehouse === warehouse);
      const current = stock?.quantity ?? 0;
      return {
        itemVariantId,
        title,
        warehouse,
        current,
        required: qty,
        after: current - qty,
        mapped: true,
      };
    });
    return { warehouse, rows };
  }

  /**
   * Deducts the order requirements (conditional decrements inside a
   * transaction). Throws INSUFFICIENT_STOCK when stock is not enough.
   */
  async deductForOrder(orderId: string, warehouse: string, userId: string, note?: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        lines: { include: { itemVariant: true } },
        addOns: { include: { itemVariant: true } },
      },
    });
    if (!order) throw new NotFoundException('Order not found.');

    const required = new Map<string, number>();
    const collect = (variantId: string | null | undefined, qty: number) => {
      if (!variantId || qty <= 0) return;
      required.set(variantId, (required.get(variantId) ?? 0) + qty);
    };
    for (const line of order.lines) {
      collect(line.itemVariantId, line.quantity);
    }
    for (const addOn of order.addOns) {
      collect(addOn.itemVariantId, addOn.quantity);
    }
    if (required.size === 0) return { deducted: false, items: 0 };

    // Pre-check for a precise shortage report: which items block packing.
    const shortageVariants = await this.prisma.itemVariant.findMany({
      where: { id: { in: [...required.keys()] } },
      include: { item: { select: { name: true } } },
    });
    const shortages: Array<{ title: string; current: number; required: number }> = [];
    for (const variant of shortageVariants) {
      const stock = await this.prisma.inventoryStock.findUnique({
        where: {
          itemVariantId_warehouse: { itemVariantId: variant.id, warehouse },
        },
      });
      const current = stock?.quantity ?? 0;
      const qty = required.get(variant.id) ?? 0;
      if (current < qty) {
        shortages.push({
          title: `${variant.item.name} / ${variant.name}`,
          current,
          required: qty,
        });
      }
    }
    if (shortages.length > 0) {
      throw new ConflictException({
        code: 'INSUFFICIENT_STOCK',
        message: '库存不足，无法确认打包。',
        shortages,
      });
    }

    await this.prisma.$transaction(async (tx) => {
      for (const [itemVariantId, qty] of required) {
        await tx.inventoryStock.upsert({
          where: { itemVariantId_warehouse: { itemVariantId, warehouse } },
          create: { itemVariantId, warehouse, quantity: 0 },
          update: {},
        });
        const updated = await tx.inventoryStock.updateMany({
          where: { itemVariantId, warehouse, quantity: { gte: qty } },
          data: { quantity: { decrement: qty } },
        });
        if (updated.count === 0) {
          throw new ConflictException({
            code: 'INSUFFICIENT_STOCK',
            message: '库存不足，无法确认打包。',
          });
        }
        await tx.inventoryMovement.create({
          data: {
            itemVariantId,
            warehouse,
            type: 'outbound',
            quantity: -qty,
            resultQuantity: 0, // filled below after reading final value
            orderId,
            actorId: userId,
            note: [`${order.displayNumber}-出库`, note?.trim()].filter(Boolean).join(' · '),
          },
        });
      }
      // Fill result quantities.
      for (const [itemVariantId] of required) {
        const stock = await tx.inventoryStock.findUnique({
          where: { itemVariantId_warehouse: { itemVariantId, warehouse } },
        });
        if (stock) {
          await tx.inventoryMovement.updateMany({
            where: {
              itemVariantId,
              warehouse,
              orderId,
              type: 'outbound',
              resultQuantity: 0,
            },
            data: { resultQuantity: stock.quantity },
          });
        }
      }
    });

    await this.prisma.order.update({
      where: { id: orderId },
      data: { stockDeductedAt: new Date(), stockWarehouse: warehouse },
    });
    return { deducted: true, items: required.size };
  }

  /** Returns previously deducted stock (order cancellation). */
  async returnForOrder(orderId: string, userId: string, note?: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        lines: { include: { itemVariant: true } },
        addOns: { include: { itemVariant: true } },
      },
    });
    if (!order) throw new NotFoundException('Order not found.');
    const warehouse = order.stockWarehouse;
    if (!order.stockDeductedAt || !warehouse) return { returned: false };

    const required = new Map<string, number>();
    const collect = (variantId: string | null | undefined, qty: number) => {
      if (!variantId || qty <= 0) return;
      required.set(variantId, (required.get(variantId) ?? 0) + qty);
    };
    for (const line of order.lines) {
      collect(line.itemVariantId, line.quantity);
    }
    for (const addOn of order.addOns) {
      collect(addOn.itemVariantId, addOn.quantity);
    }

    await this.prisma.$transaction(async (tx) => {
      for (const [itemVariantId, qty] of required) {
        await tx.inventoryStock.upsert({
          where: { itemVariantId_warehouse: { itemVariantId, warehouse } },
          create: { itemVariantId, warehouse, quantity: qty },
          update: { quantity: { increment: qty } },
        });
        await tx.inventoryMovement.create({
          data: {
            itemVariantId,
            warehouse,
            type: 'return',
            quantity: qty,
            resultQuantity: 0,
            orderId,
            actorId: userId,
            note: [`${order.displayNumber}-退回入库`, note?.trim()].filter(Boolean).join(' · '),
          },
        });
      }
    });

    await this.prisma.order.update({
      where: { id: orderId },
      data: { stockDeductedAt: null, stockWarehouse: null },
    });
    await this.audit.record({
      actorId: userId,
      action: 'inventory.returned',
      objectType: 'Order',
      objectId: orderId,
      after: { warehouse, items: required.size },
    });
    return { returned: true, items: required.size };
  }
}
