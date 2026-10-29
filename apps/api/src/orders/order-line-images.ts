function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function imageLinks(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter(
        (url): url is string =>
          typeof url === 'string' &&
          (/^https?:\/\//i.test(url) ||
            /^\/api\/v1\/item-images\/[a-f0-9]{64}\/display\.webp$/.test(url)),
      ),
    ),
  ];
}
export function platformImages(snapshot: unknown, externalVariantId: string) {
  const data = object(snapshot);
  const variant = Array.isArray(data.variants)
    ? data.variants.find(
        (entry) => object(entry).externalVariantId === externalVariantId,
      )
    : undefined;
  return {
    platformVariantImages: imageLinks(object(variant).images),
    platformProductImages: imageLinks(data.images),
  };
}
export const orderLineImageInclude = {
  itemVariant: {
    select: { id: true, itemCode: true, name: true, images: true },
  },
  itemContentVersion: { select: { snapshot: true } },
  listingVariant: { select: { externalVariantId: true } },
  listingContentVersion: { select: { snapshot: true } },
} as const;

/** Snapshot presence is authoritative: never replace an empty historical image with today's catalog image. */
export function orderLineImages(line: unknown) {
  const data = object(line),
    current = object(data.itemVariant);
  const version = object(data.itemContentVersion);
  const hasSnapshot = version.snapshot != null;
  const snapshot = object(version.snapshot);
  const variant = Array.isArray(snapshot.variants)
    ? snapshot.variants.find(
        (entry) => object(entry).itemCode === current.itemCode,
      )
    : undefined;
  return {
    variantImages: imageLinks(
      hasSnapshot ? object(variant).images : current.images,
    ),
    variantImageSource: hasSnapshot
      ? ('snapshot' as const)
      : ('current' as const),
    ...platformImages(
      object(data.listingContentVersion).snapshot,
      String(object(data.listingVariant).externalVariantId ?? ''),
    ),
  };
}

export function presentOrderLineImages<T extends object>(line: T) {
  return {
    ...line,
    ...orderLineImages(line),
    itemContentVersion: undefined,
    listingContentVersion: undefined,
  };
}
