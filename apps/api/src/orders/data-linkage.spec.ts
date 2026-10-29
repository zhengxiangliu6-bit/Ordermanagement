import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { OrdersService } from './orders.service';
import { ReviewItemLineDto } from './dto/order.dto';
import {
  categoryForVariants,
  resolveOrderVariant,
} from './order-product-links';
import { ShippingWorkService } from '../shipping/shipping-work.service';
import { ShippingRegionDto } from '../shipping/shipping-regions.controller';
import { ItemsService } from '../items/items.service';
import { MappingService } from '../mapping/mapping.service';
import { SyncService } from '../sync/sync.service';
import { InventoryService } from '../inventory/inventory.service';

vi.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));
vi.mock('../shipping/shipment.service', () => ({ ShipmentService: class {} }));
vi.mock('../shipping/outbound-executor.service', () => ({
  OutboundExecutorService: class {},
}));
const audit = () => ({ record: vi.fn() });
const variant = {
  id: 'vb',
  itemId: 'pb',
  name: 'B',
  archivedAt: null,
  item: { id: 'pb', name: 'Product B', categoryId: 'cb', archivedAt: null },
  stocks: [],
};
it('preserves the selected variant through request whitelisting', async () => {
  const dto = plainToInstance(ReviewItemLineDto, {
    title: 'B',
    quantity: 1,
    itemVariantId: 'vb',
  });
  expect(await validate(dto, { whitelist: true })).toEqual([]);
  expect(dto.itemVariantId).toBe('vb');
});
it('requires warehouse binding when creating a shipping region', async () => {
  expect(
    await validate(plainToInstance(ShippingRegionDto, { name: 'China' })),
  ).not.toHaveLength(0);
  expect(
    await validate(
      plainToInstance(ShippingRegionDto, { name: 'China', warehouse: 'china' }),
    ),
  ).toEqual([]);
});
it('allows zero stock, and warehouse archive affects only the selected warehouse', async () => {
  const db = {
    itemVariant: {
      findUnique: vi.fn().mockResolvedValue({
        ...variant,
        stocks: [{ warehouse: 'china', archivedAt: new Date(), quantity: 0 }],
      }),
    },
    itemContentVersion: {
      findFirst: vi.fn().mockResolvedValue({ id: 'version' }),
    },
  };
  await expect(
    resolveOrderVariant(db as never, 'vb', 'canada'),
  ).resolves.toHaveProperty('itemContentVersionId', 'version');
  await expect(resolveOrderVariant(db as never, 'vb', 'china')).rejects.toThrow(
    /archived/,
  );
});
it('filters parent and warehouse archives without excluding zero stock', async () => {
  const findMany = vi.fn().mockResolvedValue([]);
  await new ItemsService(
    { itemVariant: { findMany } } as never,
    audit() as never,
  ).searchVariants('B', 'china');
  const where = findMany.mock.calls[0][0].where;
  expect(where.item).toEqual({ archivedAt: null });
  expect(where.stocks).toEqual({
    none: { warehouse: 'china', archivedAt: { not: null } },
  });
  expect(JSON.stringify(where)).not.toContain('quantity');
});
it('infers a shared category but leaves mixed-category orders for review', async () => {
  const db = {
    itemVariant: {
      findMany: vi.fn().mockResolvedValue([{ item: { categoryId: 'c' } }]),
    },
    category: {
      findUnique: vi.fn().mockResolvedValue({ id: 'c', enabled: true }),
    },
  };
  expect(await categoryForVariants(db as never, ['v'])).toBe('c');
  db.itemVariant.findMany.mockResolvedValue([
    { item: { categoryId: 'c' } },
    { item: { categoryId: 'd' } },
  ]);
  expect(await categoryForVariants(db as never, ['v', 'w'])).toBeNull();
  expect(await categoryForVariants(db as never, ['v', null])).toBeNull();
});
it('persists replacement identity/version and removes the obsolete platform link', async () => {
  const db = {
    order: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn().mockResolvedValue({
        id: 'o',
        stage: 'review',
        version: 0,
        lines: [{ id: 'line', itemVariantId: 'va', title: 'A', quantity: 1 }],
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      update: vi.fn(),
    },
    orderLine: {
      update: vi.fn(),
      findMany: vi
        .fn()
        .mockResolvedValue([{ id: 'line', title: 'B', quantity: 2 }]),
    },
    itemVariant: {
      findUnique: vi.fn().mockResolvedValue(variant),
      findMany: vi.fn().mockResolvedValue([{ item: { categoryId: 'cb' } }]),
    },
    itemContentVersion: {
      findFirst: vi.fn().mockResolvedValue({ id: 'version' }),
    },
    category: {
      findUnique: vi.fn().mockResolvedValue({ id: 'cb', enabled: true }),
    },
    orderRevision: { create: vi.fn() },
    orderStageEvent: { create: vi.fn() },
    reviewRecord: { findMany: vi.fn().mockResolvedValue([]) },
  };
  const prisma = Object.assign(db, {
    $transaction: (fn: (tx: typeof db) => unknown) => fn(db),
  });
  const service = new OrdersService(
    prisma as never,
    audit() as never,
    {} as never,
  );
  vi.spyOn(service, 'get').mockResolvedValue({} as never);
  await service.reviewItems(
    'o',
    { lines: [{ id: 'line', title: 'B', quantity: 2, itemVariantId: 'vb' }] },
    'u',
  );
  expect(db.orderLine.update).toHaveBeenCalledWith({
    where: { id: 'line' },
    data: expect.objectContaining({
      itemVariantId: 'vb',
      itemContentVersionId: 'version',
      listingVariantId: null,
      title: 'B',
      quantity: 2,
    }),
  });
  expect(db.order.update).toHaveBeenCalledWith(
    expect.objectContaining({ data: { categoryId: 'cb' } }),
  );
});
it('blocks changing warehouses after stock deduction', async () => {
  const service = new OrdersService(
    {
      order: {
        findUnique: vi.fn().mockResolvedValue({
          stage: 'inspection',
          shippingRegionId: 'china',
          stockDeductedAt: new Date(),
        }),
      },
    } as never,
    audit() as never,
    {} as never,
  );
  await expect(
    service.updateAssignment('o', { shippingRegionId: 'canada' }, 'u'),
  ).rejects.toThrow(/review/);
});
it('one-click mapping backfills existing unresolved order identities and versions', async () => {
  const db = {
    listingVariant: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'lv',
          externalVariantId: 'v',
          externalTitle: 'B',
          optionValues: {},
          listing: {
            id: 'l',
            store: { displayName: 'S' },
            currentVersion: { snapshot: { title: 'Product' } },
          },
        },
      ]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: vi.fn().mockResolvedValue({ itemVariantId: 'vb' }),
    },
    item: {
      create: vi.fn().mockResolvedValue({ id: 'p' }),
      findUniqueOrThrow: vi
        .fn()
        .mockResolvedValue({ name: 'Product', variants: [] }),
    },
    itemVariant: { create: vi.fn().mockResolvedValue({ id: 'vb' }) },
    itemContentVersion: {
      create: vi.fn().mockResolvedValue({ id: 'version' }),
    },
    orderLine: { updateMany: vi.fn() },
  };
  const prisma = Object.assign(db, {
    $transaction: (fn: (tx: typeof db) => unknown) => fn(db),
  });
  await new MappingService(prisma as never, audit() as never).autoCreate(
    undefined,
    'u',
    false,
  );
  expect(db.orderLine.updateMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({
        listingVariantId: 'lv',
        itemVariantId: null,
      }),
      data: { itemVariantId: 'vb', itemContentVersionId: 'version' },
    }),
  );
});
it('pins imported content using the parent product ID, not its variant ID', async () => {
  const db = {
    listing: { findUnique: vi.fn().mockResolvedValue({ id: 'l' }) },
    listingVariant: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'lv',
        itemVariantId: 'vb',
        itemVariant: { itemId: 'pb' },
      }),
    },
    listingContentVersion: {
      findFirst: vi.fn().mockResolvedValue({ id: 'lcv' }),
    },
    itemContentVersion: { findFirst: vi.fn().mockResolvedValue({ id: 'icv' }) },
    itemVariant: {
      findMany: vi.fn().mockResolvedValue([{ item: { categoryId: null } }]),
    },
    order: { create: vi.fn().mockResolvedValue({ id: 'o' }) },
  };
  await new SyncService(
    db as never,
    audit() as never,
  ).createOfficialExternalOrder(
    { id: 'store', platform: 'shopify' } as never,
    {
      externalOrderId: 'e',
      displayNumber: '1',
      statusRaw: {},
      lines: [
        {
          externalLineId: 'l',
          listingExternalId: 'p',
          variantExternalId: 'v',
          title: 'B',
          quantity: 1,
        },
      ],
    } as never,
  );
  expect(db.itemContentVersion.findFirst).toHaveBeenCalledWith(
    expect.objectContaining({ where: { itemId: 'pb' } }),
  );
});
function packing(fail = false, warehouse: string | null = 'china') {
  let state = { stage: 'packing', quantity: 10, shipments: 0, deducted: false };
  const tx = {
    order: {
      updateMany: vi.fn(async () => {
        if (state.stage !== 'packing') return { count: 0 };
        state.stage = 'ordering';
        return { count: 1 };
      }),
      findUniqueOrThrow: vi.fn(async () => ({
        id: 'o',
        stage: state.stage,
        shippingRegion: { name: 'China', warehouse, enabled: true },
      })),
    },
    orderStageEvent: { create: vi.fn() },
  };
  const db = {
    $transaction: async (fn: (client: typeof tx) => unknown) => {
      const before = structuredClone(state);
      try {
        return await fn(tx);
      } catch (e) {
        state = before;
        throw e;
      }
    },
  };
  const inventory = {
    deductForOrder: vi.fn(async (_id, _wh, _user, _note, client) => {
      expect(client).toBe(tx);
      state.quantity -= 2;
      state.deducted = true;
    }),
  };
  const shipments = {
    createPackedShipment: vi.fn(async (_id, _dto, _user, client) => {
      expect(client).toBe(tx);
      state.shipments++;
      if (fail) throw Error('write failed');
      return { shipmentId: 's' };
    }),
  };
  return {
    service: new ShippingWorkService(
      db as never,
      audit() as never,
      shipments as never,
      {} as never,
      inventory as never,
    ),
    inventory,
    state: () => state,
  };
}
describe('packing transaction boundaries', () => {
  it('rolls back stock, stage, and shipment together on failure', async () => {
    const p = packing(true);
    await expect(p.service.pack('o', {} as never, 'u')).rejects.toThrow(
      'write failed',
    );
    expect(p.state()).toEqual({
      stage: 'packing',
      quantity: 10,
      shipments: 0,
      deducted: false,
    });
  });
  it('deducts once when packing confirmation is submitted again', async () => {
    const p = packing();
    await p.service.pack('o', {} as never, 'u');
    await expect(p.service.pack('o', {} as never, 'u')).rejects.toThrow(
      /handled/,
    );
    expect(p.inventory.deductForOrder).toHaveBeenCalledTimes(1);
    expect(p.state().quantity).toBe(8);
  });
  it('rejects a warehouse-less order without advancing its stage', async () => {
    const p = packing(false, null);
    await expect(p.service.pack('o', {} as never, 'u')).rejects.toThrow(
      /warehouse/,
    );
    expect(p.state().stage).toBe('packing');
    expect(p.inventory.deductForOrder).not.toHaveBeenCalled();
  });
});
it('refuses to silently skip unlinked products during inventory deduction', async () => {
  const tx = {
    order: {
      findUnique: vi
        .fn()
        .mockResolvedValue({ lines: [{ itemVariant: null }], addOns: [] }),
    },
  };
  await expect(
    new InventoryService({} as never, audit() as never).deductForOrder(
      'o',
      'china',
      'u',
      undefined,
      tx as never,
    ),
  ).rejects.toThrow(/Link every/);
});
it('stores managed category identity and allows clearing classification and description', async () => {
  const item = {
    id: 'p',
    name: 'Product',
    nameEn: '',
    tags: [],
    categoryId: null,
    variants: [],
  };
  const db = {
    item: {
      findUnique: vi.fn().mockResolvedValue(item),
      findUniqueOrThrow: vi.fn().mockResolvedValue(item),
      update: vi
        .fn()
        .mockImplementation(async (query) => ({ ...item, ...query.data })),
    },
    category: {
      findUnique: vi
        .fn()
        .mockResolvedValue({ id: 'c', name: 'Attaky', enabled: true }),
    },
    itemContentVersion: { create: vi.fn() },
  };
  const service = new ItemsService(db as never, audit() as never);
  await service.update('p', { categoryId: 'c' }, 'u');
  expect(db.item.update).toHaveBeenLastCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ categoryId: 'c', category: 'Attaky' }),
    }),
  );
  await service.update('p', { categoryId: null, description: '' }, 'u');
  expect(db.item.update).toHaveBeenLastCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        categoryId: null,
        category: null,
        description: '',
      }),
    }),
  );
});

it('blocks packing a zero-stock product without changing inventory', async () => {
  const db = {
    order: {
      findUnique: vi
        .fn()
        .mockResolvedValue({
          lines: [{ itemVariant: variant, itemVariantId: 'vb', quantity: 1 }],
          addOns: [],
        }),
    },
    itemVariant: { findMany: vi.fn().mockResolvedValue([variant]) },
    inventoryStock: {
      findUnique: vi.fn().mockResolvedValue({ quantity: 0 }),
      updateMany: vi.fn(),
    },
  };
  await expect(
    new InventoryService({} as never, audit() as never).deductForOrder(
      'o',
      'china',
      'u',
      undefined,
      db as never,
    ),
  ).rejects.toMatchObject({
    response: expect.objectContaining({ code: 'INSUFFICIENT_STOCK' }),
  });
  expect(db.inventoryStock.updateMany).not.toHaveBeenCalled();
});

it('returns inventory only once when a cancellation is retried', async () => {
  let marker: Date | null = new Date();
  let quantity = 8;
  const db = {
    order: {
      findUnique: vi.fn(async () => ({
        stockDeductedAt: marker,
        stockWarehouse: 'china',
        lines: [{ itemVariantId: 'vb', quantity: 2 }],
        addOns: [],
      })),
      updateMany: vi.fn(async () => {
        if (!marker) return { count: 0 };
        marker = null;
        return { count: 1 };
      }),
    },
    inventoryStock: {
      upsert: vi.fn(async () => ({ quantity: (quantity += 2) })),
    },
    inventoryMovement: { create: vi.fn() },
  };
  const prisma = Object.assign(db, {
    $transaction: (fn: (tx: typeof db) => unknown) => fn(db),
  });
  const service = new InventoryService(prisma as never, audit() as never);
  expect(await service.returnForOrder('o', 'u')).toEqual({ returned: true });
  expect(await service.returnForOrder('o', 'u')).toEqual({ returned: false });
  expect(quantity).toBe(10);
  expect(db.inventoryMovement.create).toHaveBeenCalledTimes(1);
});
