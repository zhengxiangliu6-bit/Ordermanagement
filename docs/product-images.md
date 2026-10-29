# System product images

Product and variant forms now upload images to the Order Management API. An external image link means the file remains on a third-party server (for example a Shopify CDN); that third party controls its size and availability. Existing links are still supported. They are not fetched or migrated automatically. Upload a local copy you are entitled to use to make it independent of the third party.

## Processing and storage

- `POST /api/v1/item-images` accepts one multipart `file` per request. The UI accepts multiple files (up to 20 per selection) and uploads them sequentially, retaining successes when another file fails.
- Static JPEG, PNG and WebP only; SVG, animated images, invalid files, files above 10 MiB and images above 24 megapixels are rejected. Validation inspects actual image contents, not just the filename or declared MIME type.
- Sharp applies orientation, removes input metadata (including EXIF/GPS), fits a display image within 1600 × 1600 without enlargement, and encodes WebP quality 80. It derives a thumbnail within 320 × 320 at quality 72. The original upload is discarded.
- Stored bytes depend on picture detail; there is no promised fixed compression ratio. Typical thumbnail decode memory is at most 320 × 320 × 4 bytes (about 400 KiB), rather than decoding camera originals for every preview.
- A SHA-256 digest of the optimized display content determines its immutable storage key. Identical optimized content shares files across uploads. At most two images are processed concurrently per API instance; further processing requests get 429 and can be retried.
- Files live under `ATTACHMENTS_DIR/catalog-images/<digest>/display.webp` and `thumbnail.webp`. File writes use a temporary file and atomic rename to prevent readers seeing partial writes. No original filename is used as a filesystem path.
- Database `Item.images` / `ItemVariant.images` continue storing arrays of strings, now containing same-origin `/api/v1/item-images/<digest>/display.webp` addresses. No database schema change or migration is required. Historical product snapshots keep their image addresses.
- Reads require an authenticated session and a supported catalog/order/shipping/inventory permission. Uploads require `items:create` or `items:update`. Images are served as `image/webp` with `nosniff`, private browser caching and ETag revalidation. They are not public static files.
- Catalog and inventory galleries mount at most six thumbnails per page. A display image is requested only when selected. Variant rows and inventory cards request thumbnails. Legacy third-party links have no generated thumbnail, so their original size remains outside this system's control.

## Deployment and backups

1. Install the updated lockfile (`pnpm install --frozen-lockfile`) and rebuild API and web. Sharp includes platform-specific native dependencies; install dependencies on the actual runtime/build platform instead of copying node_modules between operating systems.
2. Local development defaults to `apps/api/data/attachments` when the API starts in its package directory. `ATTACHMENTS_DIR` can point to a different persistent writable directory.
3. `deploy/internal.docker-compose.yml` explicitly sets `ATTACHMENTS_DIR=/data/attachments`, backed by the existing `attachments` named volume. Both attachments and product images use it. Preserve this volume when recreating containers; never use `down -v` to deploy an update. If an existing deployment used another directory, preserve/copy its files before changing that deployment's path.
4. The bundled web Nginx permits multipart requests up to 11 MiB; the API independently enforces a 10 MiB file limit. Apply a matching limit to any additional reverse proxy in front of the app.
5. Back up the image/attachment directory together with the database. A database backup alone cannot restore image content. For multiple API replicas, use shared persistent storage rather than separate container-local disks.
6. Compression and deduplication reduce disk growth; disk space is still finite. Monitor and provision the persistent volume. Uploads made in a cancelled form and removed images are retained: some files may still be referenced by other products, variants or historical snapshots. There is no automatic garbage collector in this change. Do not manually delete files based only on the current product form.

## Verification

- Image module and storage tests use real Sharp encoding, real temporary disk storage and an isolated Nest HTTP application. They cover dimensions, metadata removal, deduplication, unsupported/oversized inputs, path validation, processing capacity, route permissions, 413 upload limits and ETag 304 responses. The HTTP tests use a test session adapter; production authentication remains the application's existing global SessionGuard.
- Frontend tests cover partial batch-upload failure, upload progress/busy state, local thumbnail selection, gallery pagination, variant forms and save errors.
- The new backend module can be compiled and tested independently of Prisma. Full application database validation remains pending the onboarding environment's blocked `binaries.prisma.sh` access; this image implementation introduces no migration prerequisite.
- The existing OpenAPI contract was extended using Swagger metadata generated from the isolated image module, then the frontend schema was regenerated with `pnpm --filter @om/web generate:client`. The standard full regeneration command remains `pnpm generate:api` once the full API environment is available.

## Files changed

This includes the preceding product-screen improvements and the local-upload extension.

| Status | File |
| --- | --- |
| Modified | `apps/api/.env.example` |
| Modified | `apps/api/openapi.json` |
| Modified | `apps/api/package.json` |
| Modified | `apps/api/src/app.module.ts` |
| Modified | `apps/api/src/storage/local-volume.driver.ts` |
| Modified | `apps/web/nginx.conf` |
| Modified | `apps/web/src/api-client/schema.d.ts` |
| Modified | `apps/web/src/i18n/locales/en.ts` |
| Modified | `apps/web/src/i18n/locales/zh.ts` |
| Modified | `apps/web/src/routes/inventory/inventory-page.tsx` |
| Modified | `apps/web/src/routes/inventory/inventory-variant-detail-page.tsx` |
| Modified | `apps/web/src/routes/inventory/naming.ts` |
| Modified | `apps/web/src/routes/items/image-urls-editor.tsx` |
| Modified | `apps/web/src/routes/items/item-detail-page.tsx` |
| Modified | `apps/web/src/routes/items/items-page.tsx` |
| Modified | `deploy/internal.docker-compose.yml` |
| Modified | `package.json` |
| Modified | `pnpm-lock.yaml` |
| New | `apps/api/src/item-images/item-images.controller.ts` |
| New | `apps/api/src/item-images/item-images.module.ts` |
| New | `apps/api/src/item-images/item-images.service.ts` |
| New | `apps/api/src/item-images/item-images.spec.ts` |
| New | `apps/web/src/routes/items/image-sources.ts` |
| New | `apps/web/src/routes/items/item-images.spec.tsx` |
| New | `apps/web/src/routes/items/item-images.tsx` |
| New | `apps/web/src/routes/items/variant-form.spec.tsx` |
| New | `apps/web/src/routes/items/variant-form.tsx` |
| New | `apps/web/src/routes/items/variants-section.spec.tsx` |
| New | `apps/web/src/routes/items/variants-section.tsx` |
| New | `docs/product-images.md` |

## Variant preview follow-up

Variant thumbnails in the product detail table now open a shared image viewer. The viewer supports all of that variant's images, previous/next controls, arrow keys, Escape, focus containment/restoration and page-scroll locking. Only the selected display image is mounted. The existing product/inventory detail gallery uses the same viewer. Preview clicks do not trigger parent row navigation or require item-edit permission.

Modified files in this follow-up:

- `apps/web/src/routes/items/variants-section.tsx`
- `apps/web/src/routes/items/variants-section.spec.tsx`
- `apps/web/src/routes/items/item-images.tsx`
- `apps/web/src/i18n/locales/en.ts`
- `apps/web/src/i18n/locales/zh.ts`
- `docs/product-images.md`

New files:

- `apps/web/src/routes/items/image-preview.tsx`
- `apps/web/src/routes/items/safe-image.tsx`

No database migration. Adding thumbnail preview buttons to the inventory overview and product list remains a proposed follow-up, not part of this fix.

### Confirmed variant-row image rules

A variant row previews only that variant's own images. Multiple images are supported: show the first thumbnail with the additional-image count, then navigate all images in the viewer. If a variant has no images, omit the thumbnail and preview entry entirely, even when its parent product has a cover. Do not fall back to product images in variant rows. Apply the same rule when adding preview buttons to the inventory overview; that overview enhancement is still pending. A regression test covers a variant without images whose parent does have a cover.

## Warehouse detail isolation and overview previews

The two warehouses share the same catalog and page component, while archive status lives on a stock row identified by variant and warehouse. The inventory overview already filtered both catalog archive and the selected warehouse's stock archive; the product inventory detail previously filtered only catalog archive. It now uses the same warehouse-aware visibility rule. A China archive does not hide the variant in Canada. Archived variants remain selectable in historical movement filters, so history is not lost. Low-stock badges on detail screens use only the selected warehouse's stock, and movement placeholders do not reuse a different warehouse's data.

The inventory response now includes variant image arrays and the parent product image field for variant detail. Both warehouse overviews and product inventory detail show clickable, multi-image previews, using only a variant's own images for variant rows. Single-variant inventory detail shows parent and variant galleries separately. The product catalog list has an independent thumbnail column; opening it does not navigate to product detail. Images remain thumbnail-first and display images load only on selection.

No schema change or migration. Regression checks cover China archive vs Canada visibility, global catalog archive, warehouse-scoped stock writes and permissions, image response fields, absent variant previews, multiple-image navigation and product-list preview navigation. Backend repository calls are mocked in these tests; no production database data was changed.

Modified files in this follow-up:

- `apps/api/src/inventory/inventory.service.ts`
- `apps/web/src/i18n/locales/en.ts`
- `apps/web/src/i18n/locales/zh.ts`
- `apps/web/src/routes/inventory/inventory-item-detail-page.tsx`
- `apps/web/src/routes/inventory/inventory-page.tsx`
- `apps/web/src/routes/inventory/inventory-variant-detail-page.tsx`
- `apps/web/src/routes/items/item-images.tsx`
- `apps/web/src/routes/items/items-page.tsx`
- `docs/product-images.md`

New files:

- `apps/api/src/inventory/inventory-images.spec.ts`
- `apps/web/src/routes/inventory/inventory-item-detail-page.spec.tsx`
- `apps/web/src/routes/inventory/warehouse-stock.ts`
- `apps/web/src/routes/items/items-page.spec.tsx`


## Fulfillment, review and mapping image previews

Added previews to 待发货, 待抽检 (including their confirmation dialogs), 未发货订单审核 and 商品映射. The existing shared viewer supports multiple images and shows no variant preview when that variant has no images. Mapping shows platform product, platform variant and system variant images as separate sources, including the selected variant before resolving/remapping. Packing add-ons also show their own current images.

Order line image sources are projected on the API using linked content-version snapshots. A historical snapshot is authoritative even if its variant has no image; current catalog photos are never silently substituted. Only legacy lines without a snapshot use current photos, labeled accordingly. New-order review fetches authoritative order lines in one batch rather than requesting one order per card. Full snapshot documents are not sent to the browser for these previews. Snapshot URLs preserve their recorded references; third-party image bytes are not archived locally and may become unavailable. Uploaded system images remain content-addressed local files.

Shopify product sync now requests up to 20 product images and the variant image, bounded to 1600 pixels per dimension, and stores image links in the existing listing JSON snapshots. Shopify CDN thumbnails request 320-pixel bounds. Other external hosts remain unchanged rather than guessing a provider-specific resize API. Existing image-less historical snapshots are not backfilled with current platform photos.

Deployment: rebuild/restart API, web and Relay Worker together, then run the store's normal synchronization to populate platform images for current listings. No migration or database backfill is required. No live Shopify account was accessed during validation. Frontend workflow tests, image projection/service tests, Shopify adapter tests and Relay tests use fixtures/mocks; image endpoint tests use real local encoding/storage/HTTP. Full API compilation and DB-backed validation remain blocked by the onboarding environment's ungenerated Prisma client: its engine/checksum download from binaries.prisma.sh is denied (403). Checksums/TLS were not disabled; this change does not solve that environment prerequisite.

Files changed in this follow-up:

| Status | File |
| --- | --- |
| Modified | `apps/api/src/item-images/item-images.controller.ts` |
| Modified | `apps/api/src/items/item-variants.controller.ts` |
| Modified | `apps/api/src/items/items.service.ts` |
| Modified | `apps/api/src/mapping/mapping.service.ts` |
| Modified | `apps/api/src/platforms/platform-adapter.ts` |
| Modified | `apps/api/src/platforms/relay-shopify.adapter.spec.ts` |
| Modified | `apps/api/src/platforms/relay-shopify.adapter.ts` |
| Modified | `apps/api/src/review/review.service.ts` |
| Modified | `apps/api/src/shipping/shipping-work.service.ts` |
| Modified | `apps/api/src/sync/sync.service.ts` |
| Modified | `apps/relay-worker/src/shopify/commands.ts` |
| Modified | `apps/web/src/i18n/locales/en.ts` |
| Modified | `apps/web/src/i18n/locales/zh.ts` |
| Modified | `apps/web/src/routes/items/image-sources.ts` |
| Modified | `apps/web/src/routes/mapping/mapping-page.tsx` |
| Modified | `apps/web/src/routes/review/new-order-card.tsx` |
| Modified | `apps/web/src/routes/shipping-work/shipping-work-page.tsx` |
| New | `apps/api/src/orders/order-line-images.spec.ts` |
| New | `apps/api/src/orders/order-line-images.ts` |
| New | `apps/api/src/orders/workflow-images.spec.ts` |
| New | `apps/web/src/routes/items/image-sources.spec.ts` |
| New | `apps/web/src/routes/items/line-image-previews.tsx` |
| New | `apps/web/src/routes/items/workflow-image-previews.spec.tsx` |
| Modified | `docs/product-images.md` |
