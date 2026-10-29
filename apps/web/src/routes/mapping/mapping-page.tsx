import { LineImagePreviews } from "../items/line-image-previews";
import { ImagePreviewButton } from "../items/image-preview";
import { useState } from "react";
import { useRouteLoaderData } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../../api-client/client";
import { PageHeader, EmptyState, buttonClasses } from "../../components/ui";
import type { rootLoader } from "../../layouts/root-loader";

interface StoreOption {
  id: string;
  displayName: string;
  platform: string;
}

interface MappingQueueRow {
  platformVariantImages?: string[];
  platformProductImages?: string[];
  id: string;
  externalVariantId: string;
  externalTitle: string | null;
  listingTitle: string | null;
  externalSku: string | null;
  optionValues: Record<string, unknown> | null;
  itemVariantId: string | null;
  listing: { id: string; status: string; store: { id: string; displayName: string } };
  orderLines: Array<{ id: string }>;
}

interface VariantOption {
  id: string;
  itemCode: string;
  images?: unknown;
  name: string;
  item: { id: string; name: string };
}

/** Groups picker options by internal item so long catalogs stay navigable. */
function groupVariantsByItem(variants: VariantOption[]): Array<{ itemName: string; variants: VariantOption[] }> {
  const groups = new Map<string, VariantOption[]>();
  for (const variant of variants) {
    const list = groups.get(variant.item.name) ?? [];
    list.push(variant);
    groups.set(variant.item.name, list);
  }
  return [...groups.entries()].map(([itemName, list]) => ({ itemName, variants: list }));
}

interface MappedRow {
  platformVariantImages?: string[];
  platformProductImages?: string[];
  id: string;
  externalVariantId: string;
  externalTitle: string | null;
  listingTitle: string | null;
  externalSku: string | null;
  store: { id: string; displayName: string };
  itemVariant: { itemCode: string; name: string; itemName: string; images?: unknown } | null;
}

export default function MappingPage() {
  const { t } = useTranslation();
  const root = useRouteLoaderData<typeof rootLoader>("root");
  const canManage = new Set(root?.user.permissions ?? []).has("mapping:manage");
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"queue" | "mapped">("queue");
  const [storeId, setStoreId] = useState("");
  const [variantSearch, setVariantSearch] = useState("");
  const [autoPlan, setAutoPlan] = useState<{
    itemsToCreate: Array<{ title: string; store: string; variants: string[] }>;
  } | null>(null);
  const [autoBusy, setAutoBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [remapOpen, setRemapOpen] = useState<string | null>(null);

  const stores = useQuery({
    queryKey: ["stores"],
    queryFn: async () => {
      const { data, response } = await api.GET("/api/v1/stores");
      if (!response.ok || !data) return [] as StoreOption[];
      return data as unknown as StoreOption[];
    },
  });

  const rows = useQuery({
    queryKey: ["mapping-queue", storeId],
    queryFn: async () => {
      const { data, response } = await api.GET("/api/v1/mapping/queue", {
        params: { query: { storeId: storeId || undefined } },
      });
      if (!response.ok || !data) throw new Error(`List failed (${response.status})`);
      return data as unknown as MappingQueueRow[];
    },
  });

  const mappedRows = useQuery({
    queryKey: ["mapping-mapped", storeId],
    queryFn: async () => {
      const { data, response } = await api.GET("/api/v1/mapping/mapped", {
        params: { query: { storeId: storeId || undefined } },
      });
      if (!response.ok || !data) throw new Error(`List failed (${response.status})`);
      return data as unknown as MappedRow[];
    },
  });

  const variants = useQuery({
    queryKey: ["item-variants", "mapping", variantSearch],
    queryFn: async () => {
      const { data, response } = await api.GET("/api/v1/item-variants", {
        params: { query: { search: variantSearch.trim() || undefined } },
      });
      if (!response.ok || !data) return [] as VariantOption[];
      return data as unknown as VariantOption[];
    },
  });

  const refresh = () => {
    for (const key of ["item-variants", "review-item-variants", "items", "item", "orders", "order", "review", "listings", "inventory"]) {
      void queryClient.invalidateQueries({ queryKey: [key] });
    }
    void queryClient.invalidateQueries({ queryKey: ["mapping-queue", storeId] });
    void queryClient.invalidateQueries({ queryKey: ["mapping-mapped", storeId] });
  };

  const resolve = async (listingVariantId: string) => {
    const itemVariantId = picks[listingVariantId];
    if (!itemVariantId) return;
    setBusy(true);
    setError(null);
    const { response } = await api.POST("/api/v1/mapping/resolve", {
      body: { listingVariantId, itemVariantId },
    });
    setBusy(false);
    if (!response.ok) {
      setError(t("mapping.resolveFailed", { status: response.status }));
      return;
    }
    setPicks((current) => {
      const next = { ...current };
      delete next[listingVariantId];
      return next;
    });
    await refresh();
  };

  const previewAutoCreate = async () => {
    setAutoBusy(true);
    setError(null);
    const { data, response } = await api.POST("/api/v1/mapping/auto-create", {
      body: { storeId: storeId || undefined, dryRun: true },
    });
    setAutoBusy(false);
    if (!response.ok || !data) {
      setError(t("mapping.autoPreviewFailed", { status: response.status }));
      return;
    }
    setAutoPlan(data as unknown as { itemsToCreate: Array<{ title: string; store: string; variants: string[] }> });
  };

  const executeAutoCreate = async () => {
    setAutoBusy(true);
    setError(null);
    const { data, response } = await api.POST("/api/v1/mapping/auto-create", {
      body: { storeId: storeId || undefined },
    });
    setAutoBusy(false);
    if (!response.ok || !data) {
      setError(t("mapping.autoFailed", { status: response.status }));
      return;
    }
    setAutoPlan(null);
    await refresh();
  };

  const unbind = async (listingVariantId: string) => {
    setBusy(true);
    setError(null);
    const { response } = await api.DELETE("/api/v1/mapping/{listingVariantId}", {
      params: { path: { listingVariantId } },
    });
    setBusy(false);
    if (!response.ok) {
      setError(t("mapping.unbindFailed", { status: response.status }));
      return;
    }
    await refresh();
  };

  return (
    <div className="space-y-4">
      <PageHeader title={t("mapping.title")} description={t("mapping.intro")} />

      {error ? <p className="mt-2 text-sm text-red-600" role="alert">{error}</p> : null}

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <div className="flex overflow-hidden rounded-xl border border-ink/15">
          {(["queue", "mapped"] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                setTab(key);
                setRemapOpen(null);
              }}
              className={`px-3.5 py-1.5 transition-colors ${
                tab === key
                  ? "bg-ink font-semibold text-white"
                  : "bg-white text-slate-600 hover:bg-pill hover:text-ink"
              }`}
            >
              {t(key === "queue" ? "mapping.tabQueue" : "mapping.tabMapped")}
            </button>
          ))}
        </div>
        <select
          value={storeId}
          onChange={(event) => setStoreId(event.target.value)}
          className="rounded-lg border border-ink/20 bg-white px-2 py-1.5"
        >
          <option value="">{t("review.allStores")}</option>
          {(stores.data ?? []).map((store) => (
            <option key={store.id} value={store.id}>
              {store.displayName} · {store.platform}
            </option>
          ))}
        </select>
        <input
          value={variantSearch}
          onChange={(event) => setVariantSearch(event.target.value)}
          placeholder={t("mapping.variantSearchPlaceholder")}
          className="rounded-lg border border-ink/20 bg-white px-2.5 py-1.5"
        />
        {tab === "queue" && canManage ? (
          <button
            type="button"
            disabled={autoBusy}
            onClick={() => void previewAutoCreate()}
            className={`ml-auto ${buttonClasses.primary}`}
          >
            {t("mapping.autoCreateButton")}
          </button>
        ) : null}
      </div>

      {autoPlan ? (
        <div className="mt-3 rounded border border-slate-200 bg-slate-50 p-3 text-sm">
          <p className="font-medium">
            {t("mapping.autoPreviewTitle", { count: autoPlan.itemsToCreate.length })}
          </p>
          <ul className="mt-1 max-h-48 space-y-0.5 overflow-y-auto text-xs text-slate-600">
            {autoPlan.itemsToCreate.map((item) => (
              <li key={`${item.store}-${item.title}`}>
                {item.title}
                <span className="text-slate-400"> · {item.store} · {t("mapping.autoPreviewVariants", { count: item.variants.length })}</span>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setAutoPlan(null)}
              className="rounded-lg border border-ink/20 px-2.5 py-1 text-xs"
            >
              {t("common.cancel")}
            </button>
            {canManage ? (
              <button
                type="button"
                disabled={autoBusy || autoPlan.itemsToCreate.length === 0}
                onClick={() => void executeAutoCreate()}
                className="rounded bg-emerald-700 px-2.5 py-1 text-xs text-white hover:bg-emerald-600 disabled:opacity-50"
              >
                {t("mapping.autoCreateConfirm")}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {tab === "mapped" ? (
        <ul className="space-y-2">
          {mappedRows.isLoading ? (
            <li className="text-sm text-slate-400">{t("common.loading")}</li>
          ) : mappedRows.data && mappedRows.data.length > 0 ? (
            mappedRows.data.map((row) => (
              <li
                key={row.id}
                className="pop-shadow-sm rounded-xl border border-ink/10 bg-white p-3 text-sm"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="font-medium">
                      {row.listingTitle ?? row.externalVariantId}
                      {row.externalTitle ? ` — ${row.externalTitle}` : ""}
                    </div>
                    <div className="text-xs text-slate-500">
                      {row.store.displayName} · {row.externalSku ?? t("mapping.noSku")}
                    </div>
                    <LineImagePreviews line={{ ...row, variantImages: row.itemVariant?.images, variantImageSource: "current" }} name={row.listingTitle ?? row.externalVariantId} />
                    <div className="mt-1 rounded bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800">
                      {t("mapping.internalItem")}:{" "}
                      {row.itemVariant
                        ? `${row.itemVariant.itemName} · ${row.itemVariant.name} (${row.itemVariant.itemCode})`
                        : "—"}
                    </div>
                  </div>
                  {canManage ? (
                    <span className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setRemapOpen(remapOpen === row.id ? null : row.id);
                          setPicks((current) => ({
                            ...current,
                            [row.id]: current[row.id] ?? "",
                          }));
                        }}
                        className="rounded-lg border border-ink/20 px-2 py-1 text-xs hover:bg-pill disabled:opacity-50"
                      >
                        {t("mapping.remapButton")}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          if (!window.confirm(t("mapping.unbindConfirm"))) return;
                          void unbind(row.id);
                        }}
                        className="rounded border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
                      >
                        {t("mapping.unbindButton")}
                      </button>
                    </span>
                  ) : null}
                </div>
                {remapOpen === row.id ? (
                  <div className="mt-2 flex items-end gap-2">
                    <div>
                      <label
                        htmlFor={`remap-${row.id}`}
                        className="block text-xs font-medium"
                      >
                        {t("mapping.pickItemVariant")}
                      </label>
                      <select
                        id={`remap-${row.id}`}
                        value={picks[row.id] ?? ""}
                        onChange={(event) =>
                          setPicks((current) => ({
                            ...current,
                            [row.id]: event.target.value,
                          }))
                        }
                        className="mt-1 rounded-lg border border-ink/20 px-2 py-1 text-sm"
                      >
                        <option value="">{t("mapping.chooseVariant")}</option>
                        {groupVariantsByItem(variants.data ?? []).map((group) => (
                          <optgroup key={group.itemName} label={group.itemName}>
                            {group.variants.map((variant) => (
                              <option key={variant.id} value={variant.id}>
                                {variant.name} ({variant.itemCode})
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    </div>
                    <ImagePreviewButton images={variants.data?.find((variant) => variant.id === picks[row.id])?.images} name={`${variants.data?.find((variant) => variant.id === picks[row.id])?.name ?? ""} · ${t("images.systemCurrent")}`} />
                    <button
                      type="button"
                      disabled={busy || !picks[row.id]}
                      onClick={() => void resolve(row.id)}
                      className="rounded bg-slate-800 px-3 py-1.5 text-sm text-white hover:bg-slate-700 disabled:opacity-50"
                    >
                      {t("mapping.remapSave")}
                    </button>
                  </div>
                ) : null}
              </li>
            ))
          ) : (
            <li><EmptyState message={t("mapping.mappedEmpty")} /></li>
          )}
        </ul>
      ) : (
      <ul className="space-y-3">
        {rows.isLoading ? (
          <li className="text-sm text-slate-400">{t("common.loading")}</li>
        ) : rows.data && rows.data.length > 0 ? (
          rows.data.map((row) => (
            <li key={row.id} className="pop-shadow-sm rounded-xl border border-ink/10 bg-white p-3 text-sm transition-transform hover:-translate-y-0.5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="font-medium">
                    {row.listingTitle ?? row.externalVariantId}
                    {row.externalTitle ? ` — ${row.externalTitle}` : ""}
                  </div>
                  <div className="text-xs text-slate-500">
                    {row.listing.store.displayName} · {row.listing.status} ·{" "}
                    {row.externalSku ?? t("mapping.noSku")}
                    {row.optionValues
                      ? ` · ${Object.entries(row.optionValues).map(([k, v]) => `${k}: ${String(v)}`).join(" · ")}`
                      : ""}
                  </div>
                  <LineImagePreviews line={row} name={row.listingTitle ?? row.externalVariantId} />
                  <div className="font-mono text-xs text-slate-400">{row.externalVariantId}</div>
                </div>
                <span className="whitespace-nowrap rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">
                  {t("mapping.affectedOrders", { count: row.orderLines.length })}
                </span>
              </div>
              <div className="mt-2 flex items-end gap-2">
                <div>
                  <label htmlFor={`pick-${row.id}`} className="block text-xs font-medium">
                    {t("mapping.pickItemVariant")}
                  </label>
                  <select
                    id={`pick-${row.id}`}
                    value={picks[row.id] ?? ""}
                    onChange={(event) =>
                      setPicks((current) => ({ ...current, [row.id]: event.target.value }))
                    }
                    className="mt-0.5 w-72 rounded-lg border border-ink/20 px-2 py-1"
                  >
                    <option value="">{t("mapping.chooseItemVariant")}</option>
                    {groupVariantsByItem(variants.data ?? []).map((group) => (
                      <optgroup key={group.itemName} label={group.itemName}>
                        {group.variants.map((variant) => (
                          <option key={variant.id} value={variant.id}>
                            {variant.name} ({variant.itemCode})
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>
                <ImagePreviewButton images={variants.data?.find((variant) => variant.id === picks[row.id])?.images} name={`${variants.data?.find((variant) => variant.id === picks[row.id])?.name ?? ""} · ${t("images.systemCurrent")}`} />
                {canManage ? (
                  <>
                    <button
                      type="button"
                      disabled={busy || !picks[row.id]}
                      onClick={() => resolve(row.id)}
                      className="rounded bg-slate-900 px-3 py-1.5 text-white hover:bg-slate-800 disabled:opacity-40"
                    >
                      {t("mapping.resolve")}
                    </button>
                    <button
                      type="button"
                      disabled={busy || !row.itemVariantId}
                      onClick={() => unbind(row.id)}
                      className="rounded-lg border border-ink/20 px-2.5 py-1.5 disabled:opacity-40"
                    >
                      {t("mapping.unbind")}
                    </button>
                  </>
                ) : null}
              </div>
            </li>
          ))
        ) : (
          <li className="text-sm text-slate-400">{t("mapping.queueEmpty")}</li>
        )}
      </ul>
      )}
    </div>
  );
}
