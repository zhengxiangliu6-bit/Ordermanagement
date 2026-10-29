import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Modal } from "../../components/modal";
import { PageHeader, Card, Badge, EmptyState, buttonClasses } from "../../components/ui";
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
    <div className="space-y-4">
      <PageHeader
        title={t("stores.title")}
        description={t("stores.connectionsArriveText")}
        actions={
          <button
            type="button"
            onClick={() => setCreating((value) => !value)}
            className={creating ? buttonClasses.secondary : buttonClasses.primary}
          >
            {creating ? t("common.cancel") : t("stores.newStore")}
          </button>
        }
      />

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
          <select id="store-platform" name="platform" className="rounded-lg border border-ink/20 bg-white px-2 py-1.5">
            {PLATFORMS.map((platform) => (
              <option key={platform} value={platform}>{platform}</option>
            ))}
          </select>
          <label htmlFor="store-name" className="self-center font-medium">{t("stores.displayName")}</label>
          <input id="store-name" name="displayName" required className="rounded-lg border border-ink/20 bg-white px-2 py-1.5" />
          <label htmlFor="store-shop" className="self-center font-medium">{t("stores.externalShopName")}</label>
          <input id="store-shop" name="externalShopName" placeholder={t("stores.externalShopPlaceholder")} className="rounded-lg border border-ink/20 bg-white px-2 py-1.5" />
          {error ? <div /> : <p className="text-sm text-red-600" role="alert">{error}</p>}
          <div />
          <button type="submit" className="justify-self-start rounded bg-slate-700 px-3 py-1.5 text-white hover:bg-slate-600">
            {t("stores.createStore")}
          </button>
        </form>
        </Modal>
      ) : null}

      {error && !creating ? (
        <p className="text-sm text-red-600" role="alert">{error}</p>
      ) : null}

      {syncMessage ? (
        <p className="rounded-xl border border-play-green/30 bg-play-green/10 px-3 py-2 text-sm text-emerald-800">
          {syncMessage}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <select
          value={platform}
          onChange={(event) => setPlatform(event.target.value as "" | "shopify" | "etsy")}
          className="rounded-lg border border-ink/20 bg-white px-2 py-1.5"
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
          className="rounded-lg border border-ink/20 bg-white px-2 py-1.5"
        >
          <option value="">{t("stores.allStates")}</option>
          <option value="connected">{t("stores.stateConnected")}</option>
          <option value="paused">{t("stores.statePaused")}</option>
          <option value="disconnected">{t("stores.stateDisconnected")}</option>
        </select>
      </div>

      {isLoading ? (
        <Card><p className="text-sm text-slate-400">{t("common.loading")}</p></Card>
      ) : isError ? (
        <Card><p className="text-sm text-red-600">{(listError as Error).message}</p></Card>
      ) : stores && stores.length > 0 ? (
        <Card className="overflow-hidden">
          <div className="-m-4 overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-ink/10 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="px-4 py-2.5 font-semibold">{t("stores.displayName")}</th>
                  <th className="px-3 py-2.5 font-semibold">{t("stores.platform")}</th>
                  <th className="px-3 py-2.5 font-semibold">{t("stores.externalShopName")}</th>
                  <th className="px-3 py-2.5 font-semibold">{t("stores.allStates")}</th>
                  <th className="px-3 py-2.5 font-semibold"></th>
                </tr>
              </thead>
              <tbody>
              {stores.map((store) => (
              <tr key={store.id} className="border-b border-ink/5 transition-colors last:border-0 hover:bg-pill">
                <td className="px-4 py-2.5 font-medium text-ink">{store.displayName}</td>
                <td className="px-3 py-2.5">{store.platform}</td>
                <td className="px-3 py-2.5 text-slate-500">{store.externalShopName ?? "—"}</td>
                <td className="px-3 py-2.5">
                  {store.connectionState === "connected" ? (
                    <Badge tone="success">{t("stores.stateConnected")}</Badge>
                  ) : store.connectionState === "paused" ? (
                    <Badge tone="warning">{t("stores.statePaused")}</Badge>
                  ) : (
                    <Badge tone="neutral">{t("stores.stateDisconnected")}</Badge>
                  )}
                </td>
                <td className="px-3 py-2.5 text-right">
                  <span className="flex justify-end gap-1">
                    {store.connectionState === "connected" ? (
                      <>
                        <button
                          type="button"
                          disabled={busyStoreId === store.id}
                          onClick={() => void syncStore(store)}
                          className={buttonClasses.ghost + " disabled:cursor-wait"}
                        >
                          {busyStoreId === store.id ? t("stores.syncing") : t("stores.sync")}
                        </button>
                        <button type="button" onClick={() => changeStoreState(store.id, "pause")} className={buttonClasses.ghost}>
                          {t("stores.pause")}
                        </button>
                      </>
                    ) : store.platform === "shopify" && store.settings?.dataSource !== "relay" ? (
                      <button
                        type="button"
                        disabled={busyStoreId === store.id}
                        onClick={() => void connectStore(store)}
                        className={buttonClasses.secondary + " disabled:cursor-wait"}
                      >
                        {busyStoreId === store.id ? t("stores.connecting") : t("stores.connect")}
                      </button>
                    ) : (
                      <button type="button" onClick={() => changeStoreState(store.id, "resume")} className={buttonClasses.ghost}>
                        {t("stores.resume")}
                      </button>
                    )}
                    {(store._count?.orders ?? 0) === 0 ? (
                      <button type="button" onClick={() => removeStore(store)} className={buttonClasses.danger}>
                        {t("common.delete")}
                      </button>
                    ) : null}
                  </span>
                </td>
              </tr>
              ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <EmptyState message={t("stores.noStoresYet")} />
      )}

      <PlatformSimulator />
    </div>
  );
}
