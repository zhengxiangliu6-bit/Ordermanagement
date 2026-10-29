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
  return isStoredImage(url)
    ? url.replace(/\/(display|thumbnail)\.webp$/, "/thumbnail.webp")
    : url;
}
export function displayUrl(url: string): string {
  return isStoredImage(url)
    ? url.replace(/\/(display|thumbnail)\.webp$/, "/display.webp")
    : url;
}
