import { thumbnailUrl } from "../items/image-sources";

/**
 * Warehouse product naming: both warehouses show the Chinese and English
 * names together (2026-10-27 ruling; Canada no longer hides the zh name).
 */
export function warehouseDisplayName(
  entity: { name: string; nameEn?: string | null },
  _warehouse?: string,
): string {
  void _warehouse;
  const zh = entity.name ?? "";
  const en = (entity.nameEn ?? "").trim();
  if (en && en !== zh) return `${zh} · ${en}`;
  return zh;
}

export { imageUrls } from "../items/image-urls-editor";

/** First image URL of an images field (string[] or legacy shapes). */
export function firstImageUrl(images: unknown): string | null {
  if (Array.isArray(images)) {
    const url = images.find(
      (entry) => typeof entry === "string" && entry.trim(),
    );
    return typeof url === "string" && url.trim()
      ? thumbnailUrl(url.trim())
      : null;
  }
  if (images && typeof images === "object") {
    const record = images as Record<string, unknown>;
    const url = record.url ?? record.imageUrl;
    if (typeof url === "string" && url.trim()) return thumbnailUrl(url.trim());
  }
  return null;
}
