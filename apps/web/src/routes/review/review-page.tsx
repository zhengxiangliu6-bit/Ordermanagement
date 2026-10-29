import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useSearchParams, useRouteLoaderData } from "react-router";
import { api } from "../../api-client/client";
import { PageHeader, EmptyState, buttonClasses } from "../../components/ui";
import { NewOrderReviewCard, type NewOrderRecord } from "./new-order-card";
import type { rootLoader } from "../../layouts/root-loader";

interface ReviewRecordView {
  id: string;
  type: string;
  status: string;
  storeId: string | null;
  storeName?: string | null;
  platform?: string | null;
  subjectId: string | null;
  payload: {
    returnedFromPacking?: boolean;
    returnedFromStage?: string | null;
    shippingRegionId?: string | null;
    categoryId?: string | null;
    // "initial" | "revision" for shipment records; free-form otherwise.
    kind?: string;
    conflict?: boolean;
    conflictFields?: Array<{
      key: string;
      label: string;
      internalValue?: unknown;
      incomingValue?: unknown;
    }>;
    currentInternal?: Record<string, unknown> | null;
    listing?: { title?: string; status?: string };
    orderNumber?: string;
    storeName?: string | null;
    carrierKey?: string | null;
    carrierName?: string | null;
    originalTrackingNumber?: string | null;
    attakyTrackingNumber?: string | null;
    policyMode?: string | null;
    projectedSendAt?: string | null;
    customerNotification?: string | null;
    order?: {
      displayNumber: string;
      customer: { name?: string };
      lines?: Array<{ title: string; quantity: number }>;
      buyerNote?: string | null;
      statusRaw?: { financialStatus?: string } | null;
      sourceUpdatedAt?: string;
    };
  } | null;
  decidedBy: string | null;
  createdAt: string;
  payloadHash: string | null;
}

interface StoreOption {
  id: string;
  displayName: string;
  platform: string;
}

const TYPES = [{ key: "new_order", labelKey: "review.newOrders" }] as const;

// The Conflicts tab is a dedicated surface over order_update records flagged
// payload.conflict (boss decision: keep them out of the normal flow).
function queueQuery(type: string, storeId: string) {
  if (type === "conflict") {
    return { type: "order_update", storeId: storeId || undefined, conflict: "true" };
  }
  if (type === "order_update") {
    return { type, storeId: storeId || undefined, conflict: "false" };
  }
  return { type, storeId: storeId || undefined };
}

export default function ReviewPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const root = useRouteLoaderData<typeof rootLoader>("root");
  const permissions = new Set(root?.user.permissions ?? []);
  const canCancel = permissions.has("orders:cancel");
  const [searchParams, setSearchParams] = useSearchParams();
  const type = searchParams.get("type") ?? "new_order";
  const [storeId, setStoreId] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [returnedOnly, setReturnedOnly] = useState(false);
  const [busyReview, setBusyReview] = useState(false);

  const categories = useQuery({
    queryKey: ["categories"],
    queryFn: async () => {
      const { data, response } = await api.GET("/api/v1/categories");
      if (!response.ok || !data) return [] as Array<{ id: string; name: string }>;
      return data as unknown as Array<{ id: string; name: string }>;
    },
  });

  const shippingRegions = useQuery({
    queryKey: ["shipping-regions"],
    queryFn: async () => {
      const { data, response } = await api.GET("/api/v1/shipping-regions");
      if (!response.ok || !data) return [] as Array<{ id: string; name: string }>;
      return data as unknown as Array<{ id: string; name: string }>;
    },
  });

  const stores = useQuery({
    queryKey: ["stores"],
    queryFn: async () => {
      const { data, response } = await api.GET("/api/v1/stores");
      if (!response.ok || !data) return [] as StoreOption[];
      return data as unknown as StoreOption[];
    },
  });

  const records = useQuery({
    queryKey: ["review", type, storeId],
    queryFn: async () => {
      const { data, response } = await api.GET("/api/v1/review-queue", {
        params: { query: queueQuery(type, storeId) as never },
      });
      if (!response.ok || !data) throw new Error(`List failed (${response.status})`);
      return data as unknown as { records: ReviewRecordView[]; total: number };
    },
  });

  const recordIds = (records.data?.records ?? []).map((r) => r.id);
  const allSelected = recordIds.length > 0 && recordIds.every((id) => selected.has(id));

  const refresh = () => {
    setSelected(new Set());
    setExpandedId(null);
    queryClient.invalidateQueries({ queryKey: ["review", type, storeId] });
    queryClient.invalidateQueries({ queryKey: ["orders"] });
    queryClient.invalidateQueries({ queryKey: ["listings"] });
  };

  const act = async (
    path: "/api/v1/review-queue/{id}/approve" | "/api/v1/review-queue/{id}/reject",
    id: string,
    assignment?: { shippingRegionId?: string; categoryId?: string; note?: string },
  ) => {
    setError(null);
    setBusyReview(true);
    const body =
      path.endsWith("approve") && assignment && Object.keys(assignment).length > 0
        ? (assignment as Record<string, string>)
        : undefined;
    const { response } = await api.POST(path, {
      params: { path: { id } },
      ...(body ? { body: body as never } : {}),
    });
    setBusyReview(false);
    if (!response.ok) {
      setError(
        `${path.includes("approve") ? t("review.approve") : t("review.reject")} failed (${response.status}).`,
      );
      return false;
    }
    await refresh();
    return true;
  };

  const approveBatch = async (ids: string[]) => {
    if (ids.length === 0) return;
    setError(null);
    const { data, response } = await api.POST("/api/v1/review-queue/approve-batch", {
      body: { ids },
    });
    if (!response.ok || !data) {
      setError(t("review.batchFailed", { status: response.status }));
      return;
    }
    const result = data as { approved: number; failures: Array<{ id: string }> };
    if (result.failures.length > 0) {
      setError(t("review.batchPartial", { approved: result.approved, failed: result.failures.length }));
    }
    await refresh();
  };

  const toggleSelected = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const cancelOrder = async (orderId: string, reason: string) => {
    setError(null);
    const { response } = await api.POST("/api/v1/orders/{id}/cancel", {
      params: { path: { id: orderId } },
      body: { reason } as never,
    });
    if (!response.ok) {
      setError(t("review.cancelFailed", { status: response.status }));
      return;
    }
    await refresh();
  };

  return (
    <div className="space-y-4">
      <PageHeader title={t("review.title")} />

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <div className="flex overflow-hidden rounded-xl border border-ink/15">
          {TYPES.map((queue) => (
            <button
              key={queue.key}
              type="button"
              onClick={() => {
                setSelected(new Set());
                setExpandedId(null);
                setSearchParams(queue.key === "new_order" ? {} : { type: queue.key });
              }}
              className={`px-3.5 py-1.5 transition-colors ${
                type === queue.key
                  ? "bg-ink font-semibold text-white"
                  : "bg-white text-slate-600 hover:bg-pill hover:text-ink"
              }`}
            >
              {t(queue.labelKey)}
            </button>
          ))}
        </div>
      </div>

      {type === "conflict" ? (
        <p className="mt-2 text-sm text-slate-500">
          {t("review.conflictsDescription")}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <select
          value={storeId}
          onChange={(event) => {
            setStoreId(event.target.value);
            setSelected(new Set());
          }}
          className="rounded-lg border border-ink/20 bg-white px-2 py-1.5"
        >
          <option value="">{t("review.allStores")}</option>
          {(stores.data ?? []).map((store) => (
            <option key={store.id} value={store.id}>
              {store.displayName} · {store.platform}
            </option>
          ))}
        </select>
        {selected.size > 0 ? (
          <>
            <button
              type="button"
              onClick={() => void approveBatch([...selected])}
              className="rounded bg-emerald-700 px-3 py-1 font-medium text-white hover:bg-emerald-600"
            >
              {t("review.approveSelected", { count: selected.size })}
            </button>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="rounded-lg border border-ink/20 px-2 py-1 hover:bg-pill"
            >
              {t("review.clearSelection")}
            </button>
          </>
        ) : null}
      </div>


      {type === "new_order" ? (
        <div className="flex items-center gap-2 text-sm">
          <button
            type="button"
            onClick={() => setReturnedOnly(false)}
            className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
              !returnedOnly ? "bg-brand text-white" : "bg-pill text-slate-600 hover:text-ink"
            }`}
          >
            {t("review.allQueue")}
          </button>
          <button
            type="button"
            onClick={() => setReturnedOnly(true)}
            className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
              returnedOnly ? "bg-brand text-white" : "bg-pill text-slate-600 hover:text-ink"
            }`}
          >
            {t("review.returnedQueue")}
          </button>
        </div>
      ) : null}

      {error ? (
        <p className="mt-3 text-sm text-red-600" role="alert">{error}</p>
      ) : null}

      <ul className="mt-3 space-y-2">
        {records.isLoading ? (
          <li className="text-sm text-slate-400">{t("common.loading")}</li>
        ) : records.data && records.data.records.length > 0 ? (
          type === "new_order" ? (
            records.data.records.map((record) => {
              const store = (stores.data ?? []).find((st) => st.id === record.storeId);
              return (
                <NewOrderReviewCard
                  key={record.id}
                  record={record as unknown as NewOrderRecord}
                  categories={categories.data ?? []}
                  shippingRegions={shippingRegions.data ?? []}
                  storeName={store?.displayName ?? record.storeName ?? null}
                  platform={store?.platform ?? record.platform ?? null}
                  canCancel={canCancel}
                  onCancel={(orderId, reason) => void cancelOrder(orderId, reason)}
                  onChanged={() => void refresh()}
                  busy={busyReview}
                  onApprove={(recordId, assignment) =>
                    void act("/api/v1/review-queue/{id}/approve", recordId, assignment)
                  }
                />
              );
            })
          ) : (
            <>
              <li className="flex items-center gap-3 rounded-xl border border-ink/10 bg-white px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={(event) =>
                    setSelected(event.target.checked ? new Set(recordIds) : new Set())
                  }
                  aria-label={t("review.selectAll")}
                />
                <span className="text-slate-500">{t("review.selectAll")}</span>
              </li>
              {records.data.records.map((record) => (
                <ReviewRow
                  key={record.id}
                  record={record}
                  selected={selected.has(record.id)}
                  expanded={expandedId === record.id}
                  onToggleSelect={() => toggleSelected(record.id)}
                  onToggleExpand={() =>
                    setExpandedId((current) => (current === record.id ? null : record.id))
                  }
                  onApprove={() => act("/api/v1/review-queue/{id}/approve", record.id)}
                  onReject={() => act("/api/v1/review-queue/{id}/reject", record.id)}
                />
              ))}
            </>
          )
        ) : (
          <li><EmptyState message={t("review.noPending")} /></li>
        )}
      </ul>
    </div>
  );
}

function ReviewRow({
  record,
  selected,
  expanded,
  onToggleSelect,
  onToggleExpand,
  onApprove,
  onReject,
}: {
  record: ReviewRecordView;
  selected: boolean;
  expanded: boolean;
  onToggleSelect: () => void;
  onToggleExpand: () => void;
  onApprove: () => Promise<boolean>;
  onReject: () => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const order = record.payload?.order;
  return (
    <li className="pop-shadow-sm rounded-xl border border-ink/10 bg-white p-3 text-sm transition-transform hover:-translate-y-0.5">
      <div className="flex items-center justify-between gap-3">
        {/* Selection stays isolated from expansion. */}
        <div className="flex min-w-0 items-center gap-2">
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            aria-label={t("review.select")}
          />
          <button
            type="button"
            onClick={onToggleExpand}
            className="shrink-0 rounded-lg border border-ink/20 px-2 py-0.5 text-xs text-slate-600 hover:bg-pill"
          >
            {expanded ? t("review.collapse") : t("review.expand")}
          </button>
          <span className="truncate font-medium">
            {order?.displayNumber ??
              record.payload?.listing?.title ??
              record.payload?.orderNumber ??
              record.id}
          </span>
          {record.type === "shipment" && record.payload?.kind === "revision" ? (
            <span className="whitespace-nowrap rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
              {t("review.shipmentRevisionBadge")}
            </span>
          ) : null}
          {record.payload?.conflict ? (
            <span className="whitespace-nowrap rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-700">
              {t("review.conflictBadge")}
            </span>
          ) : null}
          <span className="whitespace-nowrap rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">
            {record.type === "new_order"
              ? t("review.newOrders")
              : record.type === "order_update"
                ? t("review.orderUpdates")
                : record.type === "shipment"
                  ? t("review.outboundShipments")
                  : t("review.listings")}
          </span>
        </div>
        <span className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => void onApprove()}
            className={buttonClasses.primary}
          >
            {t("review.approve")}
          </button>
          <button
            type="button"
            onClick={() => void onReject()}
            className={buttonClasses.secondary}
          >
            {t("review.reject")}
          </button>
        </span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-600 md:grid-cols-4">
        {order?.customer?.name ? (
          <span>
            <span className="text-slate-400">{t("orders.customer")}: </span>
            {order.customer.name}
          </span>
        ) : null}
        {order?.lines?.length ? (
          <span className="min-w-0 truncate">
            <span className="text-slate-400">{t("orders.lines")}: </span>
            {order.lines.map((line) => `${line.title} ×${line.quantity}`).join(", ")}
          </span>
        ) : null}
        {order?.sourceUpdatedAt ? (
          <span>
            <span className="text-slate-400">{t("review.orderTime")}: </span>
            {new Date(order.sourceUpdatedAt).toLocaleString()}
          </span>
        ) : null}
        {order?.buyerNote ? (
          <span className="min-w-0 truncate">
            <span className="text-slate-400">{t("review.buyerNote")}: </span>
            {order.buyerNote}
          </span>
        ) : null}
        {record.payload?.listing?.title ? (
          <span>
            <span className="text-slate-400">{t("listings.title")}: </span>
            {record.payload.listing.title}
          </span>
        ) : null}
        {record.payload?.listing?.status ? (
          <span>
            <span className="text-slate-400">{t("listings.status")}: </span>
            {record.payload.listing.status}
          </span>
        ) : null}
        {record.type === "shipment" ? (
          <ShipmentSummary payload={record.payload} />
        ) : null}
      </div>
      {expanded ? (
        <div className="mt-2 space-y-2">
          {record.type === "order_update" ? (
            <OrderUpdateDiff record={record} />
          ) : null}
          {record.type === "new_order" ? (
            <p className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs text-emerald-800">
              {t("review.newOrderHint")}
            </p>
          ) : null}
          {record.type === "listing" ? (
            <p className="rounded border border-sky-200 bg-sky-50 px-2 py-1 text-xs text-sky-800">
              {t("review.listingHint", {
                title: record.payload?.listing?.title ?? "",
                status: record.payload?.listing?.status ?? "",
              })}
            </p>
          ) : null}
          {record.type === "shipment" ? (
            <p className="rounded border border-sky-200 bg-sky-50 px-2 py-1 text-xs text-sky-800">
              {record.payload?.customerNotification === "mandated"
                ? t("review.shipmentHintMandated")
                : t("review.shipmentHint")}
            </p>
          ) : null}
          <details>
            <summary className="cursor-pointer text-xs text-slate-400">
              {t("review.rawPayload")}
            </summary>
            <pre className="mt-1 max-h-64 overflow-auto rounded bg-slate-900 p-2 text-xs text-slate-100">
              {JSON.stringify(record.payload, null, 2)}
            </pre>
          </details>
        </div>
      ) : null}
    </li>
  );
}

/** Compact shipment facts for the Outbound Shipping queue rows (§12.10). */
function ShipmentSummary({
  payload,
}: {
  payload: ReviewRecordView["payload"];
}) {
  const { t } = useTranslation();
  if (!payload?.attakyTrackingNumber) return null;
  return (
    <>
      <span className="min-w-0 truncate">
        <span className="text-slate-400">{t("shipments.attakyNumber")}: </span>
        <span className="font-mono">{payload.attakyTrackingNumber}</span>
      </span>
      <span>
        <span className="text-slate-400">{t("shipments.policyLabel")}: </span>
        {t(`shipments.policy${policyLabel(payload.policyMode)}`)}
      </span>
      {payload.projectedSendAt ? (
        <span>
          <span className="text-slate-400">{t("shipments.plannedSend")}: </span>
          {new Date(payload.projectedSendAt).toLocaleString()}
        </span>
      ) : null}
      {payload.storeName ? (
        <span className="min-w-0 truncate">
          <span className="text-slate-400">{t("review.storeColumn")}: </span>
          {payload.storeName}
        </span>
      ) : null}
    </>
  );
}

function policyLabel(mode?: string | null): string {
  switch (mode) {
    case "scheduled":
      return "Scheduled";
    case "review_then_immediate":
      return "ReviewThenImmediate";
    case "review_then_scheduled":
      return "ReviewThenScheduled";
    case "not_applicable":
      return "NotApplicable";
    default:
      return "Immediate";
  }
}

function normalizeValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.trim() === "" ? "—" : text;
}

/** "What changed" view for one order-update record: current system value vs
 *  the incoming platform value, field by field (no raw JSON). */
function OrderUpdateDiff({ record }: { record: ReviewRecordView }) {
  const { t } = useTranslation();
  const incoming = record.payload?.order;

  const current = useQuery({
    queryKey: ["order", record.subjectId],
    queryFn: async () => {
      if (!record.subjectId) return null;
      const { data, response } = await api.GET("/api/v1/orders/{id}", {
        params: { path: { id: record.subjectId } },
      });
      if (!response.ok || !data) return null;
      return data as unknown as {
        buyerNote: string | null;
        customerSnapshot?: { name?: string } | null;
        statusRaw?: { financialStatus?: string } | null;
      };
    },
    enabled: Boolean(record.subjectId),
  });

  const rows = [
    {
      label: t("review.buyerNote"),
      current: current.data?.buyerNote ?? null,
      incoming: incoming?.buyerNote ?? null,
    },
    {
      label: t("orders.customer"),
      current: current.data?.customerSnapshot?.name ?? null,
      incoming: incoming?.customer?.name ?? null,
    },
    {
      label: t("review.statusField"),
      current: current.data?.statusRaw?.financialStatus ?? null,
      incoming: incoming?.statusRaw?.financialStatus ?? null,
    },
  ].filter(
    (row) => normalizeValue(row.current) !== normalizeValue(row.incoming),
  );

  return (
    <div className="rounded border border-slate-200 bg-slate-50 p-2">
      <p className="text-xs font-medium text-slate-700">
        {t("review.changedFieldsTitle")}
      </p>
      {record.payload?.conflict && record.payload.conflictFields?.length ? (
        <div className="mt-1 rounded border border-red-200 bg-red-50 p-2">
          <p className="text-xs font-medium text-red-700">
            {t("review.conflictFieldsTitle")}
          </p>
          <table className="mt-1 w-full text-xs">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="px-2 py-1 font-medium">{t("review.fieldColumn")}</th>
                <th className="px-2 py-1 font-medium">{t("review.internalColumn")}</th>
                <th className="px-2 py-1 font-medium">{t("review.incomingColumn")}</th>
              </tr>
            </thead>
            <tbody>
              {record.payload.conflictFields.map((field) => (
                <tr key={field.key} className="border-t border-slate-100">
                  <td className="px-2 py-1 font-medium">{field.label}</td>
                  <td className="px-2 py-1">
                    {field.internalValue == null ? "—" : String(field.internalValue)}
                  </td>
                  <td className="px-2 py-1 text-red-700">
                    {field.incomingValue == null ? "—" : String(field.incomingValue)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : rows.length > 0 ? (
        <table className="mt-1 w-full text-xs">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="px-2 py-1 font-medium">{t("review.fieldColumn")}</th>
              <th className="px-2 py-1 font-medium">{t("review.currentColumn")}</th>
              <th className="px-2 py-1 font-medium">{t("review.incomingColumn")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-t border-slate-100">
                <td className="px-2 py-1 font-medium">{row.label}</td>
                <td className="px-2 py-1">{normalizeValue(row.current)}</td>
                <td className="px-2 py-1 text-emerald-700">{normalizeValue(row.incoming)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="mt-1 text-xs text-slate-400">{t("review.noFieldChanges")}</p>
      )}
    </div>
  );
}
