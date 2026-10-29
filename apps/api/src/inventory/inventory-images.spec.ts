import { describe, expect, it, vi } from 'vitest';
import { InventoryService } from './inventory.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';

vi.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));

const images = ['/api/v1/item-images/' + 'a'.repeat(64) + '/display.webp'];

describe('inventory catalog images and warehouse archive', () => {
  it('preserves variant image arrays in the inventory list response', async () => {
    const prisma = {
      item: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            {
              id: 'item',
              name: 'Product',
              nameEn: '',
              images,
              archivedAt: null,
              variants: [
                {
                  id: 'variant',
                  name: 'Variant',
                  nameEn: '',
                  images,
                  stocks: [],
                  archivedAt: null,
                },
              ],
            },
          ]),
      },
    };
    const service = new InventoryService(
      prisma as unknown as PrismaService,
      {} as AuditService,
    );
    expect((await service.listItems())[0].variants[0].images).toEqual(images);
  });

  it('requests the parent product image field for variant inventory detail', async () => {
    const findUnique = vi
      .fn()
      .mockResolvedValue({
        id: 'variant',
        images,
        item: { id: 'item', images },
        stocks: [],
      });
    const service = new InventoryService(
      { itemVariant: { findUnique } } as unknown as PrismaService,
      {} as AuditService,
    );
    expect((await service.variantDetail('variant')).item.images).toEqual(
      images,
    );
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          item: { select: expect.objectContaining({ images: true }) },
        }),
      }),
    );
  });

  it('archives and restores only the specified warehouse stock, leaving catalog variants unchanged', async () => {
    const prisma = {
      itemVariant: { findUnique: vi.fn().mockResolvedValue({ id: 'variant' }) },
      inventoryStock: { upsert: vi.fn() },
    };
    const service = new InventoryService(
      prisma as unknown as PrismaService,
      { record: vi.fn() } as unknown as AuditService,
    );
    await service.setVariantArchivedInWarehouse(
      'variant',
      'china',
      true,
      'user',
      ['inventory:china:manage'],
    );
    expect(prisma.inventoryStock.upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {
          itemVariantId_warehouse: {
            itemVariantId: 'variant',
            warehouse: 'china',
          },
        },
        update: { archivedAt: expect.any(Date) },
      }),
    );
    await service.setVariantArchivedInWarehouse(
      'variant',
      'china',
      false,
      'user',
      ['inventory:china:manage'],
    );
    expect(prisma.inventoryStock.upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {
          itemVariantId_warehouse: {
            itemVariantId: 'variant',
            warehouse: 'china',
          },
        },
        update: { archivedAt: null },
      }),
    );
    await expect(
      service.setVariantArchivedInWarehouse('variant', 'canada', true, 'user', [
        'inventory:china:manage',
      ]),
    ).rejects.toMatchObject({ status: 403 });
    expect(prisma.inventoryStock.upsert).toHaveBeenCalledTimes(2);
  });
});
