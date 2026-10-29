import { describe, expect, it, vi } from 'vitest';
import type { RelayClient } from '../relay/relay.client';
import {
  normalizeShopifyOrder,
  normalizeShopifyProduct,
  RelayShopifyAdapter,
  SHOPIFY_REQUIRED_SCOPES,
} from './relay-shopify.adapter';

const PRODUCT_FIXTURE = {
  id: 'gid://shopify/Product/801',
  title: 'The Minimal Snowboard',
  status: 'ACTIVE',
  handle: 'minimal-snowboard',
  updatedAt: '2026-10-11T08:00:00Z',
  descriptionHtml: '<p>Minimal.</p>',
  variants: {
    nodes: [
      { id: 'gid://shopify/ProductVariant/9001', title: 'Default', sku: 'SNO-001', selectedOptions: [{ name: 'Size', value: '154' }] },
      { id: 'gid://shopify/ProductVariant/9002', title: 'No SKU variant', sku: null, selectedOptions: [] },
    ],
  },
};

const ORDER_FIXTURE = {
  id: 'gid://shopify/Order/8062460526885',
  name: '#1002',
  createdAt: '2026-10-05T10:00:00Z',
  updatedAt: '2026-10-09T09:00:00Z',
  cancelledAt: null,
  displayFinancialStatus: 'PAID',
  displayFulfillmentStatus: 'FULFILLED',
  note: 'Please ship before Friday',
  currencyCode: 'USD',
  totalPriceSet: { shopMoney: { amount: '748.00', currencyCode: 'USD' } },
  customer: { firstName: 'Chen', lastName: 'Yu', email: 'chen@example.com', phone: '+8613800000000' },
  shippingAddress: {
    name: 'Chen Yu',
    phone: '+8613800000000',
    address1: '1 Station Rd',
    city: 'Shenzhen',
    zip: '518000',
    provinceCode: 'GD',
    countryCodeV2: 'CN',
  },
  lineItems: {
    nodes: [
      {
        id: 'gid://shopify/LineItem/1',
        quantity: 1,
        name: 'The Minimal Snowboard',
        variant: {
          id: 'gid://shopify/ProductVariant/9001',
          title: 'Default',
          sku: 'SNO-001',
          product: { id: 'gid://shopify/Product/801', title: 'The Minimal Snowboard', status: 'ACTIVE' },
        },
      },
      {
        id: 'gid://shopify/LineItem/2',
        quantity: 1,
        name: 'Gift wrapping',
        variant: null,
      },
    ],
  },
  // fulfillments is a plain list on Shopify (not a connection)
  fulfillments: [{ id: 'gid://shopify/Fulfillment/5', status: 'SUCCESS', createdAt: '2026-10-08T01:00:00Z', trackingInfo: [{ number: 'ZT123', company: 'ZTO', url: null }] }],
};

describe('normalizeShopifyProduct', () => {
  it('maps a product with its variant connection and tolerates null SKUs', () => {
    const listing = normalizeShopifyProduct(PRODUCT_FIXTURE);
    expect(listing).toEqual({
      images: [],
      externalListingId: 'gid://shopify/Product/801',
      status: 'active',
      title: 'The Minimal Snowboard',
      description: '<p>Minimal.</p>',
      sourceUpdatedAt: '2026-10-11T08:00:00Z',
      variants: [
        { images: [], externalVariantId: 'gid://shopify/ProductVariant/9001', title: 'Default', externalSku: 'SNO-001', optionValues: { Size: '154' } },
        { images: [], externalVariantId: 'gid://shopify/ProductVariant/9002', title: 'No SKU variant', externalSku: undefined, optionValues: {} },
      ],
    });
  });

  it('tolerates a missing variants connection', () => {
    const listing = normalizeShopifyProduct({ ...PRODUCT_FIXTURE, variants: null });
    expect(listing.variants).toEqual([]);
  });
});

describe('normalizeShopifyOrder', () => {
  it('maps order fields, addresses, and both line shapes', () => {
    const order = normalizeShopifyOrder(ORDER_FIXTURE);
    expect(order.externalOrderId).toBe('gid://shopify/Order/8062460526885');
    expect(order.displayNumber).toBe('#1002');
    expect(order.statusRaw).toEqual({
      financialStatus: 'PAID',
      fulfillmentStatus: 'FULFILLED',
      cancelledAt: null,
      currency: 'USD',
      totalAmount: '748.00',
      totalCurrency: 'USD',
    });
    expect(order.customer).toEqual({
      name: 'Chen Yu',
      email: 'chen@example.com',
      phone: '+8613800000000',
      addressLine1: '1 Station Rd',
      city: 'Shenzhen',
      postalCode: '518000',
      country: 'CN',
    });
    expect(order.buyerNote).toBe('Please ship before Friday');
    expect(order.platformFulfillments).toEqual([
      {
        externalId: 'gid://shopify/Fulfillment/5',
        status: 'SUCCESS',
        createdAt: '2026-10-08T01:00:00Z',
        tracking: [{ number: 'ZT123', company: 'ZTO', url: null }],
      },
    ]);
    expect(order.lines).toHaveLength(2);
    expect(order.lines[0]).toEqual({
      externalLineId: 'gid://shopify/LineItem/1',
      title: 'The Minimal Snowboard',
      quantity: 1,
      listingExternalId: 'gid://shopify/Product/801',
      variantExternalId: 'gid://shopify/ProductVariant/9001',
    });
    // Variant-less line: falls back to its own ids, empty listing reference.
    expect(order.lines[1]).toEqual({
      externalLineId: 'gid://shopify/LineItem/2',
      title: 'Gift wrapping',
      quantity: 1,
      listingExternalId: '',
      variantExternalId: 'gid://shopify/LineItem/2',
    });
    expect(order.sourceUpdatedAt).toBe('2026-10-09T09:00:00Z');
  });

  it('falls back to the shipping-address name when the customer is null', () => {
    const order = normalizeShopifyOrder({
      ...ORDER_FIXTURE,
      customer: null,
    });
    expect(order.customer.name).toBe('Chen Yu');
    expect(order.customer.email).toBeUndefined();
  });
});

describe('RelayShopifyAdapter', () => {
  it('fetches listings and orders through relay commands', async () => {
    const runCommand = vi.fn().mockResolvedValueOnce({
      response: { products: [PRODUCT_FIXTURE] },
    }).mockResolvedValueOnce({
      response: { orders: [ORDER_FIXTURE] },
    });
    const adapter = new RelayShopifyAdapter({ runCommand } as unknown as RelayClient);

    const listings = await adapter.fetchListings();
    const orders = await adapter.fetchOrders();

    expect(runCommand).toHaveBeenNthCalledWith(1, { kind: 'products.fetch' });
    expect(runCommand).toHaveBeenNthCalledWith(2, { kind: 'orders.fetch' });
    expect(listings[0]?.externalListingId).toBe('gid://shopify/Product/801');
    expect(orders[0]?.displayNumber).toBe('#1002');
  });

  it('lists the scopes the connect flow requires', () => {
    expect(SHOPIFY_REQUIRED_SCOPES).toContain('read_orders');
    expect(SHOPIFY_REQUIRED_SCOPES).toContain('write_fulfillments');
  });
});

it('keeps Shopify product images and each variant image separate', () => {
  const normalized = normalizeShopifyProduct({ ...PRODUCT_FIXTURE, images: { nodes: [{ url: 'https://cdn.example.com/product.jpg' }] }, variants: { nodes: [{ ...PRODUCT_FIXTURE.variants.nodes[0], image: { url: 'https://cdn.example.com/variant.jpg' } }, PRODUCT_FIXTURE.variants.nodes[1]] } });
  expect(normalized.images).toEqual(['https://cdn.example.com/product.jpg']);
  expect(normalized.variants[0].images).toEqual(['https://cdn.example.com/variant.jpg']);
  expect(normalized.variants[1].images).toEqual([]);
});
