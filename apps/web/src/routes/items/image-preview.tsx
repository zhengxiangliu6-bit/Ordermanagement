import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { displayUrl, isImageSource, thumbnailUrl } from "./image-sources";
import { imageUrls } from "./image-urls-editor";
import { SafeImage } from "./safe-image";

/** One display image at a time, shared by galleries and compact row previews. */
export function ImagePreview({
  urls,
  name,
  initialIndex = 0,
  onClose,
}: {
  urls: string[];
  name: string;
  initialIndex?: number;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [index, setIndex] = useState(initialIndex);
  const current = Math.min(index, urls.length - 1);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, []);
  if (!urls.length) return null;
  const url = displayUrl(urls[current]);
  return createPortal(
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={t("items.previewImagesFor", { name })}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-black/85 p-4 text-white sm:p-6"
      onClick={(event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          setIndex(Math.max(0, current - 1));
        }
        if (event.key === "ArrowRight") {
          event.preventDefault();
          setIndex(Math.min(urls.length - 1, current + 1));
        }
        if (event.key === "Tab") {
          const controls = dialogRef.current?.querySelectorAll<HTMLElement>(
            "button:not(:disabled), a[href]",
          );
          if (!controls?.length) return;
          const first = controls[0],
            last = controls[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          }
          if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }
      }}
    >
      <div className="flex w-full max-w-4xl items-center justify-between gap-4">
        <p className="min-w-0 truncate text-sm">{name}</p>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className="shrink-0 rounded border border-white/60 px-3 py-2"
        >
          {t("common.close")}
        </button>
      </div>
      <SafeImage
        key={url}
        src={url}
        alt={`${name} ${current + 1}`}
        className="min-h-0 max-h-[70vh] max-w-full object-contain"
      />
      <div className="flex items-center gap-4 text-sm">
        {urls.length > 1 && (
          <button
            type="button"
            disabled={current === 0}
            onClick={() => setIndex(current - 1)}
            className="rounded border border-white/60 px-3 py-2 disabled:opacity-40"
          >
            {t("common.previous")}
          </button>
        )}
        <span aria-live="polite">
          {current + 1} / {urls.length}
        </span>
        {urls.length > 1 && (
          <button
            type="button"
            disabled={current + 1 === urls.length}
            onClick={() => setIndex(current + 1)}
            className="rounded border border-white/60 px-3 py-2 disabled:opacity-40"
          >
            {t("common.next")}
          </button>
        )}
        <a href={url} target="_blank" rel="noreferrer" className="underline">
          {t("items.openOriginal")}
        </a>
      </div>
    </div>,
    document.body,
  );
}

export function ImagePreviewButton({
  images,
  name,
}: {
  images: unknown;
  name: string;
}) {
  const { t } = useTranslation();
  const urls = imageUrls(images).filter(isImageSource);
  const [open, setOpen] = useState(false);
  if (!urls.length) return null;
  return (
    <>
      <button
        type="button"
        aria-label={t("items.previewImagesFor", { name })}
        className="relative h-10 w-10 shrink-0 cursor-zoom-in rounded border border-ink/10 focus-visible:outline-2"
        onClick={(event) => {
          event.stopPropagation();
          setOpen(true);
        }}
      >
        <SafeImage
          key={urls[0]}
          src={thumbnailUrl(urls[0])}
          alt={name}
          className="h-full w-full rounded object-contain"
        />
        {urls.length > 1 && (
          <span className="absolute -bottom-1 -right-1 rounded bg-ink px-1 text-[10px] text-white">
            +{urls.length - 1}
          </span>
        )}
      </button>
      {open && (
        <ImagePreview urls={urls} name={name} onClose={() => setOpen(false)} />
      )}
    </>
  );
}
