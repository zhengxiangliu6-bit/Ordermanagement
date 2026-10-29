import { useState } from "react";
import { useTranslation } from "react-i18next";
import { buttonClasses } from "../../components/ui";
import { ImageUrlsEditor, imageUrls } from "./image-urls-editor";
import type { ItemVariant } from "../../types/item";

export type VariantInput = {
  name: string;
  nameEn: string;
  images: string[];
  optionValues: Record<string, string>;
};
const inputClass =
  "mt-1 w-full min-w-0 rounded-lg border border-ink/20 bg-white px-3 py-2";

/** Shared by create and edit so both workflows expose the same fields. */
export function VariantForm({
  variant,
  busy,
  onSubmit,
  onCancel,
  onUploadBusy,
}: {
  variant?: ItemVariant;
  busy: boolean;
  onSubmit: (value: VariantInput) => void;
  onCancel: () => void;
  onUploadBusy?: (busy: boolean) => void;
}) {
  const { t } = useTranslation();
  const [uploadBusy, setUploadBusy] = useState(false);
  const [images, setImages] = useState(imageUrls(variant?.images));
  const [rows, setRows] = useState(
    Object.entries(variant?.optionValues ?? {}).map(([key, value]) => ({
      key,
      value: String(value),
    })),
  );
  const names = rows.map((row) => row.key.trim());
  const invalid =
    rows.some((row) => !row.key.trim() || !row.value.trim()) ||
    new Set(names).size !== names.length;
  return (
    <form
      className="space-y-5 text-sm"
      onSubmit={(event) => {
        event.preventDefault();
        if (invalid || uploadBusy) return;
        const data = new FormData(event.currentTarget);
        onSubmit({
          name: String(data.get("name")).trim(),
          nameEn: String(data.get("nameEn")).trim(),
          images: images.map((url) => url.trim()).filter(Boolean),
          optionValues: Object.fromEntries(
            rows.map((row) => [row.key.trim(), row.value.trim()]),
          ),
        });
      }}
    >
      <p className="text-sm leading-relaxed text-slate-500">
        {t("items.singleHelp")}
      </p>
      {variant && (
        <p className="rounded-lg bg-slate-50 p-3 font-mono text-xs">
          {t("items.itemCode")}: {variant.itemCode}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="font-medium">
          {t("items.name")} *
          <input
            name="name"
            defaultValue={variant?.name ?? ""}
            required
            pattern=".*\S.*"
            maxLength={200}
            className={inputClass}
          />
        </label>
        <label className="font-medium">
          {t("inventory.nameEnLabel")}
          <input
            name="nameEn"
            defaultValue={variant?.nameEn ?? ""}
            maxLength={200}
            className={inputClass}
          />
        </label>
      </div>
      <fieldset className="space-y-2 rounded-lg border border-ink/10 p-3">
        <legend className="px-1 font-medium">{t("items.optionValues")}</legend>
        <p className="text-xs text-slate-500">{t("items.optionsHelp")}</p>
        {rows.map((row, index) => (
          <div
            key={index}
            className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2"
          >
            <label className="text-xs">
              {t("items.axisName")}
              <input
                aria-label={`${t("items.axisName")} ${index + 1}`}
                value={row.key}
                maxLength={100}
                required
                onChange={(event) =>
                  setRows(
                    rows.map((r, i) =>
                      i === index ? { ...r, key: event.target.value } : r,
                    ),
                  )
                }
                className={inputClass}
                placeholder={t("items.optionNamePlaceholder")}
              />
            </label>
            <label className="text-xs">
              {t("items.options")}
              <input
                aria-label={`${t("items.options")} ${index + 1}`}
                value={row.value}
                required
                onChange={(event) =>
                  setRows(
                    rows.map((r, i) =>
                      i === index ? { ...r, value: event.target.value } : r,
                    ),
                  )
                }
                className={inputClass}
                placeholder={t("items.optionValuePlaceholder")}
              />
            </label>
            <button
              type="button"
              aria-label={t("common.delete")}
              onClick={() => setRows(rows.filter((_, i) => i !== index))}
              className="p-2 text-red-600"
            >
              ×
            </button>
          </div>
        ))}
        {invalid && (
          <p role="alert" className="text-xs text-amber-700">
            {t("items.optionInvalid")}
          </p>
        )}
        <button
          type="button"
          onClick={() => setRows([...rows, { key: "", value: "" }])}
          className={buttonClasses.secondary}
        >
          {t("items.addOption")}
        </button>
      </fieldset>
      <fieldset>
        <legend className="mb-2 font-medium">{t("items.imagesLabel")}</legend>
        <ImageUrlsEditor
          id="variant-images"
          value={images}
          onChange={setImages}
          disabled={busy}
          onBusyChange={(value) => {
            setUploadBusy(value);
            onUploadBusy?.(value);
          }}
        />
      </fieldset>
      <div className="flex justify-end gap-3 border-t border-ink/10 pt-4">
        <button
          type="button"
          disabled={busy || uploadBusy}
          onClick={onCancel}
          className={buttonClasses.secondary}
        >
          {t("common.cancel")}
        </button>
        <button
          type="submit"
          disabled={busy || uploadBusy || invalid}
          className={buttonClasses.primary}
        >
          {busy
            ? t("common.loading")
            : t(variant ? "items.saveChanges" : "items.addVariant")}
        </button>
      </div>
    </form>
  );
}

export type BatchAxis = { name: string; values: string };
export function prepareBatch(rows: BatchAxis[]) {
  const axes = rows.map((row) => ({
    name: row.name.trim(),
    values: [
      ...new Set(
        row.values
          .split(/[,，\n]/)
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    ],
  }));
  const valid =
    axes.length > 0 &&
    axes.length <= 3 &&
    axes.every(
      (axis) =>
        axis.name.length > 0 &&
        axis.name.length <= 100 &&
        axis.values.length > 0 &&
        axis.values.length <= 100,
    ) &&
    new Set(axes.map((axis) => axis.name)).size === axes.length;
  const count = valid
    ? axes.reduce((total, axis) => total * axis.values.length, 1)
    : 0;
  let names = [""];
  if (valid && count <= 200)
    for (const axis of axes)
      names = names.flatMap((name) =>
        axis.values.map((value) => (name ? `${name} / ${value}` : value)),
      );
  else names = [];
  return {
    axes,
    count,
    names,
    valid: valid && count <= 200 && names.every((name) => name.length <= 200),
  };
}

export function BatchVariantForm({
  busy,
  onSubmit,
  onCancel,
}: {
  busy: boolean;
  onSubmit: (axes: { name: string; values: string[] }[]) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<BatchAxis[]>([{ name: "", values: "" }]);
  const batch = prepareBatch(rows);
  return (
    <form
      className="space-y-4 text-sm"
      onSubmit={(event) => {
        event.preventDefault();
        if (batch.valid) onSubmit(batch.axes);
      }}
    >
      <p className="leading-relaxed text-slate-500">{t("items.batchHelp")}</p>
      {rows.map((row, index) => (
        <div
          key={index}
          className="grid gap-3 rounded-lg border border-ink/10 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]"
        >
          <label>
            {t("items.axisName")}
            <input
              value={row.name}
              required
              maxLength={100}
              onChange={(event) =>
                setRows(
                  rows.map((r, i) =>
                    i === index ? { ...r, name: event.target.value } : r,
                  ),
                )
              }
              placeholder={t("items.axisNamePlaceholder")}
              className={inputClass}
            />
          </label>
          <label>
            {t("items.axisValues")}
            <input
              value={row.values}
              required
              onChange={(event) =>
                setRows(
                  rows.map((r, i) =>
                    i === index ? { ...r, values: event.target.value } : r,
                  ),
                )
              }
              placeholder={t("items.axisValuesPlaceholder")}
              className={inputClass}
            />
          </label>
          <button
            type="button"
            aria-label={t("common.delete")}
            disabled={rows.length === 1}
            onClick={() => setRows(rows.filter((_, i) => i !== index))}
            className="self-end p-2 text-red-600 disabled:opacity-30"
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        disabled={rows.length >= 3}
        onClick={() => setRows([...rows, { name: "", values: "" }])}
        className={buttonClasses.secondary}
      >
        {t("items.addAxis")}
      </button>
      <div className="rounded-lg bg-slate-50 p-3">
        <p className="font-medium">
          {t("items.batchPreview", { count: batch.count })}
        </p>
        {!batch.valid ? (
          <p className="mt-1 text-xs text-amber-700">
            {t("items.batchInvalid")}
          </p>
        ) : (
          <>
            <p className="mt-2 text-xs text-slate-500">
              {t("items.batchNames")}
            </p>
            <ul className="mt-1 space-y-1">
              {batch.names.slice(0, 6).map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
            {batch.count > 6 && <p>… +{batch.count - 6}</p>}
          </>
        )}
      </div>
      <div className="flex justify-end gap-3 border-t border-ink/10 pt-4">
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className={buttonClasses.secondary}
        >
          {t("common.cancel")}
        </button>
        <button
          type="submit"
          disabled={busy || !batch.valid}
          className={buttonClasses.primary}
        >
          {busy ? t("common.loading") : t("items.batchGenerate")}
        </button>
      </div>
    </form>
  );
}
