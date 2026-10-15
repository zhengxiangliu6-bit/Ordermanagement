import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../../api-client/client";

interface ShipmentListRow {
  id: string;
  orderId: string;
  orderNumber: string;
  storeName: string | null;
  carrier: { key: string; name: string } | null;
  originalTrackingNumber: string | null;
  attakyTrackingNumber: string | null;
  publicTrackingMode: string | null;
  remoteSyncStatus: string;
  nextSendAt: string | null;
  attempts: number | null;
  enteredAt: string;
}

interface StoreOption {
  id: string;
  displayName: string;
}

const VIEWS = [
  { key: "all", labelKey: "shipments.viewAll" },
  { key: "scheduled", labelKey: "shipments.viewScheduled" },
  { key: "needs_attention", labelKey: "shipments.viewNeedsAttention" },
] as const;

const STATUS_LABEL_KEYS: Record<string, string> = {
  pending_review: "shipments.statusPendingReview",
  scheduled: "shipments.statusScheduled",
  sending: "shipments.statusSending",
  synced: "shipments.statusSynced",
  partially_synced: "shipments.statusPartiallySynced",
  failed: "shipments.statusFailed",
  not_supported: "shipments.statusNotSupported",
  manual_action_required: "shipments.statusManualAction",
  rejected: "shipments.statusRejected",
  not_applicable: "shipments.statusNotApplicable",
};

const STATUS_BADGE_CLASSES: Record<string, string> = {
  synced: "bg-emerald-100 text-emerald-800",
  partially_synced: "bg-amber-100 text-amber-800",
  manual_action_required: "bg-red-100 text-red-700",
  rejected: "bg-red-100 text-red-700",
};

/** Shipments list views (§24): All / Scheduled / Failed & Manual Action. */
export default function ShipmentsPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const view = searchParams.get("view") ?? "all";
  const [storeId, setStoreId] = useState("");

  const stores = useQuery({
    queryKey: ["stores"],
    queryFn: async () => {
      const { data, response } = await api.GET("/api/v1/stores");
      if (!response.ok || !data) return [] as StoreOption[];
      return data as unknown as StoreOption[];
    },
  });

  const shipments = useQuery({
    queryKey: ["shipments", view, storeId],
    queryFn: async () => {
      const { data, response } = await api.GET("/api/v1/shipments", {
        params: {
          query: {
            view,
            ...(storeId ? { storeId } : {}),
          } as never,
        },
      });
      if (!response.ok || !data) throw new Error(`Load failed (${response.status})`);
      return data as unknown as { shipments: ShipmentListRow[]; total: number };
    },
  });

  return (
    <div>
      <h1 className="text-xl font-semibold">{t("shipments.pageTitle")}</h1>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        {VIEWS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setSearchParams(item.key === "all" ? {} : { view: item.key })}
            className={`rounded px-3 py-1.5 ${
              view === item.key
                ? "bg-slate-900 font-medium text-white"
                : "border border-slate-300 hover:bg-slate-100"
            }`}
          >
            {t(item.labelKey)}
          </button>
        ))}
        <select
          value={storeId}
          onChange={(event) => setStoreId(event.target.value)}
          className="ml-auto rounded border border-slate-300 px-2 py-1"
        >
          <option value="">{t("review.allStores")}</option>
          {(stores.data ?? []).map((store) => (
            <option key={store.id} value={store.id}>
              {store.displayName}
            </option>
          ))}
        </select>
      </div>

      {shipments.isLoading ? (
        <p className="mt-3 text-sm text-slate-400">{t("common.loading")}</p>
      ) : (shipments.data?.shipments ?? []).length === 0 ? (
        <p className="mt-3 text-sm text-slate-400">{t("shipments.noneInVIew")}</p>
      ) : (
        <table className="mt-3 w-full border-collapse bg-white text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-500">
              <th className="px-3 py-2 font-medium">{t("orders.title")}</th>
              <th className="px-3 py-2 font-medium">{t("review.store")}</th>
              <th className="px-3 py-2 font-medium">{t("shipments.attakyNumber")}</th>
              <th className="px-3 py-2 font-medium">{t("shipments.carrierName")}</th>
              <th className="px-3 py-2 font-medium">{t("shipments.statusLabel")}</th>
              <th className="px-3 py-2 font-medium">{t("shipments.nextSendLabel")}</th>
              <th className="px-3 py-2 font-medium">{t("shipments.attempts")}</th>
            </tr>
          </thead>
          <tbody>
            {(shipments.data?.shipments ?? []).map((row) => (
              <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-2">
                  <Link
                    to={`/orders/${row.orderId}`}
                    className="font-mono text-sky-700 hover:underline"
                  >
                    {row.orderNumber}
                  </Link>
                </td>
                <td className="px-3 py-2">{row.storeName ?? "—"}</td>
                <td className="px-3 py-2 font-mono text-xs">
                  {row.attakyTrackingNumber ?? "—"}
                </td>
                <td className="px-3 py-2">{row.carrier?.name ?? "—"}</td>
                <td className="px-3 py-2">
                  <span
                    className={`rounded px-1.5 py-0.5 text-xs ${
                      STATUS_BADGE_CLASSES[row.remoteSyncStatus] ??
                      "bg-slate-100 text-slate-700"
                    }`}
                  >
                    {t(
                      STATUS_LABEL_KEYS[row.remoteSyncStatus] ??
                        "shipments.statusScheduled",
                    )}
                  </span>
                </td>
                <td className="px-3 py-2 text-xs">
                  {row.nextSendAt ? new Date(row.nextSendAt).toLocaleString() : "—"}
                </td>
                <td className="px-3 py-2">{row.attempts ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
