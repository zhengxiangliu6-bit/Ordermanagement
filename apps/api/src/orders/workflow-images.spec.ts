import { describe, expect, it, vi } from 'vitest';
import { ShippingWorkService } from '../shipping/shipping-work.service';
import { ReviewService } from '../review/review.service';
import { MappingService } from '../mapping/mapping.service';

vi.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));
vi.mock('../shipping/shipment.service', () => ({ ShipmentService: class {} }));
vi.mock('../shipping/outbound-executor.service', () => ({
  OutboundExecutorService: class {},
}));
vi.mock('../sync/sync.service', () => ({ SyncService: class {} }));

const historical = 'https://example.com/historical.jpg';
const line = {
  id: 'line',
  title: 'Variant',
  quantity: 1,
  itemVariant: {
    itemCode: 'ATK-1',
    images: ['https://example.com/current.jpg'],
  },
  itemContentVersion: {
    snapshot: { variants: [{ itemCode: 'ATK-1', images: [historical] }] },
  },
};

describe('workflow image projections', () => {
  it('projects historical images into packing and inspection queues without returning entire snapshots', async () => {
    const findMany = vi
      .fn()
      .mockResolvedValue([{ id: 'order', lines: [line] }]);
    const service = new ShippingWorkService(
      { order: { findMany } } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    for (const orders of [
      await service.packingQueue(),
      await service.inspectionQueue(),
    ]) {
      expect(orders[0].lines[0]).toMatchObject({
        variantImages: [historical],
        variantImageSource: 'snapshot',
      });
      expect(orders[0].lines[0].itemContentVersion).toBeUndefined();
    }
    expect(
      findMany.mock.calls[0][0].include.lines.select.itemContentVersion,
    ).toEqual({ select: { snapshot: true } });
    expect(
      findMany.mock.calls[0][0].include.addOns.include.itemVariant.select
        .images,
    ).toBe(true);
  });

  it('batch-enriches new-order review lines with their linked historical images', async () => {
    const prisma = {
      reviewRecord: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            { id: 'r', subjectId: 'order', payload: { order: {} } },
          ]),
        count: vi.fn().mockResolvedValue(1),
      },
      order: {
        findMany: vi.fn().mockResolvedValue([{ id: 'order', lines: [line] }]),
      },
      $transaction: (operations: Promise<unknown>[]) => Promise.all(operations),
    };
    const service = new ReviewService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const result = await service.list('new_order', undefined, 1, 20);
    expect(result.records[0]).toMatchObject({
      orderLines: [
        {
          id: 'line',
          variantImages: [historical],
          variantImageSource: 'snapshot',
        },
      ],
    });
    expect(prisma.order.findMany).toHaveBeenCalledOnce();
  });

  it('keeps platform and system images separate in mapped and unmapped responses', async () => {
    const row = {
      id: 'listingVariant',
      externalVariantId: 'external',
      orderLines: [],
      listing: {
        id: 'listing',
        status: 'active',
        store: { id: 'store' },
        currentVersion: {
          snapshot: {
            title: 'Platform product',
            images: ['https://example.com/product.jpg'],
            variants: [
              {
                externalVariantId: 'external',
                images: ['https://example.com/platform-variant.jpg'],
              },
            ],
          },
        },
      },
      itemVariant: {
        itemCode: 'ATK-1',
        name: 'System',
        images: [historical],
        item: { name: 'System product' },
      },
    };
    const service = new MappingService(
      {
        listingVariant: { findMany: vi.fn().mockResolvedValue([row]) },
      } as never,
      {} as never,
    );
    const [queue] = await service.queue(undefined);
    expect(queue.platformVariantImages).toEqual([
      'https://example.com/platform-variant.jpg',
    ]);
    const [mapped] = await service.mapped(undefined);
    expect(mapped.platformProductImages).toEqual([
      'https://example.com/product.jpg',
    ]);
    expect(mapped.itemVariant?.images).toEqual([historical]);
  });
});
