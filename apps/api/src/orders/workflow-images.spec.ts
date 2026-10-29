import { describe, expect, it, vi } from 'vitest';
import { ShippingWorkService } from '../shipping/shipping-work.service';
import { ReviewService } from '../review/review.service';
import { OrdersService } from './orders.service';
import { MappingService } from '../mapping/mapping.service';

vi.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));
vi.mock('../shipping/shipment.service', () => ({ ShipmentService: class {} }));
vi.mock('../shipping/outbound-executor.service', () => ({
  OutboundExecutorService: class {},
}));
vi.mock('../sync/sync.service', () => ({ SyncService: class {} }));

const historical = 'https://example.com/historical.jpg';
describe('workflow image projections', () => {
  it('does not fetch image snapshots in shipping-work queues', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const service = new ShippingWorkService(
      { order: { findMany } } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await service.packingQueue();
    await service.inspectionQueue();
    for (const [query] of findMany.mock.calls) {
      expect(query.include.lines.select.itemContentVersion).toBeUndefined();
      expect(
        query.include.lines.select.itemVariant.select.images,
      ).toBeUndefined();
    }
  });

  it('does not enrich unfulfilled order review with image data', async () => {
    const prisma = {
      reviewRecord: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            { id: 'r', subjectId: 'order', payload: { order: {} } },
          ]),
        count: vi.fn().mockResolvedValue(1),
      },
      order: { findMany: vi.fn(), findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: (operations: Promise<unknown>[]) => Promise.all(operations),
    };
    const service = new ReviewService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const result = await service.list('new_order', undefined, 1, 20);
    expect(result.records[0]).not.toHaveProperty('orderLines');
    expect(prisma.order.findMany).not.toHaveBeenCalled();
  });

  it('does not request or project image data in order detail', async () => {
    const version = { id: 'version', effectiveAt: new Date('2026-10-29') };
    const basicLine = {
      id: 'line',
      title: 'Variant',
      quantity: 1,
      itemContentVersion: version,
    };
    const findUnique = vi
      .fn()
      .mockResolvedValue({
        id: 'order',
        lines: [basicLine],
        stageEvents: [],
        problemItems: [],
      });
    const service = new OrdersService(
      { order: { findUnique } } as never,
      {} as never,
      {} as never,
    );
    const result = await service.get('order');
    expect(result.lines[0]).not.toHaveProperty('variantImages');
    expect(result.lines[0].itemContentVersion).toEqual(version);
    const included = findUnique.mock.calls[0][0].include.lines.include;
    expect(included.itemContentVersion.select.snapshot).toBeUndefined();
    expect(included.itemVariant.select.images).toBeUndefined();
    expect(included.listingVariant.select.listing).toBeUndefined();
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
