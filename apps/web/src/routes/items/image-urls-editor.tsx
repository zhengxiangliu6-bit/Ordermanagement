import { useTranslation } from "react-i18next";

/**
 * One URL per row with a "+" to add more rows: products and variants can
 * carry any number of image links.
 */
export function ImageUrlsEditor({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1.5">
      {value.map((url, index) => (
        <div key={`${id}-${index}`} className="flex items-center gap-1.5">
          <input
            id={index === 0 ? id : `${id}-${index}`}
            type="url"
            value={url}
            placeholder="https://…"
            onChange={(event) => {
              const next = [...value];
              next[index] = event.target.value;
              onChange(next);
            }}
            className="w-full rounded-lg border border-ink/20 bg-white px-2 py-1.5"
          />
          <button
            type="button"
            onClick={() => onChange(value.filter((_, i) => i !== index))}
            className="shrink-0 rounded border border-red-300 px-1.5 py-1 text-xs text-red-700 hover:bg-red-50"
            aria-label={t("items.removeImage")}
            title={t("items.removeImage")}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...value, ""])}
        className="rounded border border-ink/20 px-2 py-1 text-xs hover:bg-pill"
      >
        + {t("items.addImage")}
      </button>
    </div>
  );
}

/** Normalize an images field into a string array for the editor. */
export function imageUrls(images: unknown): string[] {
  if (!Array.isArray(images)) return [];
  return images.filter((entry): entry is string => typeof entry === "string" && !!entry.trim());
}
