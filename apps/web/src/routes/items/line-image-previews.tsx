import { useTranslation } from "react-i18next";
import { ImagePreviewButton } from "./image-preview";
import { imageUrls } from "./image-urls-editor";

export interface LineImageData {
  variantImages?: unknown;
  productImages?: unknown;
  currentVariantImages?: unknown;
  currentProductImages?: unknown;
  variantImageSource?: "snapshot" | "current";
  platformVariantImages?: unknown;
  currentPlatformVariantImages?: unknown;
  currentPlatformProductImages?: unknown;
  platformProductImages?: unknown;
}

/** Explicit source labels prevent a product cover being mistaken for a variant photo. */
export function LineImagePreviews({
  line,
  name,
}: {
  line: LineImageData;
  name: string;
}) {
  const { t } = useTranslation();
  const groups = [
    {
      images: line.variantImages,
      label: t(
        line.variantImageSource === "snapshot"
          ? "images.systemSnapshot"
          : "images.systemCurrent",
      ),
    },
    { images: line.productImages, label: t("images.productSnapshot") },
    { images: line.currentVariantImages, label: t("images.systemCurrent") },
    { images: line.currentProductImages, label: t("images.productCurrent") },
    { images: line.platformVariantImages, label: t("images.platformVariant") },
    { images: line.platformProductImages, label: t("images.platformProduct") },
    {
      images: line.currentPlatformVariantImages,
      label: t("images.platformVariantCurrent"),
    },
    {
      images: line.currentPlatformProductImages,
      label: t("images.platformProductCurrent"),
    },
  ].filter((group) => imageUrls(group.images).length > 0);
  if (!groups.length) return null;
  return (
    <div className="flex flex-wrap items-start gap-3">
      {groups.map((group) => (
        <div key={group.label} className="flex items-center gap-2">
          <ImagePreviewButton
            images={group.images}
            name={`${name} · ${group.label}`}
          />
          <span className="max-w-28 text-xs text-slate-500">{group.label}</span>
        </div>
      ))}
    </div>
  );
}
