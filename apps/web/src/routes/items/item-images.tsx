import { useState } from "react";
import { useTranslation } from "react-i18next";
import { isImageSource, thumbnailUrl } from "./image-sources";
import { SafeImage } from "./safe-image";
export { SafeImage } from "./safe-image";
import { ImagePreview } from "./image-preview";
import { imageUrls } from "./image-urls-editor";

/** Mount at most six remote images per page; the viewer reuses a selected URL. */
export function ItemImages({
  images,
  name,
  title,
}: {
  images: unknown;
  name: string;
  title?: string;
}) {
  const { t } = useTranslation();
  const urls = imageUrls(images).filter(isImageSource);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const pageCount = Math.ceil(urls.length / 6);
  const currentPage = Math.min(page, Math.max(0, pageCount - 1));
  return (
    <section className="mt-5 rounded-xl border border-ink/10 bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-semibold">
          {title ?? t("items.gallery")}{" "}
          <span className="text-sm font-normal text-slate-400">
            ({urls.length})
          </span>
        </h2>
        {pageCount > 1 && (
          <div className="flex items-center gap-3 text-sm">
            <button
              type="button"
              disabled={currentPage === 0}
              onClick={() => setPage(currentPage - 1)}
            >
              {t("common.previous")}
            </button>
            <span>
              {currentPage + 1} / {pageCount}
            </span>
            <button
              type="button"
              disabled={currentPage + 1 >= pageCount}
              onClick={() => setPage(currentPage + 1)}
            >
              {t("common.next")}
            </button>
          </div>
        )}
      </div>
      {urls.length === 0 ? (
        <p className="text-sm text-slate-400">{t("items.noImages")}</p>
      ) : (
        <div className="flex flex-wrap gap-3">
          {urls
            .slice(currentPage * 6, currentPage * 6 + 6)
            .map((url, index) => (
              <button
                key={`${url}-${index}`}
                type="button"
                aria-label={t("items.viewImage", {
                  number: currentPage * 6 + index + 1,
                })}
                onClick={() => setSelected(currentPage * 6 + index)}
                className="overflow-hidden rounded-lg border border-ink/10 focus-visible:outline-2"
              >
                <SafeImage
                  key={url}
                  src={thumbnailUrl(url)}
                  alt={`${name} ${currentPage * 6 + index + 1}`}
                  className="h-24 w-24 object-contain"
                />
              </button>
            ))}
        </div>
      )}
      {selected !== null && (
        <ImagePreview
          urls={urls}
          name={name}
          initialIndex={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </section>
  );
}
