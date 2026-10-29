#!/usr/bin/env node
/**
 * Shopify field inspector: fetches a few raw products/orders through the
 * same GraphQL client the sync uses, prints the full raw JSON plus a field
 * inventory (every path that came back), and saves the sample to
 * /tmp/opencode/shopify-sample.json for close reading.
 *
 * Usage (from the repository root):
 *   node --env-file=apps/relay-worker/.env apps/relay-worker/scripts/inspect-shopify.mjs
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { loadConfig } from "../dist/config.js";
import { ShopifyGraphqlClient } from "../dist/shopify/graphql-client.js";
import { ShopifyTokenManager } from "../dist/shopify/token.js";
import { ORDERS_QUERY, PRODUCTS_QUERY } from "../dist/shopify/commands.js";

const config = loadConfig();
if (!config.shopify) {
  console.error("Shopify not configured (apps/relay-worker/.env).");
  process.exit(1);
}

const client = new ShopifyGraphqlClient(
  config.shopify,
  new ShopifyTokenManager(config.shopify),
);

const productsData = await client.query(PRODUCTS_QUERY, { first: 2, after: null });
const ordersData = await client.query(ORDERS_QUERY, { first: 2, after: null });

const sample = {
  capturedAt: new Date().toISOString(),
  apiVersion: config.shopify.apiVersion,
  shopDomain: config.shopify.shopDomain,
  products: productsData.products?.nodes ?? [],
  orders: ordersData.orders?.nodes ?? [],
};

mkdirSync("/tmp/opencode", { recursive: true });
writeFileSync("/tmp/opencode/shopify-sample.json", JSON.stringify(sample, null, 2));

/** Walks a value and prints every leaf path with a short example. */
function inventory(value, prefix = "") {
  if (value === null || value === undefined) {
    console.log(`  ${prefix} = null`);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      console.log(`  ${prefix}[] = []`);
      return;
    }
    inventory(value[0], `${prefix}[0]`);
    return;
  }
  if (typeof value === "object") {
    for (const key of Object.keys(value)) {
      inventory(value[key], prefix ? `${prefix}.${key}` : key);
    }
    return;
  }
  const text = String(value);
  console.log(`  ${prefix} = ${text.length > 48 ? `${text.slice(0, 48)}…` : text}`);
}

console.log(`\nShopify raw sample (${sample.shopDomain}, API ${sample.apiVersion})`);
console.log(`Full JSON saved to: /tmp/opencode/shopify-sample.json\n`);

console.log(`== Product fields (first of ${sample.products.length}) ==`);
if (sample.products[0]) inventory(sample.products[0]);

console.log(`\n== Order fields (first of ${sample.orders.length}) ==`);
if (sample.orders[0]) inventory(sample.orders[0]);

console.log("\nDone.");
