import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Modal } from "../../components/modal";
import { PlatformSimulator } from "./platform-simulator";
import { api } from "../../api-client/client";

interface StoreView {
  id: string;
  platform: string;
  displayName: string;
  externalShopName: string | null;
  connectionState: string;
  lastSyncAt: string | null;
  capabilities: Record<string, unknown> | null;
  settings?: { dataSource?: string } | null;
  _count?: { orders: number };
}

const PLATFORMS = ["shopify", "etsy"] as const;

export default function StoresPage() {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [platform, setPlatform] = useState<"" | "shopify" | "etsy">("");
  const [stateFilter, setStateFilter] = useState<"" | "connected" | "paused" | "disconnected">("");
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [busyStoreId, setBusyStoreId] = useState<string | null>(null);

  const { t } = useTranslation();
  const {
    data: stores,
    isLoading,
    isError,
    error: listError,
  } = useQuery({
    queryKey: ["stores", { platform, stateFilter }],
    queryFn: async () => {
      const { data, response } = await api.GET("/api/v1/stores", {
        params: {
          query: {
            platform: platform || undefined,
            connectionState: stateFilter || undefined,
          },
        },
      });
      if (!response.ok || !data) throw new Error(`List failed (${response.status})`);
      return data as unknown as StoreView[];
    },
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["stores"] });

  const createStore = async (form: HTMLFormElement) => {
    const formData = new FormData(form);
    setError(null);
    const { response } = await api.POST("/api/v1/stores", {
      body: {
        platform: String(formData.get("platform")) as (typeof PLATFORMS)[number],
        displayName: String(formData.get("displayName") ?? "").trim(),
        externalShopName: String(formData.get("externalShopName") ?? "").trim() || undefined,
      },
    });
    if (!response.ok) {
      setError(t("stores.createStoreFailed", { status: response.status }));
      return;
    }
    setCreating(false);
    await refresh();
  };

  const changeStoreState = async (id: string, action: "pause" | "resume") => {
    setError(null);
    const path =
      action === "pause" ? "/api/v1/stores/{id}/pause" : "/api/v1/stores/{id}/resume";
    const { response } = await api.POST(path, { params: { path: { id } } });
    if (!response.ok) {
      setError(t("stores.actionFailed", { action, status: response.status }));
      return;
    }
    await refresh();
  };

  const syncStore = async (store: StoreView) => {
    setError(null);
    setSyncMessage(null);
    setBusyStoreId(store.id);
    try {
      const { data, response } = await api.POST("/api/v1/stores/{id}/synchronize", {
        params: { path: { id: store.id } },
      });
      if (!response.ok || !data) {
        setError(t("stores.syncFailed", { status: response.status }));
        return;
      }
      const summary = (data as {
        summary: {
          listings: { merged: number; staged: number };
          orders: { merged: number; staged: number };
        };
      }).summary;
      setSyncMessage(
        t("stores.syncResult", {
          listingsMerged: summary.listings.merged,
          listingsStaged: summary.listings.staged,
          ordersMerged: summary.orders.merged,
          ordersStaged: summary.orders.staged,
        }),
      );
      await refresh();
    } finally {
      setBusyStoreId(null);
    }
  };

  const connectStore = async (store: StoreView) => {
    setError(null);
    setSyncMessage(null);
    setBusyStoreId(store.id);
    try {
      const { data, response } = await api.POST("/api/v1/stores/{id}/connect", {
        params: { path: { id: store.id } },
        body: {},
      });
      if (!response.ok || !data) {
        const detail = (data as { message?: string } | undefined)?.message;
        setError(
          detail
            ? t("stores.connectFailedDetail", { detail })
            : t("stores.connectFailed", { status: response.status }),
        );
        return;
      }
      setSyncMessage(
        t("stores.connectSuccess", {
          shop: (data as { shop?: { myshopifyDomain?: string } }).shop?.myshopifyDomain ?? "",
          count: ((data as { accessScopes?: string[] }).accessScopes ?? []).length,
        }),
      );
      await refresh();
    } finally {
      setBusyStoreId(null);
    }
  };

  const removeStore = async (store: StoreView) => {
    if (!window.confirm(t("stores.deleteStoreConfirm", { name: store.displayName }))) return;
    setError(null);
    const { response } = await api.DELETE("/api/v1/stores/{id}", {
      params: { path: { id: store.id } },
    });
    if (!response.ok) {
      setError(
        response.status === 409
          ? t("stores.storeHasOrdersError")
          : t("stores.deleteFailed", { status: response.status }),
      );
      return;
    }
    await refresh();
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t("stores.title")}</h1>
        <button
          type="button"
          onClick={() => setCreating((value) => !value)}
          className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
        >
          {creating ? t("common.cancel") : t("stores.newStore")}
        </button>
      </div>
      <p className="mt-1 text-sm text-slate-500">
        {t("stores.connectionsArriveText")}
      </p>

      {creating ? (
        <Modal title={t("stores.newStore")} onClose={() => setCreating(false)}>
        <form
          className="grid grid-cols-[10rem_1fr] gap-x-3 gap-y-2 text-sm"
          onSubmit={(event) => {
            event.preventDefault();
            void createStore(event.currentTarget);
          }}
        >
          <label htmlFor="store-platform" className="self-center font-medium">{t("stores.platform")}</label>
          <select id="store-platform" name="platform" className="rounded border border-slate-300 px-2 py-1">
            {PLATFORMS.map((platform) => (
              <option key={platform} value={platform}>{platform}</option>
            ))}
          </select>
          <label htmlFor="store-name" className="self-center font-medium">{t("stores.displayName")}</label>
          <input id="store-name" name="displayName" required className="rounded border border-slate-300 px-2 py-1" />
          <label htmlFor="store-shop" className="self-center font-medium">{t("stores.externalShopName")}</label>
          <input id="store-shop" name="externalShopName" placeholder={t("stores.externalShopPlaceholder")} className="rounded border border-slate-300 px-2 py-1" />
          {error ? <div /> : <p className="text-sm text-red-600" role="alert">{error}</p>}
          <div />
          <button type="submit" className="justify-self-start rounded bg-slate-700 px-3 py-1.5 text-white hover:bg-slate-600">
            {t("stores.createStore")}
          </button>
        </form>
        </Modal>
      ) : null}

      {error && !creating ? (
        <p className="mt-3 text-sm text-red-600" role="alert">{error}</p>
      ) : null}

      {syncMessage ? (
        <p className="mt-3 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {syncMessage}
        </p>
      ) : null}

      <div className="mt-4 flex items-center gap-4 text-sm">
        <select
          value={platform}
          onChange={(event) => setPlatform(event.target.value as "" | "shopify" | "etsy")}
          className="rounded border border-slate-300 px-2 py-1"
        >
          <option value="">{t("stores.allPlatforms")}</option>
          <option value="shopify">shopify</option>
          <option value="etsy">etsy</option>
        </select>
        <select
          value={stateFilter}
          onChange={(event) =>
            setStateFilter(event.target.value as "" | "connected" | "paused" | "disconnected")
          }
          className="rounded border border-slate-300 px-2 py-1"
        >
          <option value="">{t("stores.allStates")}</option>
          <option value="connected">{t("stores.stateConnected")}</option>
          <option value="paused">{t("stores.statePaused")}</option>
          <option value="disconnected">{t("stores.stateDisconnected")}</option>
        </select>
      </div>

      <table className="mt-3 w-full border-collapse bg-white text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-slate-500">
            <th className="px-3 py-2 font-medium">{t("stores.displayName")}</th>
            <th className="px-3 py-2 font-medium">{t("stores.platform")}</th>
            <th className="px-3 py-2 font-medium">{t("stores.externalShopName")}</th>
            <th className="px-3 py-2 font-medium">{t("stores.allStates")}</th>
            <th className="px-3 py-2 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            <tr><td colSpan={5} className="px-3 py-6 text-slate-400">{t("common.loading")}</td></tr>
          ) : isError ? (
            <tr><td colSpan={5} className="px-3 py-6 text-red-600">{(listError as Error).message}</td></tr>
          ) : stores && stores.length > 0 ? (
            stores.map((store) => (
              <tr key={store.id} className="border-b border-slate-100">
                <td className="px-3 py-2 font-medium">{store.displayName}</td>
                <td className="px-3 py-2">{store.platform}</td>
                <td className="px-3 py-2 text-slate-500">{store.externalShopName ?? "—"}</td>
                <td className="px-3 py-2">
                  {store.connectionState === "connected" ? (
                    <span className="text-emerald-700">{t("stores.stateConnected")}</span>
                  ) : store.connectionState === "paused" ? (
                    <span className="text-amber-700">{t("stores.statePaused")}</span>
                  ) : (
                    <span className="text-slate-500">{t("stores.stateDisconnected")}</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  <span className="flex justify-end gap-3">
                    {store.connectionState === "connected" ? (
                      <>
                        <button
                          type="button"
                          disabled={busyStoreId === store.id}
                          onClick={() => void syncStore(store)}
                          className="text-slate-600 hover:text-slate-900 disabled:cursor-wait disabled:text-slate-400"
                        >
                          {busyStoreId === store.id ? t("stores.syncing") : t("stores.sync")}
                        </button>
                        <button type="button" onClick={() => changeStoreState(store.id, "pause")} className="text-slate-500 hover:text-slate-800">
                          {t("stores.pause")}
                        </button>
                      </>
                    ) : store.platform === "shopify" && store.settings?.dataSource !== "relay" ? (
                      <button
                        type="button"
                        disabled={busyStoreId === store.id}
                        onClick={() => void connectStore(store)}
                        className="text-slate-600 hover:text-slate-900 disabled:cursor-wait disabled:text-slate-400"
                      >
                        {busyStoreId === store.id ? t("stores.connecting") : t("stores.connect")}
                      </button>
                    ) : (
                      <button type="button" onClick={() => changeStoreState(store.id, "resume")} className="text-slate-500 hover:text-slate-800">
                        {t("stores.resume")}
                      </button>
                    )}
                    {(store._count?.orders ?? 0) === 0 ? (
                      <button type="button" onClick={() => removeStore(store)} className="text-red-600 hover:text-red-800">
                        {t("common.delete")}
                      </button>
                    ) : null}
                  </span>
                </td>
              </tr>
            ))
          ) : (
            <tr><td colSpan={5} className="px-3 py-6 text-slate-400">{t("stores.noStoresYet")}</td></tr>
          )}
        </tbody>
      </table>

      <PlatformSimulator />
    </div>
  );
}
