import { isStoredImage, thumbnailUrl } from "./image-sources";
import { useState } from "react";
import { useTranslation } from "react-i18next";

/** Local uploads use small thumbnails; legacy external previews are opt-in. */
export function ImageUrlsEditor({
  id,
  value,
  onChange,
  onBusyChange,
  disabled = false,
}: {
  id: string;
  value: string[];
  onChange: (next: string[]) => void;
  onBusyChange?: (busy: boolean) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [progress, setProgress] = useState("");
  const [showLinks, setShowLinks] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const uploadFiles = async (files: File[]) => {
    if (!files.length || uploading) return;
    setUploading(true);
    onBusyChange?.(true);
    setUploadError("");
    const uploaded: string[] = [];
    const failures: string[] = [];
    try {
      if (files.length > 20) {
        setUploadError(t("items.uploadBatchLimit"));
        return;
      }
      for (const [index, file] of files.entries()) {
        setProgress(
          t("items.uploadProgress", {
            current: index + 1,
            total: files.length,
          }),
        );
        if (file.size > 10 * 1024 * 1024) {
          failures.push(`${file.name}: ${t("items.uploadTooLarge")}`);
          continue;
        }
        const body = new FormData();
        body.append("file", file);
        try {
          const response = await fetch("/api/v1/item-images", {
            method: "POST",
            credentials: "same-origin",
            body,
          });
          if (!response.ok) {
            failures.push(
              `${file.name}: ${t("items.uploadFailed", { status: response.status })}`,
            );
            continue;
          }
          const data = (await response.json()) as { url?: unknown };
          if (typeof data.url !== "string" || !isStoredImage(data.url))
            throw new Error("Invalid image response");
          uploaded.push(data.url);
        } catch {
          failures.push(`${file.name}: ${t("items.networkError")}`);
        }
      }
      // Keep successfully uploaded images even if some files fail.
      if (uploaded.length) onChange([...new Set([...value, ...uploaded])]);
      if (failures.length) setUploadError(failures.join("\n"));
    } finally {
      setProgress("");
      setUploading(false);
      onBusyChange?.(false);
    }
  };
  return (
    <fieldset disabled={uploading || disabled} className="min-w-0 space-y-3">
      <label className="block rounded-lg border border-dashed border-ink/20 bg-slate-50 p-3">
        <span className="mb-2 block font-medium">
          {t("items.uploadImages")}
        </span>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          aria-label={t("items.uploadImages")}
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            void uploadFiles(files);
          }}
          className="block w-full min-w-0 text-sm"
        />
      </label>
      {uploading && (
        <p role="status" className="text-sm text-slate-500">
          {progress}
        </p>
      )}
      {uploadError && (
        <p role="alert" className="whitespace-pre-wrap text-sm text-red-600">
          {uploadError}
        </p>
      )}
      <p className="text-xs leading-relaxed text-slate-500">
        {t("items.imageHelp")}
      </p>
      {value.map((url, index) => (
        <div
          key={`${id}-${index}`}
          className="flex flex-wrap items-center gap-2"
        >
          {isStoredImage(url) ? (
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <img
                src={thumbnailUrl(url)}
                alt={t("items.localImage")}
                loading="lazy"
                decoding="async"
                className="h-12 w-12 rounded-lg border border-ink/10 object-contain"
              />
              <span className="text-xs text-slate-500">
                {t("items.localImage")} · {index + 1}
              </span>
            </div>
          ) : (
            <input
              id={index === 0 ? id : `${id}-${index}`}
              type="url"
              pattern="https?://.+"
              maxLength={4096}
              value={url}
              placeholder="https://…"
              aria-label={`${t("items.imagesLabel")} ${index + 1}`}
              onChange={(event) =>
                onChange(
                  value.map((entry, i) =>
                    i === index ? event.target.value : entry,
                  ),
                )
              }
              className="min-w-0 flex-1 rounded-lg border border-ink/20 bg-white px-2 py-1.5"
            />
          )}
          {index === 0 ? (
            <span className="text-xs text-slate-500">{t("items.cover")}</span>
          ) : (
            <button
              type="button"
              onClick={() =>
                onChange([url, ...value.filter((_, i) => i !== index)])
              }
              className="text-xs text-slate-600"
            >
              {t("items.makeCover")}
            </button>
          )}
          <button
            type="button"
            disabled={!isStoredImage(url) && !/^https?:\/\//i.test(url)}
            onClick={() => setPreview(preview === url ? null : url)}
            className="text-xs text-slate-600 disabled:opacity-40"
          >
            {t("items.preview")}
          </button>
          <button
            type="button"
            onClick={() => onChange(value.filter((_, i) => i !== index))}
            className="rounded border border-red-300 px-2 py-1 text-xs text-red-700"
            aria-label={t("items.removeImage")}
          >
            ×
          </button>
        </div>
      ))}
      {preview && value.includes(preview) && (
        <img
          key={preview}
          src={preview}
          alt={t("items.preview")}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className="h-28 max-w-full rounded-lg object-contain"
        />
      )}
      <button
        type="button"
        onClick={() => {
          setShowLinks(true);
          onChange([...value, ""]);
        }}
        className="rounded border border-ink/20 px-2 py-1 text-xs hover:bg-pill"
      >
        + {t(showLinks ? "items.addImage" : "items.addExternalImage")}
      </button>
    </fieldset>
  );
}

export function imageUrls(images: unknown): string[] {
  if (!Array.isArray(images)) return [];
  return images
    .filter(
      (entry): entry is string => typeof entry === "string" && !!entry.trim(),
    )
    .map((url) => url.trim());
}
