// Demo seed: resets ALL business data and builds the minimal demo set used
// for acceptance testing:
//   - 1 connected store (Demo Shopify), review policy at global defaults
//   - 1 platform listing (1 variant) + 1 official order imported through the
//     real sync pipeline (records shaped exactly like production)
//   - 1 internal item with 1 variant (the mapping target)
//
// Identity data (Better Auth users, roles) is preserved. Run via:
//   pnpm --filter @om/api demo:seed
// The simulated platform starts EMPTY in this flow (SIM_ADAPTER_FIXTURES=none)
// so the database and the platform stay consistent; push further platform
// events through the Stores page simulator or the inject endpoints.
//
// No Nest container here: tsx cannot emit the decorator metadata Nest DI
// requires, so the few collaborators are constructed directly.

import { Prisma } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuditService } from '../src/audit/audit.service';
import { SyncService } from '../src/sync/sync.service';
import { SimulatedAdapter } from '../src/platforms/simulated.adapter';
import { PLATFORM_CAPABILITIES } from '../src/stores/stores.service';
import { generateItemCode } from '../src/items/item-code';

async function main(): Promise<void> {
  // Keep the in-process adapter consistent with the API process: empty start.
  process.env.SIM_ADAPTER_FIXTURES = 'none';

  const prisma = new PrismaService();
  await prisma.$connect();
  const sync = new SyncService(prisma, new AuditService(prisma));
  const adapter = new SimulatedAdapter();

  // 1. Wipe business data (identity tables stay).
  await prisma.$transaction([
    prisma.reviewRecord.deleteMany(),
    prisma.orderRevision.deleteMany(),
    prisma.orderLink.deleteMany(),
    prisma.shipmentRevision.deleteMany(),
    prisma.shipment.deleteMany(),
    prisma.noteRevision.deleteMany(),
    prisma.note.deleteMany(),
    prisma.attachment.deleteMany(),
    prisma.orderLine.deleteMany(),
    prisma.order.deleteMany(),
    prisma.listingContentVersion.deleteMany(),
    prisma.listingVariant.deleteMany(),
    prisma.listing.deleteMany(),
    prisma.itemContentVersion.deleteMany(),
    prisma.itemVariant.deleteMany(),
    prisma.item.deleteMany(),
    prisma.auditEvent.deleteMany(),
    prisma.trackingProvider.deleteMany(),
    prisma.carrier.deleteMany(),
    prisma.store.deleteMany(),
  ]);

  // 2. The one platform listing (1 variant) the demo works with.
  adapter.injectListing({
    externalListingId: 'SIM-LST-100',
    status: 'active',
    title: 'Sim Flip Keyboard',
    sourceUpdatedAt: new Date().toISOString(),
    variants: [
      {
        externalVariantId: 'KEY-BLACK',
        externalSku: 'SIM-SKU-BLACK',
        optionValues: { color: 'black' },
      },
    ],
  });

  // 3. Store with review disabled for the initial import (merges directly).
  const store = await prisma.store.create({
    data: {
      platform: 'shopify',
      displayName: 'Demo Shopify',
      externalShopName: 'demo.myshopify.com',
      connectionState: 'connected',
      capabilities: PLATFORM_CAPABILITIES.shopify as Prisma.InputJsonValue,
      reviewPolicy: {
        orders: { new: false, updates: false },
        listings: { new: false, updates: false },
      },
    },
  });

  // 4. Internal catalog: one item, one variant (the mapping target).
  const item = await prisma.item.create({
    data: {
      name: 'Sim Flip Keyboard',
      description: 'Internal demo item for mapping acceptance.',
      createdBy: 'demo-seed',
      variants: {
        create: [
          { itemCode: generateItemCode(), name: 'Black', optionValues: { color: 'black' } },
        ],
      },
    },
    include: { variants: true },
  });
  console.log(
    `Item ${item.name}: ${item.variants.map((v) => `${v.name}=${v.itemCode}`).join(', ')}`,
  );

  // 5. The one platform order, imported through the real sync pipeline.
  adapter.injectOrder({
    externalOrderId: 'SIM-ORD-1001',
    displayNumber: '#1001',
    statusRaw: { financialStatus: 'paid' },
    customer: { name: 'Alice Wang', email: 'alice@example.com' },
    sourceUpdatedAt: new Date().toISOString(),
    lines: [
      {
        externalLineId: 'SIM-ORD-1001-L1',
        title: 'Sim Flip Keyboard',
        quantity: 1,
        listingExternalId: 'SIM-LST-100',
        variantExternalId: 'KEY-BLACK',
      },
    ],
  });

  const summary = await sync.runStoreSync(store, await adapter.fetchListings(), await adapter.fetchOrders());
  console.log('Initial import:', JSON.stringify(summary));

  // 6. Drop the review override: future syncs follow global defaults (review on).
  await prisma.store.update({
    where: { id: store.id },
    data: { reviewPolicy: Prisma.JsonNull },
  });

  const counts = {
    stores: await prisma.store.count(),
    listings: await prisma.listing.count(),
    orders: await prisma.order.count(),
    items: await prisma.item.count(),
    pendingReviews: await prisma.reviewRecord.count({ where: { status: 'pending' } }),
  };
  console.log('Demo data ready:', JSON.stringify(counts));
  console.log('Store id:', store.id);

  // 7. Mirror the platform state into the RUNNING API's in-memory adapter so
  //    order-update pushes from the Stores-page simulator find these orders.
  //    The API adapter holds SIM-ORD-1002 (the pending new order for the
  //    review-flow scenario); 1001 is injected so "push update" can find it.
  const base = process.env.API_BASE_URL ?? 'http://localhost:3001';
  try {
    const loginRes = await fetch(`${base}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: process.env.ADMIN_EMAIL ?? 'admin@example.com',
        password: process.env.ADMIN_PASSWORD ?? '',
      }),
    });
    if (!loginRes.ok) throw new Error(`login failed (${loginRes.status})`);
    const cookie = (loginRes.headers.getSetCookie?.() ?? []).join('; ');
    const inject = async (order: ExternalOrderShape) => {
      const res = await fetch(`${base}/api/v1/platform/simulate/inject-order`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({
          externalOrderId: order.externalOrderId,
          displayNumber: order.displayNumber,
          customerName: order.customer.name,
          customerEmail: order.customer.email,
          lines: order.lines.map((line) => ({
            title: line.title,
            quantity: line.quantity,
            listingExternalId: line.listingExternalId,
            variantExternalId: line.variantExternalId,
          })),
        }),
      });
      if (!res.ok) throw new Error(`inject ${order.externalOrderId} failed (${res.status})`);
    };
    await inject(PLATFORM_ORDER_1001);
    await inject(PLATFORM_ORDER_1002);
    console.log('Platform state injected into the running API (1001, 1002).');
  } catch (error) {
    console.warn(
      `Could not reach the running API at ${base} (${String(error)}).`,
      'Start the API and push the demo orders via the simulator, or rerun this seed.',
    );
  }

  await prisma.$disconnect();
}

interface ExternalOrderShape {
  externalOrderId: string;
  displayNumber: string;
  customer: { name: string; email: string };
  lines: Array<{
    title: string;
    quantity: number;
    listingExternalId: string;
    variantExternalId: string;
  }>;
}

const PLATFORM_ORDER_1001: ExternalOrderShape = {
  externalOrderId: 'SIM-ORD-1001',
  displayNumber: '#1001',
  customer: { name: 'Alice Wang', email: 'alice@example.com' },
  lines: [
    {
      title: 'Sim Flip Keyboard',
      quantity: 1,
      listingExternalId: 'SIM-LST-100',
      variantExternalId: 'KEY-BLACK',
    },
  ],
};

const PLATFORM_ORDER_1002: ExternalOrderShape = {
  externalOrderId: 'SIM-ORD-1002',
  displayNumber: '#1002',
  customer: { name: 'Bob Test', email: 'bob@example.com' },
  lines: [
    {
      title: 'Sim Flip Keyboard',
      quantity: 1,
      listingExternalId: 'SIM-LST-100',
      variantExternalId: 'KEY-BLACK',
    },
  ],
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
