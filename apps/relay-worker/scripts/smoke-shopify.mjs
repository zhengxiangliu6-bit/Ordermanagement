#!/usr/bin/env node
/**
 * Manual smoke test against the real Shopify store (no mocks).
 *
 * Reads the same environment as the worker (apps/relay-worker/.env via
 * --env-file) and exercises the command surface end to end: token exchange,
 * scopes check, first page of products, first page of orders.
 *
 * Usage (from the repository root):
 *   pnpm --filter @om/relay-worker build
 *   node --env-file=apps/relay-worker/.env apps/relay-worker/scripts/smoke-shopify.mjs
 *
 * Never prints credentials; exit code 0 only when everything succeeded.
 */
import { loadConfig } from "../dist/config.js";
import {
  ORDERS_QUERY,
  PRODUCTS_QUERY,
  SCOPES_QUERY,
  ShopifyCommands,
} from "../dist/shopify/commands.js";

const config = loadConfig();
if (!config.shopify) {
  console.error(
    "Shopify is not configured: set SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET / SHOPIFY_SHOP_DOMAIN in apps/relay-worker/.env",
  );
  process.exit(1);
}

const commands = new ShopifyCommands(config.shopify);
const REQUIRED_SCOPES = [
  "read_orders",
  "read_products",
  "write_fulfillments",
  "read_merchant_managed_fulfillment_orders",
  "write_merchant_managed_fulfillment_orders",
];

const scopes = await commands.run("scopes.check", {});
if (scopes.status !== "succeeded") {
  console.error(`scopes.check failed: ${JSON.stringify(scopes.error)}`);
  process.exit(1);
}
console.log("shop:", JSON.stringify(scopes.response.shop));
const granted = scopes.response.accessScopes;
const missing = REQUIRED_SCOPES.filter((s) => !granted.includes(s));
console.log("scopes granted:", granted.join(", "));
if (missing.length > 0) {
  console.error(
    `missing scopes (approve the app Update in the store admin): ${missing.join(", ")}`,
  );
  process.exit(1);
}

const products = await commands.run("products.fetch", {});
if (products.status !== "succeeded") {
  console.error(`products.fetch failed: ${JSON.stringify(products.error)}`);
  process.exit(1);
}
const productList = products.response.products;
console.log(`products fetched: ${productList.length}`);
for (const p of productList.slice(0, 5)) {
  const skus = (p.variants?.nodes ?? [])
    .map((v) => v.sku ?? "(no sku)")
    .join(", ");
  console.log(`  - ${p.title} [${p.status}] variants: ${skus}`);
}

const orders = await commands.run("orders.fetch", {});
if (orders.status !== "succeeded") {
  console.error(`orders.fetch failed: ${JSON.stringify(orders.error)}`);
  process.exit(1);
}
const orderList = orders.response.orders;
console.log(`orders fetched: ${orderList.length}`);
for (const o of orderList.slice(0, 5)) {
  const fulfilled = (o.fulfillments ?? [])
    .flatMap((f) => (f.trackingInfo ?? []).map((t) => t.number ?? "?"))
    .join(", ");
  console.log(
    `  - ${o.name} ${o.displayFinancialStatus ?? "-"}/${o.displayFulfillmentStatus ?? "-"} lines:${o.lineItems?.nodes?.length ?? 0} tracking:[${fulfilled || "none"}]`,
  );
}

console.log("smoke OK");
