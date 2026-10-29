import { useState } from "react";
import { useTranslation } from "react-i18next";
import { displayUrl, isImageSource, thumbnailUrl } from "./image-sources";
import { imageUrls } from "./image-urls-editor";

export function SafeImage({
  src,
  alt,
  className = "",
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);
  return failed || !isImageSource(src) ? (
    <span
      role="img"
      aria-label={t("items.imageFailed")}
      className={`flex items-center justify-center bg-slate-100 p-2 text-center text-xs text-slate-500 ${className}`}
    >
      {t("items.imageFailed")}
    </span>
  ) : (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={className}
    />
  );
}

/** Mount at most six remote images per page; the viewer reuses a selected URL. */
export function ItemImages({
  images,
  name,
}: {
  images: unknown;
  name: string;
}) {
  const { t } = useTranslation();
  const urls = imageUrls(images).filter(isImageSource);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const pageCount = Math.ceil(urls.length / 6);
  const currentPage = Math.min(page, Math.max(0, pageCount - 1));
  return (
    <section className="mt-5 rounded-xl border border-ink/10 bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-semibold">
          {t("items.gallery")}{" "}
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
                onClick={() => setSelected(displayUrl(url))}
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
      {selected && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t("items.gallery")}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/85 p-6"
          onClick={() => setSelected(null)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setSelected(null);
          }}
        >
          <button
            type="button"
            autoFocus
            onClick={() => setSelected(null)}
            className="rounded border border-white px-4 py-2 text-white"
          >
            {t("common.close")}
          </button>
          <SafeImage
            key={selected}
            src={selected}
            alt={name}
            className="max-h-[75vh] max-w-full object-contain"
          />
          <a
            href={selected}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => event.stopPropagation()}
            className="text-sm text-white underline"
          >
            {t("items.openOriginal")}
          </a>
        </div>
      )}
    </section>
  );
}
