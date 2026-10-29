import { useState } from "react";
import { useParams, useRouteLoaderData } from "react-router";
import { useTranslation } from "react-i18next";
import { Modal } from "../../components/modal";
import { buttonClasses } from "../../components/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api-client/client";
import { firstImageUrl } from "../inventory/naming";
import { ImageUrlsEditor, imageUrls } from "./image-urls-editor";
import type { Item } from "../../types/item";
import type { rootLoader } from "../../layouts/root-loader";

function usePermissions(): Set<string> {
  const root = useRouteLoaderData<typeof rootLoader>("root");
  return new Set(root?.user.permissions ?? []);
}

export default function ItemDetailPage() {
  return <ItemDetailContent />;
}

function ItemDetailContent() {
  const { id = "" } = useParams();
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  const { data: item, isLoading, isError, error } = useQuery({
    queryKey: ["item", id],
    queryFn: async () => {
      const { data, response } = await api.GET("/api/v1/items/{id}", {
        params: { path: { id } },
      });
      if (!response.ok || !data) throw new Error(`Load failed (${response.status})`);
      return data as unknown as Item;
    },
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["item", id] });

  if (isLoading) return <p className="text-sm text-slate-400">{t("common.loading")}</p>;
  if (isError) return <p className="text-sm text-red-600">{(error as Error).message}</p>;
  if (!item) return null;

  return (
    <div>
      <ItemHeader item={item} onChanged={refresh} />
      <VariantsSection item={item} onChanged={refresh} />
      <NotesSection item={item} onChanged={refresh} />
    </div>
  );
}

function ItemHeader({ item, onChanged }: { item: Item; onChanged: () => void }) {
  const { t } = useTranslation();
  const permissions = usePermissions();
  const canUpdate = permissions.has("items:update");
  const canArchive = permissions.has("items:archive");
  const canDelete = permissions.has("items:delete");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editImages, setEditImages] = useState<string[]>([]);

  const openEdit = () => {
    setEditImages(imageUrls(item.images));
    setEditing(true);
  };

  const save = async (form: HTMLFormElement) => {
    const formData = new FormData(form);
    setBusy(true);
    await api.PATCH("/api/v1/items/{id}", {
      params: { path: { id: item.id } },
      body: {
        name: String(formData.get("name") ?? "").trim() || undefined,
        nameEn: String(formData.get("nameEn") ?? "").trim(),
        category: String(formData.get("category") ?? "").trim() || undefined,
        description: String(formData.get("description") ?? "").trim() || undefined,
        images: editImages.filter(Boolean)
      },
    });
    setBusy(false);
    setEditing(false);
    onChanged();
  };

  const toggleArchive = async () => {
    setBusy(true);
    if (item.archivedAt) {
      await api.POST("/api/v1/items/{id}/restore", { params: { path: { id: item.id } } });
    } else {
      await api.POST("/api/v1/items/{id}/archive", { params: { path: { id: item.id } } });
    }
    setBusy(false);
    onChanged();
  };

  const remove = async () => {
    if (!window.confirm(t("items.deleteItemConfirm", { name: item.name }))) return;
    setBusy(true);
    await api.DELETE("/api/v1/items/{id}", { params: { path: { id: item.id } } });
    window.location.href = "/items";
  };

  return (
    <div className="flex items-start justify-between">
      <div className="flex items-start gap-3">
        {firstImageUrl(item.images) ? (
          <img
            src={firstImageUrl(item.images) ?? ""}
            alt={item.name}
            onError={(event) => {
              event.currentTarget.style.display = "none";
            }}
            className="h-16 w-16 shrink-0 rounded-lg border border-ink/10 object-cover"
          />
        ) : null}
        <div>
          <h1 className="font-display text-2xl leading-tight text-ink">
            {item.name}
            {item.nameEn && item.nameEn !== item.name ? (
              <span className="ml-2 text-base font-normal text-slate-400">· {item.nameEn}</span>
            ) : null}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {item.category ?? "—"}
            {item.archivedAt ? (
              <span className="ml-2 whitespace-nowrap rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                {t("common.archived")}
              </span>
            ) : null}
          </p>
          {imageUrls(item.images).length > 0 ? (
            <ul className="mt-1 space-y-0.5">
              {imageUrls(item.images).map((url) => (
                <li key={url} className="max-w-md truncate text-xs">
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-indigo-600 underline-offset-2 hover:underline"
                  >
                    {url}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
      <div className="flex gap-2 text-sm">
        {canUpdate ? (
          <button
            type="button"
            onClick={() => (editing ? setEditing(false) : openEdit())}
            className="rounded-lg border border-ink/20 px-2.5 py-1 hover:bg-pill"
          >
            {editing ? t("common.cancel") : t("items.edit")}
          </button>
        ) : null}
        {item.archivedAt ? (
          canUpdate ? (
            <button type="button" disabled={busy} onClick={toggleArchive} className="rounded-lg border border-ink/20 px-2.5 py-1 hover:bg-pill disabled:opacity-40">
              {t("items.restore")}
            </button>
          ) : null
        ) : canArchive ? (
          <button type="button" disabled={busy} onClick={toggleArchive} className="rounded-lg border border-ink/20 px-2.5 py-1 hover:bg-pill disabled:opacity-40">
            {t("items.archiveLabel")}
          </button>
        ) : null}
        {canDelete ? (
          <button type="button" disabled={busy} onClick={remove} className="rounded border border-red-300 px-2.5 py-1 text-red-700 hover:bg-red-50 disabled:opacity-40">
            {t("common.delete")}
          </button>
        ) : null}
      </div>
      {editing ? (
        <div className="absolute mt-24 w-96 rounded border border-slate-200 bg-white p-4 text-sm shadow-sm">
          <form
            className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              void save(event.currentTarget);
            }}
          >
            <label htmlFor="edit-name" className="self-center font-medium">{t("items.name")}</label>
            <input id="edit-name" name="name" defaultValue={item.name} required className="rounded-lg border border-ink/20 bg-white px-2 py-1.5" />
            <label htmlFor="edit-name-en" className="self-center font-medium">{t("inventory.nameEnLabel")}</label>
            <input id="edit-name-en" name="nameEn" defaultValue={item.nameEn ?? ""} className="rounded-lg border border-ink/20 bg-white px-2 py-1.5" />
            <label htmlFor="edit-images" className="self-center font-medium">{t("items.imagesLabel")}</label>
            <ImageUrlsEditor
              id="edit-images"
              value={editImages}
              onChange={setEditImages}
            />
            <label htmlFor="edit-category" className="self-center font-medium">{t("items.category")}</label>
            <input id="edit-category" name="category" defaultValue={item.category ?? ""} className="rounded-lg border border-ink/20 bg-white px-2 py-1.5" />
            <label htmlFor="edit-description" className="self-center font-medium">{t("items.description")}</label>
            <textarea id="edit-description" name="description" rows={3} defaultValue={item.description ?? ""} className="rounded-lg border border-ink/20 bg-white px-2 py-1.5" />
            <div />
            <button type="submit" disabled={busy} className="justify-self-start rounded bg-slate-900 px-3 py-1.5 text-white disabled:opacity-40">
              {t("items.saveChanges")}
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}

type OptionRow = { key: string; value: string };

function rowsToOptionValues(rows: OptionRow[]): Record<string, unknown> | undefined {
  const entries = rows
    .map((row) => [row.key.trim(), row.value.trim()] as const)
    .filter(([key]) => key.length > 0);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function OptionRowsEditor({
  rows,
  onChange,
}: {
  rows: OptionRow[];
  onChange: (rows: OptionRow[]) => void;
}) {
  const { t } = useTranslation();
  const names = rows.map((row) => row.key.trim()).filter((key) => key.length > 0);
  const hasDuplicates = new Set(names).size !== names.length;
  return (
    <div>
      <span className="block text-sm font-medium">{t("items.optionValues")}</span>
      {hasDuplicates ? (
        <p className="mt-1 text-xs text-amber-700" role="alert">
          {t("items.duplicateOptionNames")}
        </p>
      ) : null}
      {rows.map((row, index) => (
        <div key={index} className="mt-1 flex items-center gap-2">
          <input
            value={row.key}
            onChange={(event) =>
              onChange(rows.map((r, i) => (i === index ? { ...r, key: event.target.value } : r)))
            }
            placeholder={t("items.optionNamePlaceholder")}
            className="w-44 rounded-lg border border-ink/20 px-2 py-1"
          />
          <input
            value={row.value}
            onChange={(event) =>
              onChange(rows.map((r, i) => (i === index ? { ...r, value: event.target.value } : r)))
            }
            placeholder={t("items.optionValuePlaceholder")}
            className="w-44 rounded-lg border border-ink/20 px-2 py-1"
          />
          <button
            type="button"
            onClick={() => onChange(rows.filter((_, i) => i !== index))}
            className="text-slate-400 hover:text-red-600"
            aria-label={t("common.delete")}
          >
            ✕
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...rows, { key: "", value: "" }])}
        className="mt-1 text-sm text-slate-500 hover:text-slate-800"
      >
        {t("items.addOption")}
      </button>
    </div>
  );
}

function VariantsSection({ item, onChanged }: { item: Item; onChanged: () => void }) {
  const { t } = useTranslation();
  const permissions = usePermissions();
  const canCreate = permissions.has("items:create");
  const canUpdate = permissions.has("items:update");
  const canArchive = permissions.has("items:archive");
  const canDelete = permissions.has("items:delete");
  const [adding, setAdding] = useState(false);
  const [addMode, setAddMode] = useState<"single" | "batch">("batch");
  const [addRows, setAddRows] = useState<OptionRow[]>([]);
  const [batchAxes, setBatchAxes] = useState<Array<{ name: string; values: string }>>([
    { name: "", values: "" },
  ]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editNameEn, setEditNameEn] = useState("");
  const [editVariantImages, setEditVariantImages] = useState<string[]>([]);
  const [editRows, setEditRows] = useState<OptionRow[]>([]);
  const [busy, setBusy] = useState(false);

  const addVariant = async (form: HTMLFormElement) => {
    const formData = new FormData(form);
    setBusy(true);
    const { response } = await api.POST("/api/v1/items/{id}/variants", {
      params: { path: { id: item.id } },
      body: {
        name: String(formData.get("name") ?? "").trim(),
        nameEn: String(formData.get("nameEn") ?? "").trim(),
        optionValues: rowsToOptionValues(addRows),
      },
    });
    setBusy(false);
    if (!response.ok) return;
    setAdding(false);
    setAddRows([]);
    onChanged();
  };

  const batchCount = batchAxes
    .filter((axis) => axis.name.trim() && axis.values.trim())
    .reduce((product, axis) => product * axis.values.split(/[,，]/).map((v) => v.trim()).filter(Boolean).length, 1);

  const addVariantsBatch = async () => {
    const axes = batchAxes
      .filter((axis) => axis.name.trim() && axis.values.trim())
      .map((axis) => ({
        name: axis.name.trim(),
        values: axis.values.split(/[,，]/).map((value) => value.trim()).filter(Boolean),
      }));
    if (axes.length === 0) return;
    setBusy(true);
    const { response } = await api.POST("/api/v1/items/{id}/variants/batch", {
      params: { path: { id: item.id } },
      body: { axes },
    });
    setBusy(false);
    if (!response.ok) return;
    setAdding(false);
    setBatchAxes([{ name: "", values: "" }]);
    onChanged();
  };

  const startEdit = (
    variantId: string,
    name: string,
    optionValues: Record<string, unknown> | null,
    nameEn = "",
    variantImages: unknown = [],
  ) => {
    setEditingId(variantId);
    setEditName(name);
    setEditNameEn(nameEn);
    setEditVariantImages(imageUrls(variantImages));
    setEditRows(
      Object.entries(optionValues ?? {}).map(([key, value]) => ({
        key,
        value: String(value),
      })),
    );
  };

  const saveEdit = async (variantId: string) => {
    setBusy(true);
    const { response } = await api.PATCH("/api/v1/items/{id}/variants/{variantId}", {
      params: { path: { id: item.id, variantId } },
      body: {
        name: editName.trim(),
        nameEn: editNameEn.trim(),
        images: editVariantImages.filter(Boolean),
        optionValues: rowsToOptionValues(editRows),
      },    });
    setBusy(false);
    if (!response.ok) return;
    setEditingId(null);
    onChanged();
  };

  const archiveVariant = async (variantId: string) => {
    setBusy(true);
    await api.POST("/api/v1/items/{id}/variants/{variantId}/archive", {
      params: { path: { id: item.id, variantId } },
    });
    setBusy(false);
    onChanged();
  };

  const deleteVariant = async (variantId: string) => {
    setBusy(true);
    const { data, response } = await api.DELETE("/api/v1/items/{id}/variants/{variantId}", {
      params: { path: { id: item.id, variantId } },
    });
    setBusy(false);
    if (!response.ok) {
      const detail = (data as { message?: string } | undefined)?.message;
      window.alert(detail ?? t("items.deleteVariantFailed", { status: response.status }));
      return;
    }
    onChanged();
  };

  return (
    <section className="mt-8">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">{t("items.itemVariants")}</h2>
        {canCreate ? (
          <button type="button" onClick={() => setAdding((value) => !value)} className={buttonClasses.secondary}>
            {adding ? t("common.cancel") : t("items.addVariant")}
          </button>
        ) : null}
      </div>
      {adding ? (
        <Modal title={t("items.addVariant")} onClose={() => setAdding(false)}>
        <div className="flex rounded-lg border border-ink/20 text-sm">
          {(["batch", "single"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setAddMode(mode)}
              className={`px-3 py-1 ${
                addMode === mode
                  ? "bg-slate-900 font-medium text-white"
                  : "text-slate-600 hover:bg-pill"
              }`}
            >
              {t(mode === "batch" ? "items.addBatchMode" : "items.addSingleMode")}
            </button>
          ))}
        </div>
        {addMode === "batch" ? (
          <div className="mt-3 space-y-2 text-sm">
            {batchAxes.map((axis, index) => (
              <div key={index} className="flex items-center gap-2">
                <input
                  value={axis.name}
                  onChange={(event) =>
                    setBatchAxes(batchAxes.map((a, i) => (i === index ? { ...a, name: event.target.value } : a)))
                  }
                  placeholder={t("items.axisNamePlaceholder")}
                  className="w-36 rounded-lg border border-ink/20 px-2 py-1"
                />
                <input
                  value={axis.values}
                  onChange={(event) =>
                    setBatchAxes(batchAxes.map((a, i) => (i === index ? { ...a, values: event.target.value } : a)))
                  }
                  placeholder={t("items.axisValuesPlaceholder")}
                  className="flex-1 rounded-lg border border-ink/20 px-2 py-1"
                />
                <button
                  type="button"
                  onClick={() => setBatchAxes(batchAxes.filter((_, i) => i !== index))}
                  className="text-slate-400 hover:text-red-600"
                  aria-label={t("common.delete")}
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setBatchAxes([...batchAxes, { name: "", values: "" }])}
              className="text-sm text-slate-500 hover:text-slate-800"
            >
              {t("items.addAxis")}
            </button>
            <div className="flex items-center justify-end pt-1">
              <span className="text-xs text-slate-400">
                {t("items.batchPreview", { count: batchCount })}
              </span>
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                disabled={busy || batchCount < 1}
                onClick={() => void addVariantsBatch()}
                className="rounded bg-slate-900 px-3 py-1.5 text-white disabled:opacity-40"
              >
                {t("items.batchGenerate")}
              </button>
            </div>
          </div>
        ) : (
        <form
          className="text-sm"
          onSubmit={(event) => {
            event.preventDefault();
            void addVariant(event.currentTarget);
          }}
        >
          <div className="flex items-end gap-3">
            <div>
              <label htmlFor="variant-name" className="block font-medium">{t("inventory.nameZhLabel")}</label>
              <input id="variant-name" name="name" required className="mt-1 rounded-lg border border-ink/20 bg-white px-2 py-1.5" />
            </div>
            <div>
              <label htmlFor="variant-name-en" className="block font-medium">{t("inventory.nameEnLabel")}</label>
              <input id="variant-name-en" name="nameEn" className="mt-1 rounded-lg border border-ink/20 bg-white px-2 py-1.5" />
            </div>
            <button type="submit" disabled={busy} className="rounded bg-slate-900 px-3 py-1.5 text-white disabled:opacity-40">
              {t("items.addVariant")}
            </button>
          </div>
          <div className="mt-3">
            <OptionRowsEditor rows={addRows} onChange={setAddRows} />
          </div>
        </form>
        )}
        </Modal>
      ) : null}
      <div className="mt-3 overflow-hidden rounded-xl border border-ink/10 pop-shadow-sm">
      <table className="w-full border-collapse bg-white text-sm">
        <thead>
          <tr className="border-b border-ink/10 text-left text-xs uppercase tracking-wide text-slate-400">
            <th className="px-4 py-2.5 font-semibold">{t("items.itemCode")}</th>
            <th className="px-3 py-2.5 font-semibold">{t("items.name")}</th>
            <th className="px-3 py-2.5 font-semibold">{t("items.options")}</th>
            <th className="px-3 py-2.5 font-semibold">{t("items.status")}</th>
            <th className="px-3 py-2.5 font-semibold"></th>
          </tr>
        </thead>
        <tbody>
          {item.variants && item.variants.length > 0 ? (
            item.variants.map((variant) =>
              editingId === variant.id ? (
                <tr key={variant.id} className="border-b border-ink/5 last:border-0 hover:bg-pill">
                  <td className="px-3 py-2 font-mono text-xs">{variant.itemCode}</td>
                  <td colSpan={4} className="px-3 py-2">
                    <div className="flex items-end gap-3">
                      <div>
                        <label htmlFor={`edit-variant-name-${variant.id}`} className="block text-xs font-medium">{t("items.name")}</label>
                        <input
                          id={`edit-variant-name-${variant.id}`}
                          value={editName}
                          onChange={(event) => setEditName(event.target.value)}
                          className="mt-1 rounded-lg border border-ink/20 bg-white px-2 py-1.5"
                        />
                      </div>
                      <div>
                        <label htmlFor={`edit-variant-name-en-${variant.id}`} className="block text-xs font-medium">{t("inventory.nameEnLabel")}</label>
                        <input
                          id={`edit-variant-name-en-${variant.id}`}
                          value={editNameEn}
                          onChange={(event) => setEditNameEn(event.target.value)}
                          className="mt-1 rounded-lg border border-ink/20 bg-white px-2 py-1.5"
                        />
                      </div>
                      <div>
                        <span className="block text-xs font-medium">{t("items.imagesLabel")}</span>
                        <div className="mt-1">
                          <ImageUrlsEditor
                            id={`edit-variant-images-${variant.id}`}
                            value={editVariantImages}
                            onChange={setEditVariantImages}
                          />
                        </div>
                      </div>
                      <OptionRowsEditor rows={editRows} onChange={setEditRows} />
                      <div className="ml-auto flex gap-2">
                        <button type="button" disabled={busy} onClick={() => saveEdit(variant.id)} className="rounded bg-slate-900 px-2.5 py-1 text-white disabled:opacity-40">
                          {t("common.save")}
                        </button>
                        <button type="button" onClick={() => setEditingId(null)} className="rounded-lg border border-ink/20 px-2.5 py-1">
                          {t("common.cancel")}
                        </button>
                      </div>
                    </div>
                  </td>
                </tr>
              ) : (
                <tr key={variant.id} className="border-b border-ink/5 last:border-0 hover:bg-pill">
                  <td className="px-3 py-2 font-mono text-xs">{variant.itemCode}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span>
                        {variant.name}
                        {variant.nameEn && variant.nameEn !== variant.name ? (
                          <span className="ml-1.5 text-xs font-normal text-slate-400">
                            · {variant.nameEn}
                          </span>
                        ) : null}
                      </span>
                      {imageUrls(variant.images).length > 0 ? (
                        <span className="inline-flex items-center gap-1">
                          {imageUrls(variant.images).slice(0, 3).map((url) => (
                            <a key={url} href={url} target="_blank" rel="noreferrer" title={url}>
                              <img
                                src={url}
                                alt={variant.name}
                                onError={(event) => {
                                  event.currentTarget.style.display = "none";
                                }}
                                className="h-8 w-8 rounded border border-ink/10 object-cover"
                              />
                            </a>
                          ))}
                          {imageUrls(variant.images).length > 3 ? (
                            <span className="text-xs text-slate-400">
                              +{imageUrls(variant.images).length - 3}
                            </span>
                          ) : null}
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-slate-500">
                    {variant.optionValues
                      ? Object.entries(variant.optionValues)
                          .map(([key, value]) => `${key}: ${String(value)}`)
                          .join(" · ") || "—"
                      : "—"}
                  </td>
                  <td className="px-3 py-2">
                    {variant.archivedAt ? (
                      <span className="text-amber-700">{t("common.archived")}</span>
                    ) : (
                      <span className="text-emerald-700">{t("common.active")}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <span className="flex justify-end gap-3">
                      {!variant.archivedAt ? (
                        <>
                          {canUpdate ? (
                            <button
                              type="button"
                              onClick={() => startEdit(variant.id, variant.name, variant.optionValues, variant.nameEn ?? "", variant.images)}
                              className="text-slate-500 hover:text-slate-800"
                            >
                              {t("common.edit")}
                            </button>
                          ) : null}
                          {canArchive ? (
                            <button type="button" disabled={busy} onClick={() => archiveVariant(variant.id)} className="text-slate-500 hover:text-slate-800 disabled:opacity-40">
                              {t("items.archiveLabel")}
                            </button>
                          ) : null}
                          {canDelete ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => {
                                if (!window.confirm(t("items.deleteVariantConfirm", { name: variant.name }))) return;
                                void deleteVariant(variant.id);
                              }}
                              className="text-red-600 hover:text-red-800 disabled:opacity-40"
                            >
                              {t("common.delete")}
                            </button>
                          ) : null}
                        </>
                      ) : null}
                    </span>
                  </td>
                </tr>
              ),
            )
          ) : (
            <tr>
              <td colSpan={5} className="px-3 py-4 text-slate-400">
                {t("items.noVariantsYet")}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      </div>
    </section>
  );
}

function NotesSection({ item, onChanged }: { item: Item; onChanged: () => void }) {
  const { t } = useTranslation();
  const permissions = usePermissions();
  const canCreate = permissions.has("notes:create");
  const canEdit = permissions.has("notes:edit-own") || permissions.has("notes:edit-all");
  const canDelete = permissions.has("notes:delete");
  const [body, setBody] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);

  const add = async () => {
    if (!body.trim()) return;
    setBusy(true);
    setNoteError(null);
    const { response } = await api.POST("/api/v1/items/{id}/notes", {
      params: { path: { id: item.id } },
      body: { body: body.trim() },
    });
    setBusy(false);
    if (!response.ok) {
      setNoteError(t("items.noteAddFailed", { status: response.status }));
      return;
    }
    setBody("");
    onChanged();
  };

  const saveEdit = async (noteId: string) => {
    if (!editBody.trim()) return;
    setBusy(true);
    setNoteError(null);
    const { response } = await api.PATCH("/api/v1/notes/{id}", {
      params: { path: { id: noteId } },
      body: { body: editBody.trim() },
    });
    setBusy(false);
    if (!response.ok) {
      setNoteError(t("items.noteEditFailed", { status: response.status }));
      return;
    }
    setEditingId(null);
    onChanged();
  };

  const remove = async (noteId: string) => {
    if (!window.confirm(t("items.deleteNoteConfirm"))) return;
    setBusy(true);
    setNoteError(null);
    const { response } = await api.DELETE("/api/v1/notes/{id}", {
      params: { path: { id: noteId } },
    });
    setBusy(false);
    if (!response.ok) {
      setNoteError(t("items.noteDeleteFailed", { status: response.status }));
      return;
    }
    onChanged();
  };

  return (
    <section className="mt-8">
      <h2 className="text-base font-semibold">{t("items.notes")}</h2>
      {noteError ? (
        <p className="mt-1 text-sm text-red-600" role="alert">
          {noteError}
        </p>
      ) : null}
      {canCreate ? (
        <div className="mt-2 flex items-end gap-3">
          <div className="flex-1">
            <label htmlFor="new-note" className="block text-sm font-medium">
              {t("items.addNote")}
            </label>
            <textarea
              id="new-note"
              rows={2}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              className="mt-1 w-full rounded-lg border border-ink/20 px-2 py-1 text-sm"
            />
          </div>
          <button type="button" disabled={busy || !body.trim()} onClick={add} className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-40">
            {t("items.addNoteButton")}
          </button>
        </div>
      ) : null}
      <ul className="mt-3 space-y-3">
        {(item.notes ?? []).map((note) => (
          <li key={note.id} className="rounded border border-slate-200 bg-white p-3 text-sm">
            {editingId === note.id ? (
              <div>
                <textarea rows={2} value={editBody} onChange={(event) => setEditBody(event.target.value)} className="w-full rounded-lg border border-ink/20 bg-white px-2 py-1.5" />
                <div className="mt-2 flex gap-2">
                  <button type="button" disabled={busy} onClick={() => saveEdit(note.id)} className="rounded bg-slate-900 px-2.5 py-1 text-white disabled:opacity-40">{t("common.save")}</button>
                  <button type="button" onClick={() => setEditingId(null)} className="rounded-lg border border-ink/20 px-2.5 py-1">{t("common.cancel")}</button>
                </div>
              </div>
            ) : (
              <>
                <p>{note.body}</p>
                <div className="mt-1 flex items-center justify-between text-xs text-slate-400">
                  <span>
                    {t("items.by")} {note.createdByUser?.name ?? note.createdBy} ·{" "}
                    {new Date(note.createdAt).toLocaleString()}
                    {note.revisions && note.revisions.length > 0
                      ? ` · ${t("items.editedTimes", { count: note.revisions.length })}`
                      : ""}
                  </span>
                  <span className="flex gap-3">
                    {canEdit ? (
                      <button type="button" onClick={() => { setEditingId(note.id); setEditBody(note.body); }} className="hover:text-slate-700">
                        {t("common.edit")}
                      </button>
                    ) : null}
                    {canDelete ? (
                      <button type="button" onClick={() => remove(note.id)} className="hover:text-red-600">
                        {t("common.delete")}
                      </button>
                    ) : null}
                  </span>
                </div>
              </>
            )}
          </li>
        ))}
        {(!item.notes || item.notes.length === 0) ? (
          <li className="text-sm text-slate-400">{t("items.noNotesYet")}</li>
        ) : null}
      </ul>
    </section>
  );
}
