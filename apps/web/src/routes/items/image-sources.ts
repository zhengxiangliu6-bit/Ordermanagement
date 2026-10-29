/** Stored URLs stay relative so deployments can move between hosts. */
const storedImage =
  /^\/api\/v1\/item-images\/[a-f0-9]{64}\/(display|thumbnail)\.webp$/;
export function isStoredImage(url: string): boolean {
  return storedImage.test(url);
}
export function isImageSource(url: string): boolean {
  return isStoredImage(url) || /^https?:\/\//i.test(url);
}
export function thumbnailUrl(url: string): string {
  if (isStoredImage(url))
    return url.replace(/\/(display|thumbnail)\.webp$/, "/thumbnail.webp");
  // Shopify CDN supports bounded image transformations. Leave other/signed providers untouched.
  try {
    const image = new URL(url);
    if (
      image.protocol === "https:" &&
      image.hostname === "cdn.shopify.com" &&
      image.pathname.startsWith("/s/files/")
    ) {
      image.searchParams.set("width", "320");
      image.searchParams.set("height", "320");
      return image.toString();
    }
  } catch {
    /* Invalid sources are handled by the image preview component. */
  }
  return url;
}
export function displayUrl(url: string): string {
  return isStoredImage(url)
    ? url.replace(/\/(display|thumbnail)\.webp$/, "/display.webp")
    : url;
}
