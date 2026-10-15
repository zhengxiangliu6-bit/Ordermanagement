// Writes the OpenAPI contract from the compiled application
// (decorator metadata must come from the SWC/tsc build, not a TS loader).
// Run via: pnpm --filter @om/api export:openapi
"use strict";

const { writeFileSync } = require("node:fs");
const { join } = require("node:path");
// reflect-metadata must be loaded before any Nest module.
require("reflect-metadata");

async function main() {
  const { NestFactory } = require("@nestjs/core");
  const { AppModule } = require("../dist/app.module");
  const { buildOpenApiDocument } = require("../dist/swagger");

  const app = await NestFactory.create(AppModule, {
    logger: ["error", "warn"],
  });
  app.setGlobalPrefix("api/v1");
  // Controllers register during init; the async Better Auth provider makes
  // module resolution complete only at init time, so init before exploring.
  await app.init();
  const document = buildOpenApiDocument(app);
  const outPath = join(__dirname, "..", "openapi.json");
  writeFileSync(outPath, `${JSON.stringify(document, null, 2)}\n`);
  console.log(`OpenAPI contract written to ${outPath}`);
  await app.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
