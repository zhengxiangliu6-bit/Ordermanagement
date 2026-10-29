import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "../../components/modal";
import { buttonClasses } from "../../components/ui";
import { api } from "../../api-client/client";
import type { Item, ItemVariant } from "../../types/item";
import {
  VariantForm,
  BatchVariantForm,
  type VariantInput,
} from "./variant-form";
import { ImagePreviewButton } from "./image-preview";

export function VariantsSection({
  item,
  permissions,
  onChanged,
}: {
  item: Item;
  permissions: Set<string>;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const allowed = (permission: string) =>
    permissions.has("*") || permissions.has(permission);
  const [adding, setAdding] = useState(false);
  const [mode, setMode] = useState<"single" | "batch">("single");
  const [editing, setEditing] = useState<ItemVariant | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const close = () => {
    if (!busy && !uploadBusy) {
      setAdding(false);
      setEditing(null);
      setError("");
    }
  };
  const mutate = async (request: () => Promise<{ response: Response }>) => {
    setBusy(true);
    setError("");
    try {
      const { response } = await request();
      if (!response.ok) {
        setError(t("items.saveFailed", { status: response.status }));
        return;
      }
      setAdding(false);
      setEditing(null);
      onChanged();
    } catch {
      setError(t("items.networkError"));
    } finally {
      setBusy(false);
    }
  };
  const save = (value: VariantInput) =>
    void mutate(() =>
      editing
        ? api.PATCH("/api/v1/items/{id}/variants/{variantId}", {
            params: { path: { id: item.id, variantId: editing.id } },
            body: value,
          })
        : api.POST("/api/v1/items/{id}/variants", {
            params: { path: { id: item.id } },
            body: value,
          }),
    );

  return (
    <section className="mt-8">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">{t("items.itemVariants")}</h2>
        {allowed("items:create") && (
          <button
            type="button"
            onClick={() => {
              setError("");
              setMode("single");
              setAdding(true);
            }}
            className={buttonClasses.secondary}
          >
            {t("items.addVariant")}
          </button>
        )}
      </div>
      {(adding || editing) && (
        <Modal
          title={t(editing ? "items.editVariant" : "items.addVariant")}
          onClose={close}
        >
          {adding && (
            <div
              className="mb-4 grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1"
              role="group"
              aria-label={t("items.addVariant")}
            >
              {(["single", "batch"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  disabled={busy || uploadBusy}
                  aria-pressed={mode === tab}
                  onClick={() => {
                    setMode(tab);
                    setError("");
                  }}
                  className={`rounded-md px-3 py-2 text-sm ${mode === tab ? "bg-white font-semibold shadow-sm" : "text-slate-500"}`}
                >
                  {t(
                    tab === "single"
                      ? "items.addSingleMode"
                      : "items.addBatchMode",
                  )}
                </button>
              ))}
            </div>
          )}
          {error && (
            <p role="alert" className="mb-3 text-sm text-red-600">
              {error}
            </p>
          )}
          {editing || mode === "single" ? (
            <VariantForm
              key={editing?.id ?? "new"}
              variant={editing ?? undefined}
              busy={busy}
              onSubmit={save}
              onCancel={close}
              onUploadBusy={setUploadBusy}
            />
          ) : (
            <BatchVariantForm
              busy={busy}
              onCancel={close}
              onSubmit={(axes) =>
                void mutate(() =>
                  api.POST("/api/v1/items/{id}/variants/batch", {
                    params: { path: { id: item.id } },
                    body: { axes },
                  }),
                )
              }
            />
          )}
        </Modal>
      )}
      {error && !adding && !editing && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {error}
        </p>
      )}
      <div className="mt-3 overflow-x-auto rounded-xl border border-ink/10 bg-white">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-ink/10 text-left text-xs text-slate-400">
              {[
                "items.itemCode",
                "items.name",
                "inventory.nameEnLabel",
                "items.options",
                "items.status",
              ].map((label) => (
                <th key={label} className="px-4 py-3 font-semibold">
                  {t(label)}
                </th>
              ))}
              <th>
                <span className="sr-only">{t("common.edit")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {(item.variants ?? []).map((variant) => (
              <tr
                key={variant.id}
                className="border-b border-ink/5 last:border-0 hover:bg-pill"
              >
                <td className="px-4 py-3 font-mono text-xs">
                  {variant.itemCode}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <ImagePreviewButton
                      images={variant.images}
                      name={variant.name}
                    />
                    <span>{variant.name}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {variant.nameEn || "—"}
                </td>
                <td className="px-4 py-3 text-slate-500">
                  {Object.entries(variant.optionValues ?? {})
                    .map(([key, value]) => `${key}: ${String(value)}`)
                    .join(" · ") || "—"}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={
                      variant.archivedAt ? "text-amber-700" : "text-emerald-700"
                    }
                  >
                    {t(
                      variant.archivedAt ? "common.archived" : "common.active",
                    )}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {!variant.archivedAt && (
                    <div className="flex justify-end gap-3 whitespace-nowrap">
                      {allowed("items:update") && (
                        <button
                          type="button"
                          onClick={() => {
                            setError("");
                            setEditing(variant);
                          }}
                          className="text-slate-600"
                        >
                          {t("common.edit")}
                        </button>
                      )}
                      {allowed("items:archive") && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void mutate(() =>
                              api.POST(
                                "/api/v1/items/{id}/variants/{variantId}/archive",
                                {
                                  params: {
                                    path: {
                                      id: item.id,
                                      variantId: variant.id,
                                    },
                                  },
                                },
                              ),
                            )
                          }
                          className="text-slate-600"
                        >
                          {t("items.archiveLabel")}
                        </button>
                      )}
                      {allowed("items:delete") && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            if (
                              window.confirm(
                                t("items.deleteVariantConfirm", {
                                  name: variant.name,
                                }),
                              )
                            )
                              void mutate(() =>
                                api.DELETE(
                                  "/api/v1/items/{id}/variants/{variantId}",
                                  {
                                    params: {
                                      path: {
                                        id: item.id,
                                        variantId: variant.id,
                                      },
                                    },
                                  },
                                ),
                              );
                          }}
                          className="text-red-600"
                        >
                          {t("common.delete")}
                        </button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {!item.variants?.length && (
              <tr>
                <td colSpan={6} className="p-4 text-slate-400">
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
