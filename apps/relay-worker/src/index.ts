import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { InMemoryRelayStore } from "./store.js";

function main(): void {
  const config = loadConfig();
  const store = new InMemoryRelayStore(config.leaseTtlSeconds * 1000);
  const app = buildApp({ config, store });

  app.listen(config.port, "0.0.0.0", () => {
    console.log(`Relay Worker listening on 0.0.0.0:${config.port}`);
    console.log(`  local: http://localhost:${config.port}/relay/v1/health`);
    console.log(
      `  webhook intake (shopify): ${config.shopifyWebhookSecret ? "enabled" : "disabled (SHOPIFY_WEBHOOK_SECRET not set)"}`,
    );
    console.log(
      `  shopify commands: ${config.shopify ? `enabled (${config.shopify.shopDomain}, API ${config.shopify.apiVersion})` : "disabled (SHOPIFY_CLIENT_ID/SECRET/SHOP_DOMAIN not set)"}`,
    );
  });
}

main();
