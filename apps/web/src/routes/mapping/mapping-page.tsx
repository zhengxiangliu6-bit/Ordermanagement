import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../../api-client/client";

interface StoreOption {
  id: string;
  displayName: string;
}

interface MappingQueueRow {
  id: string;
  externalVariantId: string;
  externalSku: string | null;
  optionValues: Record<string, unknown> | null;
  itemVariantId: string | null;
  listing: { id: string; status: string; store: { id: string; displayName: string } };
  orderLines: Array<{ id: string }>;
}

interface VariantOption {
  id: string;
  itemCode: string;
  name: string;
}

export default function MappingPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [storeId, setStoreId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picks, setPicks] = useState<Record<string, string>>({});

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

  const variants = useQuery({
    queryKey: ["item-variants", "mapping"],
    queryFn: async () => {
      const { data, response } = await api.GET("/api/v1/item-variants");
      if (!response.ok || !data) return [] as VariantOption[];
      return data as unknown as VariantOption[];
    },
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["mapping-queue", storeId] });

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
    <div>
      <h1 className="text-xl font-semibold">{t("mapping.title")}</h1>
      <p className="mt-1 text-sm text-slate-500">{t("mapping.intro")}</p>

      {error ? <p className="mt-2 text-sm text-red-600" role="alert">{error}</p> : null}

      <div className="mt-4 flex items-center gap-4 text-sm">
        <select
          value={storeId}
          onChange={(event) => setStoreId(event.target.value)}
          className="rounded border border-slate-300 px-2 py-1"
        >
          <option value="">{t("review.allStores")}</option>
          {(stores.data ?? []).map((store) => (
            <option key={store.id} value={store.id}>
              {store.displayName}
            </option>
          ))}
        </select>
      </div>

      <ul className="mt-3 space-y-3">
        {rows.isLoading ? (
          <li className="text-sm text-slate-400">{t("common.loading")}</li>
        ) : rows.data && rows.data.length > 0 ? (
          rows.data.map((row) => (
            <li key={row.id} className="rounded border border-slate-200 bg-white p-3 text-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="font-medium">
                    {row.listing.status} · {row.externalVariantId}
                  </div>
                  <div className="text-xs text-slate-500">
                    {row.listing.store.displayName} · {row.externalSku ?? t("mapping.noSku")}
                    {row.optionValues
                      ? ` · ${Object.entries(row.optionValues).map(([k, v]) => `${k}: ${String(v)}`).join(" · ")}`
                      : ""}
                  </div>
                </div>
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">
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
                    className="mt-0.5 w-72 rounded border border-slate-300 px-2 py-1"
                  >
                    <option value="">{t("mapping.chooseItemVariant")}</option>
                    {(variants.data ?? []).map((variant) => (
                      <option key={variant.id} value={variant.id}>
                        {variant.itemCode} · {variant.name}
                      </option>
                    ))}
                  </select>
                </div>
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
                  className="rounded border border-slate-300 px-2.5 py-1.5 disabled:opacity-40"
                >
                  {t("mapping.unbind")}
                </button>
              </div>
            </li>
          ))
        ) : (
          <li className="text-sm text-slate-400">{t("mapping.queueEmpty")}</li>
        )}
      </ul>
    </div>
  );
}
