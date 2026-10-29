// Inventory e2e (M7d, consolidated model): stock lives on catalog product
// variants, one row per warehouse. Run against scratch:
//   npm --workspace-root ... or: pnpm --filter @om/api test:e2e
// (test:e2e pins DATABASE_URL to order_management_e2e.)

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

const suite = process.env.OM_E2E ? describe : describe.skip;

suite('inventory e2e', () => {
  let app: INestApplication;
  let agent: request.Agent;
  let prisma: PrismaService;
  let adminCookie: string[];

  const suffix = randomBytes(4).toString('hex');
  let regionId = '';
  let categoryId = '';
  let warehouseUserId = '';
  let warehouseRoleId = '';
  let itemId = '';
  let variantId = '';
  let orderId = '';
  let displayNumber = '';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    agent = request(app.getHttpServer());
    prisma = app.get(PrismaService);

    const password = process.env.ADMIN_PASSWORD;
    if (!password) throw new Error('ADMIN_PASSWORD must be set for the e2e suite.');
    const login = await agent
      .post('/api/v1/auth/login')
      .send({ email: process.env.ADMIN_EMAIL ?? 'admin@example.com', password })
      .expect(200);
    adminCookie = login.headers['set-cookie'] as unknown as string[];

    const regions = await agent
      .get('/api/v1/shipping-regions')
      .set('Cookie', adminCookie)
      .expect(200);
    regionId = (regions.body as Array<{ id: string }>)[0].id;
    const categories = await agent
      .get('/api/v1/categories')
      .set('Cookie', adminCookie)
      .expect(200);
    categoryId = (categories.body as Array<{ id: string }>)[0].id;
  });

  afterAll(async () => {
    if (prisma) {
      if (orderId) {
        await prisma.order.deleteMany({ where: { id: orderId } }).catch(() => undefined);
      }
      await prisma.user.deleteMany({
        where: { id: warehouseUserId || '__none__' },
      });
      if (warehouseRoleId) {
        await prisma.userRole.deleteMany({ where: { roleId: warehouseRoleId } });
        await prisma.role.deleteMany({ where: { id: warehouseRoleId } });
      }
      if (itemId) {
        await prisma.item.deleteMany({ where: { id: itemId } }).catch(() => undefined);
      }
    }
    await app?.close();
  });

  it('lists catalog items with per-warehouse stock', async () => {
    const created = await agent
      .post('/api/v1/items')
      .set('Cookie', adminCookie)
      .send({
        name: `库存合并 ${suffix}`,
        nameEn: `Consolidated ${suffix}`,
      })
      .expect(201);
    itemId = created.body.id;
    const variant = await agent
      .post(`/api/v1/items/${itemId}/variants`)
      .set('Cookie', adminCookie)
      .send({ name: '默认', nameEn: 'Default' })
      .expect(201);
    variantId = variant.body.variants.at(-1).id as string;

    const list = await agent
      .get('/api/v1/inventory/items')
      .set('Cookie', adminCookie)
      .expect(200);
    const row = (
      list.body as Array<{
        id: string;
        name: string;
        nameEn: string;
        variants: Array<{ id: string; total: number }>;
      }>
    ).find((row) => row.id === itemId);
    expect(row?.name).toContain(suffix);
    expect(row?.nameEn).toContain(suffix);
    expect(row?.variants[0]?.total).toBe(0);
  });

  it('adjusts stock, records movements and honors filters', async () => {
    await agent
      .post(`/api/v1/inventory/variants/${variantId}/adjust`)
      .set('Cookie', adminCookie)
      .send({ warehouse: 'china', delta: 100, note: 'initial inbound' })
      .expect(201);
    // A net-zero pair so sort assertions have multiple rows.
    await agent
      .post(`/api/v1/inventory/variants/${variantId}/adjust`)
      .set('Cookie', adminCookie)
      .send({ warehouse: 'china', delta: 5, note: 'sort fixture' })
      .expect(201);
    await agent
      .post(`/api/v1/inventory/variants/${variantId}/adjust`)
      .set('Cookie', adminCookie)
      .send({ warehouse: 'china', delta: -5, note: 'sort fixture' })
      .expect(201);
    // A canada row that warehouse filtering must exclude.
    await agent
      .post(`/api/v1/inventory/variants/${variantId}/adjust`)
      .set('Cookie', adminCookie)
      .send({ warehouse: 'canada', delta: 7, note: 'canada only' })
      .expect(201);

    const movements = await agent
      .get(`/api/v1/inventory/items/${itemId}/movements`)
      .set('Cookie', adminCookie)
      .expect(200);
    expect(movements.body.total).toBe(4);
    expect(
      (movements.body.rows as Array<{ type: string; quantity: number }>).some(
        (movement) => movement.type === 'adjust_in' && movement.quantity === 100,
      ),
    ).toBe(true);

    const typed = await agent
      .get(`/api/v1/inventory/items/${itemId}/movements`)
      .query({ type: 'adjust_in' })
      .set('Cookie', adminCookie)
      .expect(200);
    expect(
      (typed.body.rows as Array<{ type: string }>).every((row) => row.type === 'adjust_in'),
    ).toBe(true);

    const asc = await agent
      .get(`/api/v1/inventory/items/${itemId}/movements`)
      .query({ order: 'asc', pageSize: 100 })
      .set('Cookie', adminCookie)
      .expect(200);
    const times = (asc.body.rows as Array<{ createdAt: string }>).map(
      (row) => new Date(row.createdAt).getTime(),
    );
    expect(times.length).toBeGreaterThan(1);
    expect(times[0]).toBeLessThanOrEqual(times[times.length - 1]);

    const chinaOnly = await agent
      .get(`/api/v1/inventory/items/${itemId}/movements`)
      .query({ warehouse: 'china' })
      .set('Cookie', adminCookie)
      .expect(200);
    expect(chinaOnly.body.total).toBe(3);
    expect(
      (chinaOnly.body.rows as Array<{ warehouse: string }>).every(
        (row) => row.warehouse === 'china',
      ),
    ).toBe(true);

    const outside = await agent
      .get(`/api/v1/inventory/items/${itemId}/movements`)
      .query({ variantId: '00000000-0000-0000-0000-000000000000' })
      .set('Cookie', adminCookie)
      .expect(200);
    expect(outside.body.total).toBe(0);
  });

  it('serves the variant detail and paginated variant movements', async () => {
    const detail = await agent
      .get(`/api/v1/inventory/variants/${variantId}`)
      .set('Cookie', adminCookie)
      .expect(200);
    expect(detail.body.item.id).toBe(itemId);
    expect(detail.body.total).toBe(107); // 100 china + 7 canada

    const paged = await agent
      .get(`/api/v1/inventory/variants/${variantId}/movements`)
      .query({ page: 1, pageSize: 2 })
      .set('Cookie', adminCookie)
      .expect(200);
    expect(paged.body.pageSize).toBe(2);
    expect(paged.body.rows).toHaveLength(2);
    expect(paged.body.total).toBe(4);
  });

  it('blocks adjustments that would drive stock negative', async () => {
    await agent
      .post(`/api/v1/inventory/variants/${variantId}/adjust`)
      .set('Cookie', adminCookie)
      .send({ warehouse: 'china', delta: -1000 })
      .expect(409);
  });

  it('deducts stock at packing and returns it on cancellation', async () => {
    const created = await agent
      .post('/api/v1/orders')
      .set('Cookie', adminCookie)
      .send({
        lines: [{ title: `Consolidated line ${suffix}`, quantity: 2, itemVariantId: variantId }],
        customer: { name: '库存合并', email: `consolidated-${suffix}@example.com` },
      })
      .expect(201);
    orderId = created.body.id as string;
    displayNumber = created.body.displayNumber as string;

    const review = await prisma.reviewRecord.findFirstOrThrow({
      where: { type: 'new_order', status: 'pending', subjectId: orderId },
    });
    const approveRes = await agent
      .post(`/api/v1/review-queue/${review.id}/approve`)
      .set('Cookie', adminCookie)
      .send({ shippingRegionId: regionId, categoryId });
    expect(approveRes.status).toBe(201);

    const preview = await agent
      .get(`/api/v1/shipping-work/${orderId}/packing-preview`)
      .set('Cookie', adminCookie)
      .expect(200);
    const row = (
      preview.body.rows as Array<{
        itemVariantId: string;
        current: number;
        required: number;
        after: number;
      }>
    ).find((row) => row.itemVariantId === variantId);
    expect(row).toBeDefined();
    expect(row!.current).toBe(100);
    expect(row!.required).toBe(2);
    expect(row!.after).toBe(98);

    // Insufficient stock: the backend blocks with a conflict that names
    // the exact shortage.
    await prisma.inventoryStock.update({
      where: { itemVariantId_warehouse: { itemVariantId: variantId, warehouse: 'china' } },
      data: { quantity: 1 },
    });
    const blocked = await agent
      .post(`/api/v1/shipping-work/${orderId}/pack`)
      .set('Cookie', adminCookie)
      .send({
        weightValue: 100,
        weightUnit: 'g',
        lengthValue: 10,
        widthValue: 10,
        heightValue: 10,
        dimensionUnit: 'cm',
      })
      .expect(409);
    expect(blocked.body.code).toBe('INSUFFICIENT_STOCK');
    expect(blocked.body.shortages).toEqual([
      { title: `库存合并 ${suffix} / 默认`, current: 1, required: 2 },
    ]);

    // Restore stock; packing now succeeds and deducts.
    await prisma.inventoryStock.update({
      where: { itemVariantId_warehouse: { itemVariantId: variantId, warehouse: 'china' } },
      data: { quantity: 100 },
    });
    await agent
      .post(`/api/v1/shipping-work/${orderId}/pack`)
      .set('Cookie', adminCookie)
      .send({
        weightValue: 100,
        weightUnit: 'g',
        lengthValue: 10,
        widthValue: 10,
        heightValue: 10,
        dimensionUnit: 'cm',
      })
      .expect(201);

    const stock = await prisma.inventoryStock.findUnique({
      where: { itemVariantId_warehouse: { itemVariantId: variantId, warehouse: 'china' } },
    });
    expect(stock?.quantity).toBe(98);

    // Cancelling the order returns the deducted stock.
    await agent
      .post(`/api/v1/orders/${orderId}/cancel`)
      .set('Cookie', adminCookie)
      .send({ reason: 'inventory e2e' })
      .expect(201);
    const stockAfterReturn = await prisma.inventoryStock.findUnique({
      where: { itemVariantId_warehouse: { itemVariantId: variantId, warehouse: 'china' } },
    });
    expect(stockAfterReturn?.quantity).toBe(100);

    const movements = await prisma.inventoryMovement.findMany({
      where: { itemVariantId: variantId, orderId },
    });
    expect(movements.some((m) => m.type === 'outbound')).toBe(true);
    expect(movements.some((m) => m.type === 'return')).toBe(true);
    // Order-linked notes carry the display number for the UI link.
    expect(movements.find((m) => m.type === 'outbound')?.note).toContain(
      `${displayNumber}-出库`,
    );
    expect(movements.find((m) => m.type === 'return')?.note).toContain(
      `${displayNumber}-退回入库`,
    );

    const linked = await agent
      .get(`/api/v1/inventory/variants/${variantId}/movements`)
      .query({ page: 1, pageSize: 20 })
      .set('Cookie', adminCookie)
      .expect(200);
    const outboundRow = (
      linked.body.rows as Array<{
        type: string;
        orderId: string | null;
        orderDisplayNumber: string | null;
      }>
    ).find((row) => row.type === 'outbound' && row.orderId === orderId);
    expect(outboundRow?.orderDisplayNumber).toBe(displayNumber);
  });

  it('supports stocktake', async () => {
    const res = await agent
      .post(`/api/v1/inventory/variants/${variantId}/stocktake`)
      .set('Cookie', adminCookie)
      .send({ warehouse: 'china', countedQuantity: 42, note: 'e2e stocktake' })
      .expect(201);
    expect(res.body.quantity).toBe(42);
    const stock = await prisma.inventoryStock.findUnique({
      where: { itemVariantId_warehouse: { itemVariantId: variantId, warehouse: 'china' } },
    });
    expect(stock?.quantity).toBe(42);
  });

  it('archives a variant in one warehouse while the other stays active', async () => {
    await agent
      .post(`/api/v1/inventory/variants/${variantId}/archive`)
      .set('Cookie', adminCookie)
      .send({ warehouse: 'china' })
      .expect(201);
    const china = await prisma.inventoryStock.findUnique({
      where: { itemVariantId_warehouse: { itemVariantId: variantId, warehouse: 'china' } },
    });
    const canada = await prisma.inventoryStock.findUnique({
      where: { itemVariantId_warehouse: { itemVariantId: variantId, warehouse: 'canada' } },
    });
    expect(china?.archivedAt).not.toBeNull();
    // Canada was never archived (row may not even exist).
    expect(canada?.archivedAt ?? null).toBeNull();

    const detail = await agent
      .get(`/api/v1/inventory/variants/${variantId}`)
      .set('Cookie', adminCookie)
      .expect(200);
    const chinaRow = (detail.body.stocks as Array<{ warehouse: string; archivedAt: string | null }>).find(
      (row) => row.warehouse === 'china',
    );
    expect(chinaRow?.archivedAt).not.toBeNull();

    await agent
      .post(`/api/v1/inventory/variants/${variantId}/restore`)
      .set('Cookie', adminCookie)
      .send({ warehouse: 'china' })
      .expect(201);
    const restored = await prisma.inventoryStock.findUnique({
      where: { itemVariantId_warehouse: { itemVariantId: variantId, warehouse: 'china' } },
    });
    expect(restored?.archivedAt).toBeNull();

    // Direct delete of the archived warehouse stock row.
    await agent
      .delete(`/api/v1/inventory/variants/${variantId}/warehouse-stock`)
      .query({ warehouse: 'china' })
      .set('Cookie', adminCookie)
      .expect(200);
    const afterDelete = await prisma.inventoryStock.findUnique({
      where: { itemVariantId_warehouse: { itemVariantId: variantId, warehouse: 'china' } },
    });
    expect(afterDelete).toBeNull();
    // Movements survive the stock-row delete.
    const movementsCount = await prisma.inventoryMovement.count({
      where: { itemVariantId: variantId, warehouse: 'china' },
    });
    expect(movementsCount).toBeGreaterThan(0);
  });

  it('rejects packing without positive weight and dimensions', async () => {
    await agent
      .post(`/api/v1/shipping-work/${orderId}/pack`)
      .set('Cookie', adminCookie)
      .send({
        weightValue: 0,
        weightUnit: 'g',
        lengthValue: 10,
        widthValue: 10,
        heightValue: 10,
        dimensionUnit: 'cm',
      })
      .expect(400);
  });

  it('scopes read and manage by warehouse permission', async () => {
    const role = await agent
      .post('/api/v1/users/roles')
      .set('Cookie', adminCookie)
      .send({
        name: `中国仓操作员 ${suffix}`,
        permissions: ['inventory:china:read', 'inventory:china:manage'],
      })
      .expect(201);
    warehouseRoleId = role.body.id;
    const roleKey = role.body.key as string;

    const email = `wh-china-${suffix}@example.com`;
    const created = await agent
      .post('/api/v1/users')
      .set('Cookie', adminCookie)
      .send({ email, name: 'China WH', roleKeys: ['staff'] })
      .expect(201);
    warehouseUserId = created.body.user.id;
    await agent
      .post(`/api/v1/users/${warehouseUserId}/roles`)
      .set('Cookie', adminCookie)
      .send({ roleKeys: [roleKey] })
      .expect(201);

    const login = await agent
      .post('/api/v1/auth/login')
      .send({ email, password: created.body.temporaryPassword })
      .expect(200);
    const cookie = login.headers['set-cookie'] as unknown as string[];

    await agent
      .post('/api/v1/users/me/change-password')
      .set('Cookie', cookie)
      .send({ currentPassword: created.body.temporaryPassword, newPassword: 'Wh-Scope-9' })
      .expect(200);

    await agent
      .get('/api/v1/inventory/items')
      .set('Cookie', cookie)
      .expect(200);
    await agent
      .get(`/api/v1/inventory/variants/${variantId}/movements`)
      .set('Cookie', cookie)
      .expect(200);

    await agent
      .post(`/api/v1/inventory/variants/${variantId}/adjust`)
      .set('Cookie', cookie)
      .send({ warehouse: 'china', delta: 3, note: 'wh scope in' })
      .expect(201);
    await agent
      .post(`/api/v1/inventory/variants/${variantId}/adjust`)
      .set('Cookie', cookie)
      .send({ warehouse: 'canada', delta: 1 })
      .expect(403);
    await agent
      .post('/api/v1/inventory/stocktake-batch')
      .set('Cookie', cookie)
      .send({
        entries: [
          { itemVariantId: variantId, warehouse: 'canada', countedQuantity: 0 },
        ],
      })
      .expect(403);
  });
});
