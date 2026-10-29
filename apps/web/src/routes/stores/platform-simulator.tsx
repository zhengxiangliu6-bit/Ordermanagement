import { useState } from "react";
import { buttonClasses } from "../../components/ui";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../../api-client/client";

/**
 * Dev/demo panel for the simulated platform: pushes order-update and
 * listing-update events into the in-memory adapter so the import → review
 → conflict pipeline can be exercised from the UI (no console needed).
 * The simulate endpoints require `stores:configure`; the API enforces it.
 */
export function PlatformSimulator() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [orderId, setOrderId] = useState("");
  const [buyerNote, setBuyerNote] = useState("");
  const [listingId, setListingId] = useState("");
  const [listingTitle, setListingTitle] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const orders = useQuery({
    queryKey: ["orders"],
    queryFn: async () => {
      const { data, response } = await api.GET("/api/v1/orders");
      if (!response.ok || !data) return [];
      return (data as unknown as { orders: Array<{ id: string; externalOrderId: string | null; displayNumber: string }> }).orders.filter(
        (o) => o.externalOrderId,
      );
    },
  });

  const stores = useQuery({
    queryKey: ["stores"],
    queryFn: async () => {
      const { data, response } = await api.GET("/api/v1/stores");
      if (!response.ok || !data) return [];
      return (data as unknown as Array<{
        id: string;
        displayName: string;
        connectionState: string;
        settings: Record<string, unknown> | null;
      }>).filter((s) => s.connectionState !== "disconnected");
    },
  });

  const listings = useQuery({
    queryKey: ["listings"],
    queryFn: async () => {
      const { data, response } = await api.GET("/api/v1/listings");
      if (!response.ok || !data) return [];
      const rows = data as unknown as Array<{ id: string; externalListingId: string | null; title: string }>;
      return rows.filter((l) => l.externalListingId);
    },
  });

  const pushOrderUpdate = async () => {
    setMessage(null);
    const { data, response } = await api.POST("/api/v1/platform/simulate/order-update", {
      body: { externalOrderId: orderId, buyerNote },
    });
    if (!response.ok) {
      setMessage(t("stores.simulator.failed", { status: response.status }));
      return;
    }
    // The simulated platform only knows orders it holds; ok:false means the
    // id is unknown to it (e.g. demo data was reseeded after the API started).
    if (data && (data as { ok?: boolean }).ok === false) {
      setMessage(t("stores.simulator.notFound"));
      return;
    }
    setMessage(t("stores.simulator.pushedOrder"));
    setBuyerNote("");
  };

  const pushListingUpdate = async () => {
    setMessage(null);
    const { data, response } = await api.POST("/api/v1/platform/simulate/listing-update", {
      body: { externalListingId: listingId, title: listingTitle },
    });
    if (!response.ok) {
      setMessage(t("stores.simulator.failed", { status: response.status }));
      return;
    }
    if (data && (data as { ok?: boolean }).ok === false) {
      setMessage(t("stores.simulator.notFound"));
      return;
    }
    setMessage(t("stores.simulator.pushedListing"));
    setListingTitle("");
  };

  const setSimOutcome = async (storeId: string, outcome: string) => {
    setMessage(null);
    const store = (stores.data ?? []).find((s) => s.id === storeId);
    if (!store) return;
    // The generated client types settings loosely; the cast keeps the call
    // honest about merging the existing settings with the new outcome.
    const { response } = await api.PATCH("/api/v1/stores/{id}", {
      params: { path: { id: storeId } },
      body: {
        settings: {
          ...(store.settings ?? {}),
          ...(outcome ? { simOutbound: outcome } : {}),
        },
      } as never,
    });
    if (!response.ok) {
      setMessage(t("stores.simulator.failed", { status: response.status }));
      return;
    }
    setMessage(t("stores.simulator.outcomeSet"));
    void stores.refetch();
  };

  return (
    <div className="mt-8 rounded-xl border border-dashed border-ink/20 bg-pill p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700">
          {t("stores.simulator.title")}
        </h2>
        <button type="button" onClick={() => setOpen(!open)} className={buttonClasses.ghost}>
          {open ? t("stores.simulator.collapse") : t("stores.simulator.expand")}
        </button>
      </div>
      <p className="mt-1 text-xs text-slate-500">{t("stores.simulator.hint")}</p>

      {open ? (
        <>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
        <div className="rounded border border-slate-200 bg-white p-3">
          <div className="text-xs font-medium text-slate-600">
            {t("stores.simulator.orderUpdate")}
          </div>
          <select
            value={orderId}
            onChange={(e) => setOrderId(e.target.value)}
            className="mt-2 w-full rounded-lg border border-ink/20 px-2 py-1 text-sm"
          >
            <option value="">{t("stores.simulator.selectOrder")}</option>
            {(orders.data ?? []).map((o) => (
              <option key={o.id} value={o.externalOrderId ?? ""}>
                {o.displayNumber} ({o.externalOrderId})
              </option>
            ))}
          </select>
          <input
            value={buyerNote}
            onChange={(e) => setBuyerNote(e.target.value)}
            placeholder={t("stores.simulator.newBuyerNote") ?? ""}
            className="mt-2 w-full rounded-lg border border-ink/20 px-2 py-1 text-sm"
          />
          <button
            type="button"
            disabled={!orderId || !buyerNote}
            onClick={() => void pushOrderUpdate()}
            className="mt-2 rounded bg-slate-900 px-3 py-1 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {t("stores.simulator.pushOrder")}
          </button>
        </div>

        <div className="rounded border border-slate-200 bg-white p-3">
          <div className="text-xs font-medium text-slate-600">
            {t("stores.simulator.listingUpdate")}
          </div>
          <select
            value={listingId}
            onChange={(e) => setListingId(e.target.value)}
            className="mt-2 w-full rounded-lg border border-ink/20 px-2 py-1 text-sm"
          >
            <option value="">{t("stores.simulator.selectListing")}</option>
            {(listings.data ?? []).map((l) => (
              <option key={l.id} value={l.externalListingId ?? ""}>
                {l.title} ({l.externalListingId})
              </option>
            ))}
          </select>
          <input
            value={listingTitle}
            onChange={(e) => setListingTitle(e.target.value)}
            placeholder={t("stores.simulator.newListingTitle") ?? ""}
            className="mt-2 w-full rounded-lg border border-ink/20 px-2 py-1 text-sm"
          />
          <button
            type="button"
            disabled={!listingId || !listingTitle}
            onClick={() => void pushListingUpdate()}
            className="mt-2 rounded bg-slate-900 px-3 py-1 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {t("stores.simulator.pushListing")}
          </button>
        </div>
      </div>

      <div className="mt-4 rounded border border-slate-200 bg-white p-3">
        <div className="text-xs font-medium text-slate-600">
          {t("stores.simulator.outboundOutcome")}
        </div>
        <p className="mt-1 text-xs text-slate-400">
          {t("stores.simulator.outboundOutcomeHint")}
        </p>
        <div className="mt-2 space-y-2">
          {(stores.data ?? []).map((store) => (
            <div key={store.id} className="flex items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate">{store.displayName}</span>
              <select
                value={
                  (store.settings?.simOutbound as string | undefined) ?? "synced"
                }
                onChange={(e) => void setSimOutcome(store.id, e.target.value)}
                className="rounded-lg border border-ink/20 px-2 py-1 text-sm"
              >
                <option value="synced">{t("stores.simulator.outcomeSynced")}</option>
                <option value="partial">{t("stores.simulator.outcomePartial")}</option>
                <option value="failed">{t("stores.simulator.outcomeFailed")}</option>
                <option value="not_supported">{t("stores.simulator.outcomeNotSupported")}</option>
              </select>
            </div>
          ))}
        </div>
      </div>

        {message ? <p className="mt-2 text-xs text-slate-600">{message}</p> : null}
        </>
      ) : null}
    </div>
  );
}
