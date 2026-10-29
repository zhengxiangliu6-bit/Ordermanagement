# Product image previews

## Current preview scope

Image previews are available in the internal product catalog/list/detail, variants, warehouse overview/detail and product mapping. Order detail, shipping-work queues and unfulfilled-order review intentionally do not display image previews or request image snapshots. Order detail keeps the product title, quantity and item code in its purchase records. This scope supersedes the earlier order/workflow-image implementations.

Previews in the supported catalog/inventory/mapping screens retain multiple images, previous/next and keyboard navigation. Lists request thumbnails first; selecting a picture requests a display image. Galleries mount six thumbnails per page. Removing order previews does not delete uploaded files, existing image links or historical database snapshots.

## Upload processing and persistence

- Upload product/variant images using `POST /api/v1/item-images`, one file per request. The UI accepts up to 20 files per selection and sends requests sequentially, preserving successful files on partial failure.
- Static JPEG, PNG and WebP only; up to 10 MiB and 24 megapixels per file. Decode/format validation uses image contents. At most two processing operations run per API instance.
- Sharp normalizes orientation, strips input metadata (including EXIF/GPS), and creates a WebP display image bounded to 1600 × 1600 (quality 80) plus a 320 × 320 thumbnail (quality 72), without enlargement. Original uploads are discarded.
- A SHA-256 digest of optimized display bytes identifies immutable files; matching content is deduplicated. Atomic writes prevent readers seeing partial files.
- Files live under `ATTACHMENTS_DIR/catalog-images/<digest>/display.webp` and `thumbnail.webp`. Existing product/variant JSON fields store relative same-origin image addresses. No database migration is needed.
- Reads require a supported authenticated user; uploads require product creation/update permission. Responses use `image/webp`, `nosniff`, private browser caching and ETag revalidation.
- Legacy external links remain supported. Shopify listing sync reads up to 20 product photos and each variant image with 1600-pixel bounds; Shopify CDN thumbnails use 320-pixel bounds. Other providers are left unchanged. External pictures may fail or disappear; they are not automatically downloaded into local storage.

## Deployment and backups

1. Install locked dependencies (`pnpm install --frozen-lockfile`) and rebuild API and web. Install Sharp dependencies on the actual build/runtime platform.
2. Local API development defaults to `apps/api/data/attachments`. Configure `ATTACHMENTS_DIR` for another persistent writable path. The provided deployment sets `/data/attachments` backed by the existing `attachments` Docker volume. Preserve/migrate an existing custom path before changing it; never remove the volume during deployment.
3. Back up database and image files together. Monitor finite disk space. Removed or abandoned uploads are retained because they may be referenced by other products or historical snapshots; this change includes no automatic garbage collector. Multiple API replicas require shared storage.
4. The bundled Nginx allows 11 MiB multipart requests; the API enforces the exact 10 MiB file limit. Apply compatible limits to any additional reverse proxy.
5. To receive platform photos, deploy the image-capable Relay Worker and run normal store synchronization. Old snapshots are not backfilled; order detail can show clearly labeled current linked-listing photos when available.

## Validation of the latest scope adjustment

38 frontend tests and 8 targeted backend tests passed. Regression checks cover the absence of order-detail/shipping/review image previews and absence of image snapshot/product-image reads in the order-detail endpoint, while mapping previews remain covered. Frontend production build and repository ESLint passed. Backend repository calls were mocked; no production database data was changed.

Full API compilation and DB-backed validation remain blocked by the onboarding environment's ungenerated Prisma client (engine/checksum download from binaries.prisma.sh returns 403). This existing environment prerequisite is separate from database migrations; this adjustment requires no migration.

## Files changed in the latest adjustment

| Status | File |
| --- | --- |
| Modified | `apps/api/src/orders/order-line-images.spec.ts` |
| Modified | `apps/api/src/orders/order-line-images.ts` |
| Modified | `apps/api/src/orders/orders.service.ts` |
| Modified | `apps/api/src/orders/workflow-images.spec.ts` |
| Modified | `apps/web/src/i18n/locales/en.ts` |
| Modified | `apps/web/src/i18n/locales/zh.ts` |
| Modified | `apps/web/src/routes/items/line-image-previews.tsx` |
| Modified | `apps/web/src/routes/items/workflow-image-previews.spec.tsx` |
| Modified | `apps/web/src/routes/orders/order-detail-page.tsx` |
| Modified | `apps/web/src/types/order.ts` |
| Modified | `docs/product-images.md` |
