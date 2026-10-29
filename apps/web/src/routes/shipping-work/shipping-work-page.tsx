import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { api } from "../../api-client/client";
import { PageHeader, Card, EmptyState, Badge, buttonClasses } from "../../components/ui";
import { Modal } from "../../components/modal";
import { useRouteLoaderData } from "react-router";
import type { rootLoader } from "../../layouts/root-loader";
import { parseNoteBody } from "../orders/note-display";

interface WorkLine {
  id: string;
  title: string | null;
  quantity: number;
  itemVariant?: { itemCode: string; name: string } | null;
}

interface WorkOrder {
  id: string;
  displayNumber: string;
  stage: string;
  customerSnapshot: Record<string, unknown> | null;
  buyerNote: string | null;
  shippingRegion?: { id: string; name: string; warehouse?: string } | null;
  category?: { id: string; name: string } | null;
  lines: WorkLine[];
  addOns?: Array<{
    id: string;
    title: string;
    quantity: number;
    note: string | null;
    itemVariant?: { id: string; itemCode: string; name: string } | null;
  }>;
  notes?: Array<{ body: string; createdAt: string }>;
  shipments?: Array<{
    id: string;
    carrier?: { name: string } | null;
    originalTrackingNumber: string | null;
    attakyTrackingNumber: string | null;
    weightGrams: number | null;
    lengthCm: number | null;
    widthCm: number | null;
    heightCm: number | null;
  }>;
}

interface TailShipment {
  id: string;
  order: {
    id: string;
    displayNumber: string;
    customerSnapshot: Record<string, unknown> | null;
    shippingRegion?: { id: string; name: string; warehouse?: string } | null;
  };
  carrier: { id: string; key: string; name: string };
  originalTrackingNumber: string | null;
}

interface CarrierOption {
  id: string;
  name: string;
  orderUrlTemplate: string | null;
}

interface VariantOption {
  id: string;
  itemCode: string;
  name: string;
  nameEn?: string | null;
  item: { id: string; name: string; nameEn?: string | null };
  stocks?: Array<{ warehouse: string; quantity: number; archivedAt?: string | null }>;
}

interface FailedShipmentRow {
  id: string;
  orderId: string;
  orderNumber: string;
  storeName: string | null;
  carrier: { name: string } | null;
  attakyTrackingNumber: string | null;
  originalTrackingNumber: string | null;
  remoteSyncStatus: string;
  nextSendAt: string | null;
  attempts: number | null;
}

const FAILURE_STATUS_KEYS: Record<string, string> = {
  failed: "shipments.statusFailed",
  manual_action_required: "shipments.statusManualAction",
  partially_synced: "shipments.statusPartiallySynced",
  scheduled: "shipments.statusScheduled",
  pending_review: "shipments.statusPendingReview",
};

type Tab = "packing" | "ordering" | "inspection" | "tail" | "needs_attention";

const TAB_DEFS: Array<{ key: Tab; labelKey: string; introKey: string }> = [
  { key: "packing", labelKey: "work.packingTab", introKey: "work.packingIntro" },
  { key: "ordering", labelKey: "work.orderingTab", introKey: "work.orderingIntro" },
  { key: "inspection", labelKey: "work.inspectionTab", introKey: "work.inspectionIntro" },
  { key: "tail", labelKey: "work.tailTab", introKey: "work.tailIntro" },
  { key: "needs_attention", labelKey: "work.failedTab", introKey: "work.failedIntro" },
];

function customerName(order: WorkOrder | TailShipment["order"]): string {
  const name = (order.customerSnapshot ?? {}).name;
  return typeof name === "string" && name ? name : "—";
}

export default function ShippingWorkPage({ tab }: { tab: Tab }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const root = useRouteLoaderData<typeof rootLoader>("root");
  const permissions = new Set(root?.user.permissions ?? []);
  const [error, setError] = useState<string | null>(null);
  const [alertDialog, setAlertDialog] = useState<{
    title: string;
    message: string;
    shortages?: Array<{ title: string; current: number; required: number }>;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  const orders = useQuery({
    queryKey: ["shipping-work", tab],
    enabled: tab !== "tail" && tab !== "needs_attention",
    queryFn: async () => {
      const { data, response } = await api.GET(
        `/api/v1/shipping-work/${tab}` as never,
      );
      if (!response.ok || !data) throw new Error(`Load failed (${response.status})`);
      return data as unknown as WorkOrder[];
    },
  });

  const tail = useQuery({
    queryKey: ["shipping-work", "tail"],
    enabled: tab === "tail",
    queryFn: async () => {
      const { data, response } = await api.GET("/api/v1/shipping-work/tail");
      if (!response.ok || !data) throw new Error(`Load failed (${response.status})`);
      return data as unknown as TailShipment[];
    },
  });

  const failures = useQuery({
    queryKey: ["shipping-work", "needs_attention"],
    enabled: tab === "needs_attention",
    queryFn: async () => {
      const { data, response } = await api.GET("/api/v1/shipments", {
        params: { query: { view: "needs_attention" } as never },
      });
      if (!response.ok || !data) throw new Error(`Load failed (${response.status})`);
      return data as unknown as { shipments: FailedShipmentRow[]; total: number };
    },
  });

  const carriers = useQuery({
    queryKey: ["carriers"],
    enabled: tab === "ordering",
    queryFn: async () => {
      const { data, response } = await api.GET("/api/v1/carriers");
      if (!response.ok || !data) return [] as CarrierOption[];
      return data as unknown as CarrierOption[];
    },
  });

  const variants = useQuery({
    queryKey: ["item-variants"],
    enabled: tab === "packing",
    queryFn: async () => {
      const { data, response } = await api.GET("/api/v1/item-variants");
      if (!response.ok || !data) return [] as VariantOption[];
      return data as unknown as VariantOption[];
    },
  });

  const refresh = () => {
    setError(null);
    queryClient.invalidateQueries({ queryKey: ["shipping-work"] });
    queryClient.invalidateQueries({ queryKey: ["orders"] });
  };

  const run = async (
    action: () => Promise<{ response: Response; error?: unknown }>,
    failed: string,
  ) => {
    setBusy(true);
    setError(null);
    try {
      const { response, error } = await action();
      if (!response.ok) {
        // openapi-fetch has already consumed and parsed the error body
        // (response.clone() would throw); read it from `error`.
        const body = (error ?? null) as
          | {
              message?: string;
              code?: string;
              shortages?: Array<{ title: string; current: number; required: number }>;
            }
          | null;
        const message =
          typeof body?.message === "string" ? body.message : failed;
        setError(message);
        // A blocked action is easy to miss as a top-of-page notice: pop a
        // dialog so the operator sees why, listing the exact shortages.
        setAlertDialog({
          title:
            body?.code === "INSUFFICIENT_STOCK"
              ? t("work.insufficientStockTitle")
              : t("work.actionFailedTitle"),
          message,
          shortages: body?.shortages,
        });
        return;
      }
      refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={t(TAB_DEFS.find((item) => item.key === tab)?.labelKey ?? "work.title")}
        description={t(TAB_DEFS.find((item) => item.key === tab)?.introKey ?? "work.intro")}
      />

      {alertDialog ? (
        <Modal
          title={alertDialog.title}
          onClose={() => setAlertDialog(null)}
        >
          <div className="space-y-3 text-sm">
            <p className="font-medium text-red-700" role="alert">{alertDialog.message}</p>
            {alertDialog.shortages && alertDialog.shortages.length > 0 ? (
              <div>
                <p className="text-xs text-slate-500">{t("work.shortageListLabel")}</p>
                <ul className="mt-1 space-y-1">
                  {alertDialog.shortages.map((row) => (
                    <li
                      key={row.title}
                      className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-800"
                    >
                      {row.title}
                      <span className="ml-2 font-mono">
                        {t("work.shortageRow", {
                          current: row.current,
                          required: row.required,
                        })}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setAlertDialog(null)}
                className={buttonClasses.primary}
              >
                {t("common.close")}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      {error ? <p className="text-sm text-red-600" role="alert">{error}</p> : null}

      {tab === "needs_attention" ? (
        failures.isLoading ? (
          <Card><p className="text-sm text-slate-400">{t("common.loading")}</p></Card>
        ) : failures.data && failures.data.shipments.length > 0 ? (
          <Card className="overflow-hidden">
            <div className="-m-4 overflow-x-auto">
              <table className="w-full min-w-[820px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-ink/10 text-left text-xs uppercase tracking-wide text-slate-400">
                    <th className="px-4 py-2.5 font-semibold">{t("orders.number")}</th>
                    <th className="px-3 py-2.5 font-semibold">{t("review.store")}</th>
                    <th className="px-3 py-2.5 font-semibold">{t("work.carrier")}</th>
                    <th className="px-3 py-2.5 font-semibold">{t("work.trackingNumber")}</th>
                    <th className="px-3 py-2.5 font-semibold">{t("shipments.statusLabel")}</th>
                    <th className="px-3 py-2.5 font-semibold">{t("shipments.nextSendLabel")}</th>
                  </tr>
                </thead>
                <tbody>
                  {failures.data.shipments.map((row) => (
                    <tr key={row.id} className="border-b border-ink/5 last:border-0 hover:bg-pill">
                      <td className="px-4 py-2.5">
                        <Link
                          to={`/orders/${row.orderId}`}
                          className="font-mono text-[13px] text-play-blue hover:underline"
                        >
                          {row.orderNumber}
                        </Link>
                      </td>
                      <td className="px-3 py-2.5">{row.storeName ?? "—"}</td>
                      <td className="px-3 py-2.5">{row.carrier?.name ?? "—"}</td>
                      <td className="px-3 py-2.5 font-mono text-xs">
                        {row.attakyTrackingNumber ?? row.originalTrackingNumber ?? "—"}
                      </td>
                      <td className="px-3 py-2.5">
                        <Badge tone="danger">
                          {t(FAILURE_STATUS_KEYS[row.remoteSyncStatus] ?? "shipments.statusFailed")}
                        </Badge>
                      </td>
                      <td className="px-3 py-2.5 text-xs text-slate-500">
                        {row.nextSendAt ? new Date(row.nextSendAt).toLocaleString() : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ) : (
          <EmptyState message={t("work.empty")} />
        )
      ) : tab === "tail" ? (
        tail.isLoading ? (
          <Card><p className="text-sm text-slate-400">{t("common.loading")}</p></Card>
        ) : tail.data && tail.data.length > 0 ? (
          <div className="space-y-2">
            {tail.data.map((shipment) => (
              <TailCard
                key={shipment.id}
                shipment={shipment}
                canSave={permissions.has("shipping:tail")}
                busy={busy}
                onSave={(body) =>
                  run(
                    () =>
                      api
                        .POST("/api/v1/shipping-work/{orderId}/tail", {
                          params: { path: { orderId: shipment.order.id } },
                          body: body as never,
                        })
  ,
                    t("work.saveFailed"),
                  )
                }
              />
            ))}
          </div>
        ) : (
          <EmptyState message={t("work.empty")} />
        )
      ) : orders.isLoading ? (
        <Card><p className="text-sm text-slate-400">{t("common.loading")}</p></Card>
      ) : orders.isError ? (
        <p className="text-sm text-red-600">{(orders.error as Error).message}</p>
      ) : orders.data && orders.data.length > 0 ? (
        <div className="space-y-2">
          {orders.data.map((order) => (
            <WorkCard
              key={order.id}
              tab={tab}
              order={order}
              carriers={carriers.data ?? []}
              variants={(variants.data ?? []).filter(variant => !variant.stocks?.some(stock => stock.warehouse === order.shippingRegion?.warehouse && stock.archivedAt))}
              permissions={permissions}
              busy={busy}
              onPack={(body) =>
                run(
                  () =>
                    api
                      .POST("/api/v1/shipping-work/{orderId}/pack", {
                        params: { path: { orderId: order.id } },
                        body: body as never,
                      })
,
                  t("work.packFailed"),
                )
              }
              onTracking={(body) =>
                run(
                  () =>
                    api
                      .POST("/api/v1/shipping-work/{orderId}/tracking", {
                        params: { path: { orderId: order.id } },
                        body: body as never,
                      })
,
                  t("work.trackingFailed"),
                )
              }
              onReturn={(orderId, note) =>
                run(
                  () =>
                    api
                      .POST("/api/v1/shipping-work/{orderId}/return-to-review", {
                        params: { path: { orderId } },
                        body: { note } as never,
                      })
,
                  t("work.returnFailed"),
                )
              }
              onInspect={(note) =>
                run(
                  () =>
                    api
                      .POST("/api/v1/shipping-work/{orderId}/inspect", {
                        params: { path: { orderId: order.id } },
                        body: { note } as never,
                      })
,
                  t("work.inspectFailed"),
                )
              }
              onAddOn={(body) =>
                run(
                  () =>
                    api
                      .POST("/api/v1/shipping-work/{orderId}/add-ons", {
                        params: { path: { orderId: order.id } },
                        body: body as never,
                      })
,
                  t("work.addOnFailed"),
                )
              }
              onRemoveAddOn={(addOnId) =>
                run(
                  () =>
                    api
                      .DELETE("/api/v1/shipping-work/{orderId}/add-ons/{addOnId}", {
                        params: { path: { orderId: order.id, addOnId } },
                      })
,
                  t("work.addOnRemoveFailed"),
                )
              }
              onProblem={(body) =>
                run(
                  () =>
                    api
                      .POST("/api/v1/shipping-work/{orderId}/problem", {
                        params: { path: { orderId: order.id } },
                        body: body as never,
                      })
,
                  t("work.problemFailed"),
                )
              }
              canReportProblem={permissions.has("shipping:issue-report")}
            />
          ))}
        </div>
      ) : (
        <EmptyState message={t("work.empty")} />
      )}
    </div>
  );
}

function WorkCard({
  tab,
  order,
  carriers,
  variants,
  permissions,
  busy,
  onPack,
  onTracking,
  onInspect,
  onAddOn,
  onRemoveAddOn,
  onReturn,
  onProblem,
  canReportProblem,
}: {
  tab: Tab;
  order: WorkOrder;
  carriers: CarrierOption[];
  variants: VariantOption[];
  permissions: Set<string>;
  busy: boolean;
  onPack: (body: {
    weightValue: number;
    weightUnit: string;
    lengthValue: number;
    widthValue: number;
    heightValue: number;
    dimensionUnit: string;
    note?: string;
  }) => void;
  onTracking: (body: { carrierId: string; trackingNumber: string; note?: string }) => void;
  onInspect: (note?: string) => void;
  onReturn: (orderId: string, note: string) => void;
  onProblem: (body: { type: string; content: string; source: "work" }) => void;
  canReportProblem: boolean;
  onAddOn: (body: {
    itemVariantId?: string;
    title: string;
    quantity: number;
    note?: string;
    weightValue?: number;
    weightUnit?: string;
    lengthValue?: number;
    widthValue?: number;
    heightValue?: number;
    dimensionUnit?: string;
  }) => void;
  onRemoveAddOn: (addOnId: string) => void;
}) {
  const { t } = useTranslation();
  const [weightValue, setWeightValue] = useState("");
  const [weightUnit, setWeightUnit] = useState("g");
  const [lengthValue, setLengthValue] = useState("");
  const [widthValue, setWidthValue] = useState("");
  const [heightValue, setHeightValue] = useState("");
  const [dimensionUnit, setDimensionUnit] = useState("cm");
  const [carrierId, setCarrierId] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [stepNote, setStepNote] = useState("");
  const [addOnOpen, setAddOnOpen] = useState(false);
  const [addOnVariantId, setAddOnVariantId] = useState("");
  const [addOnQuantity, setAddOnQuantity] = useState("1");
  const [addOnNote, setAddOnNote] = useState("");
  const [returnOpen, setReturnOpen] = useState(false);
  const [packOpen, setPackOpen] = useState(false);
  const [problemOpen, setProblemOpen] = useState(false);
  const [problemType, setProblemType] = useState("other");
  const [problemContent, setProblemContent] = useState("");
  const preview = useQuery({
    queryKey: ["packing-preview", order.id],
    enabled: packOpen,
    queryFn: async () => {
      const { data, response } = await api.GET("/api/v1/shipping-work/{orderId}/packing-preview", {
        params: { path: { orderId: order.id } },
      });
      if (!response.ok || !data) throw new Error(`Load failed (${response.status})`);
      return data as unknown as {
        rows: Array<{
          inventoryItemVariantId: string;
          title: string;
          warehouse: string;
          current: number;
          required: number;
          after: number | null;
          low: boolean;
        }>;
      };
    },
  });
  const [returnNote, setReturnNote] = useState("");
  const [inspectOpen, setInspectOpen] = useState(false);
  const shipment = order.shipments?.[0];

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-display text-base font-semibold text-ink">
          {order.displayNumber}
        </span>
        {order.shippingRegion ? <Badge tone="info">{order.shippingRegion.name}</Badge> : null}
        {order.category ? <Badge tone="neutral">{order.category.name}</Badge> : null}
        <span className="ml-auto text-xs text-slate-400">{customerName(order)}</span>
      </div>

      <div className="mt-2 grid gap-3 text-sm md:grid-cols-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            {t("work.products")}
          </p>
          <ul className="mt-1 space-y-0.5">
            {order.lines.map((line) => (
              <li key={line.id} className="flex justify-between gap-3">
                <span className="truncate">{line.title ?? "—"}</span>
                <span className="font-mono text-slate-500">× {line.quantity}</span>
              </li>
            ))}
          </ul>
          {(order.addOns ?? []).length > 0 ? (
            <div className="mt-2 text-xs text-slate-600">
              <span className="font-medium">{t("work.addOns")}:</span>
              <ul className="mt-0.5 space-y-0.5">
                {(order.addOns ?? []).map((addOn) => (
                  <li key={addOn.id} className="flex items-center justify-between gap-2">
                    <span>
                      {addOn.title} × {addOn.quantity}
                      {addOn.itemVariant ? (
                        <span className="ml-1 font-mono text-slate-400">
                          {addOn.itemVariant.itemCode}
                        </span>
                      ) : null}
                    </span>
                    {tab === "packing" && permissions.has("shipping:weigh") ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onRemoveAddOn(addOn.id)}
                        className="text-red-600 hover:text-red-800"
                      >
                        {t("common.delete")}
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {tab === "packing" && permissions.has("shipping:weigh") ? (
            addOnOpen ? (
              <div className="mt-2 space-y-1 rounded-lg border border-ink/10 bg-pill p-2 text-xs">
                <select
                  value={addOnVariantId}
                  onChange={(e) => setAddOnVariantId(e.target.value)}
                  className="w-full rounded-lg border border-ink/20 bg-white px-2 py-1"
                >
                  <option value="">{t("work.selectAddOn")}</option>
                  {(() => {
                    const groups = new Map<string, typeof variants>();
                    for (const variant of variants) {
                      const label =
                        variant.item.nameEn && variant.item.nameEn !== variant.item.name
                          ? `${variant.item.name} · ${variant.item.nameEn}`
                          : variant.item.name;
                      const list = groups.get(label) ?? [];
                      list.push(variant);
                      groups.set(label, list);
                    }
                    return [...groups.entries()].map(([label, list]) => (
                      <optgroup key={label} label={label}>
                        {list.map((variant) => (
                          <option key={variant.id} value={variant.id}>
                            {variant.nameEn && variant.nameEn !== variant.name
                              ? `${variant.name} · ${variant.nameEn}`
                              : variant.name}{' '}
                            ({variant.itemCode})
                          </option>
                        ))}
                      </optgroup>
                    ));
                  })()}
                </select>
                <div className="flex gap-2">
                  <input
                    type="number"
                    min="1"
                    value={addOnQuantity}
                    onChange={(e) => setAddOnQuantity(e.target.value)}
                    className="w-20 rounded-lg border border-ink/20 bg-white px-2 py-1"
                  />
                  <input
                    value={addOnNote}
                    onChange={(e) => setAddOnNote(e.target.value)}
                    placeholder={t("work.addOnNote")}
                    className="flex-1 rounded-lg border border-ink/20 bg-white px-2 py-1"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setAddOnOpen(false)} className={buttonClasses.secondary}>
                    {t("common.cancel")}
                  </button>
                  <button
                    type="button"
                    disabled={busy || !addOnVariantId}
                    onClick={() => {
                      const variant = variants.find((v) => v.id === addOnVariantId);
                      if (!variant) return;
                      onAddOn({
                        itemVariantId: variant.id,
                        title: `${variant.item.name} / ${variant.name}`,
                        quantity: Math.max(1, Number(addOnQuantity) || 1),
                        ...(addOnNote.trim() ? { note: addOnNote.trim() } : {}),
                      });
                      setAddOnOpen(false);
                      setAddOnVariantId("");
                      setAddOnQuantity("1");
                      setAddOnNote("");
                    }}
                    className={buttonClasses.primary}
                  >
                    {t("work.addAddOn")}
                  </button>
                </div>
                {variants.length === 0 ? (
                  <p className="text-slate-400">{t("work.noVariants")}</p>
                ) : null}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setAddOnOpen(true)}
                className={`${buttonClasses.secondary} mt-2`}
              >
                {t("work.addAddOnButton")}
              </button>
            )
          ) : null}
          {(order.notes ?? []).length > 0 ? (
            <div className="mt-2 space-y-0.5">
              {(order.notes ?? []).map((note, index) => {
                const parsed = parseNoteBody(note.body);
                const label =
                  parsed.kind === "review"
                    ? t("orders.noteKindReview")
                    : parsed.kind === "problem"
                      ? t("orders.noteKindProblem")
                      : parsed.kind === "packing"
                        ? t("orders.noteKindPacking")
                        : parsed.kind === "ordering"
                          ? t("orders.noteKindOrdering")
                          : parsed.kind === "inspection"
                            ? t("orders.noteKindInspection")
                            : parsed.kind === "tail"
                              ? t("orders.noteKindTail")
                              : t("orders.noteKindGeneric");
                return (
                  <p key={index} className="text-xs text-slate-500">
                    <span className="font-medium text-slate-600">[{label}]</span>{" "}
                    {parsed.body}
                  </p>
                );
              })}
            </div>
          ) : null}
          {order.buyerNote ? (
            <p className="mt-1 text-xs text-slate-500">
              {t("orders.buyerNote")}: {order.buyerNote}
            </p>
          ) : null}
        </div>

        <div className="space-y-2">
          {tab === "packing" ? (
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-slate-500">
                {t("work.weight")}
                <span className="ml-0.5 text-red-600" aria-hidden>*</span>
                <div className="mt-1 flex gap-1">
                  <input
                    type="number"
                    min="0"
                    value={weightValue}
                    onChange={(e) => setWeightValue(e.target.value)}
                    className="w-full rounded-lg border border-ink/20 px-2 py-1"
                  />
                  <select
                    value={weightUnit}
                    onChange={(e) => setWeightUnit(e.target.value)}
                    className="rounded-lg border border-ink/20 px-1 py-1"
                  >
                    <option value="g">g</option>
                    <option value="kg">kg</option>
                  </select>
                </div>
              </label>
              <div className="text-xs text-slate-500">
                {t("work.dimensions")}
                <span className="ml-0.5 text-red-600" aria-hidden>*</span>
                <div className="mt-1 flex gap-1">
                  <input type="number" min="0" value={lengthValue} onChange={(e) => setLengthValue(e.target.value)} placeholder="L" className="w-full rounded-lg border border-ink/20 px-1 py-1" />
                  <input type="number" min="0" value={widthValue} onChange={(e) => setWidthValue(e.target.value)} placeholder="W" className="w-full rounded-lg border border-ink/20 px-1 py-1" />
                  <input type="number" min="0" value={heightValue} onChange={(e) => setHeightValue(e.target.value)} placeholder="H" className="w-full rounded-lg border border-ink/20 px-1 py-1" />
                  <select value={dimensionUnit} onChange={(e) => setDimensionUnit(e.target.value)} className="rounded-lg border border-ink/20 px-1 py-1">
                    <option value="cm">cm</option>
                    <option value="mm">mm</option>
                    <option value="in">in</option>
                  </select>
                </div>
              </div>
              <p className="col-span-2 text-right">
                {permissions.has("shipping:return") ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setReturnOpen(true);
                      setReturnNote("");
                    }}
                    className="rounded-lg border border-ink/20 bg-white px-2.5 py-1 text-xs text-slate-600 transition-colors hover:bg-pill"
                  >
                    {t("work.returnButton")}
                  </button>
                ) : null}
              </p>
              <div className="col-span-2 flex justify-end">
                <button
                  type="button"
                  disabled={
                    busy ||
                    !permissions.has("shipping:weigh") ||
                    !(Number(weightValue) > 0) ||
                    !(Number(lengthValue) > 0) ||
                    !(Number(widthValue) > 0) ||
                    !(Number(heightValue) > 0)
                  }
                  title={
                    !(Number(weightValue) > 0) ||
                    !(Number(lengthValue) > 0) ||
                    !(Number(widthValue) > 0) ||
                    !(Number(heightValue) > 0)
                      ? t("work.packFieldsRequired")
                      : undefined
                  }
                  onClick={() => setPackOpen(true)}
                  className={buttonClasses.primary}
                >
                  {t("work.confirmPack")}
                </button>
              </div>
            </div>
          ) : null}

          {tab === "ordering" ? (
            <div className="space-y-2">
              <label className="block text-xs text-slate-500">
                {t("work.carrier")}
                <select
                  value={carrierId}
                  onChange={(e) => setCarrierId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-ink/20 px-2 py-1"
                >
                  <option value="">{t("work.selectCarrier")}</option>
                  {carriers.map((carrier) => (
                    <option key={carrier.id} value={carrier.id}>
                      {carrier.name}
                    </option>
                  ))}
                </select>
              </label>
              {carriers.find((carrier) => carrier.id === carrierId)?.orderUrlTemplate ? (
                <a
                  href={carriers.find((carrier) => carrier.id === carrierId)!.orderUrlTemplate!}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-block text-xs font-medium text-brand underline"
                >
                  {t("work.openCarrier")}
                </a>
              ) : null}
              <label className="block text-xs text-slate-500">
                {t("work.trackingNumber")}
                <input
                  value={trackingNumber}
                  onChange={(e) => setTrackingNumber(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-ink/20 px-2 py-1 font-mono"
                />
              </label>
              <div className="flex flex-wrap items-center justify-end gap-2">
                {permissions.has("shipping:return") ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setReturnOpen(true);
                      setReturnNote("");
                    }}
                    className="rounded-lg border border-ink/20 bg-white px-2.5 py-1 text-xs text-slate-600 transition-colors hover:bg-pill"
                  >
                    {t("work.returnButton")}
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={busy || !permissions.has("shipping:backfill") || !carrierId || !trackingNumber.trim()}
                  onClick={() =>
                    onTracking({
                      carrierId,
                      trackingNumber: trackingNumber.trim(),
                      note: stepNote.trim() || undefined,
                    })
                  }
                  className={buttonClasses.primary}
                >
                  {t("work.confirmTracking")}
                </button>
              </div>
            </div>
          ) : null}

          {tab === "inspection" ? (
            <div className="space-y-2 text-sm">
              <p>
                <span className="text-xs text-slate-400">{t("work.carrier")}: </span>
                {shipment?.carrier?.name ?? "—"}
              </p>
              <p>
                <span className="text-xs text-slate-400">{t("work.trackingNumber")}: </span>
                <span className="font-mono">
                  {shipment?.attakyTrackingNumber ?? shipment?.originalTrackingNumber ?? "—"}
                </span>
              </p>
              {shipment?.weightGrams != null ? (
                <p className="text-xs text-slate-500">
                  {t("work.packedInfo", {
                    weight: shipment.weightGrams,
                    dims: [shipment.lengthCm, shipment.widthCm, shipment.heightCm]
                      .filter((v) => v != null)
                      .join(" × "),
                  })}
                </p>
              ) : null}
              <div className="flex justify-end">
                <button
                  type="button"
                  disabled={busy || !permissions.has("shipping:inspect")}
                  onClick={() => setInspectOpen(true)}
                  className={buttonClasses.primary}
                >
                  {t("work.confirmInspect")}
                </button>
              </div>
            </div>
          ) : null}

          {tab !== "tail" ? (
            <div className="space-y-2 border-t border-ink/10 pt-2">
              <label className="block text-xs text-slate-500">
                {t("work.stepNote")}
                <textarea
                  value={stepNote}
                  onChange={(e) => setStepNote(e.target.value)}
                  rows={2}
                  className="mt-1 w-full rounded-lg border border-ink/20 px-2 py-1 text-xs"
                />
              </label>
              {canReportProblem && (tab === "ordering" || tab === "inspection") ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setProblemOpen(true);
                    setProblemType("other");
                    setProblemContent("");
                  }}
                  className={buttonClasses.secondary}
                >
                  {t("problem.mark")}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {packOpen ? (
        <Modal title={t("work.packConfirmTitle")} onClose={() => setPackOpen(false)}>
          <div className="space-y-2 text-sm">
            <p className="font-medium">
              {order.displayNumber} · {customerName(order)}
            </p>
            <ul className="space-y-0.5 text-xs text-slate-600">
              {(order.lines ?? []).map((line) => (
                <li key={line.id} className="flex justify-between gap-3">
                  <span>{line.title ?? "—"}</span>
                  <span className="font-mono">× {line.quantity}</span>
                </li>
              ))}
              {(order.addOns ?? []).map((addOn) => (
                <li key={addOn.id} className="flex justify-between gap-3 text-slate-500">
                  <span>{t("work.addOns")}: {addOn.title}</span>
                  <span className="font-mono">× {addOn.quantity}</span>
                </li>
              ))}
            </ul>
            {(order.notes ?? []).filter((note) => note.body.startsWith("[Review] ")).map((note, index) => (
              <p key={index} className="text-xs text-amber-700">
                {t("work.reviewNote")}: {note.body.replace(/^\[Review\]\s*/, "")}
              </p>
            ))}
            {preview.data?.rows?.length ? (
              <div className="rounded border border-ink/10 bg-pill p-2">
                <p className="mb-1 text-xs font-semibold text-slate-600">{t("work.stockDeduction")}</p>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-slate-400">
                      <th className="py-0.5">{t("work.stockItem")}</th>
                      <th className="py-0.5">{t("work.stockCurrent")}</th>
                      <th className="py-0.5">{t("work.stockRequired")}</th>
                      <th className="py-0.5">{t("work.stockAfter")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.data.rows.map((row) => (
                      <tr key={row.inventoryItemVariantId} className={row.after != null && row.after < 0 ? "text-red-600" : ""}>
                        <td className="py-0.5">{row.title}</td>
                        <td className="py-0.5">{row.current}</td>
                        <td className="py-0.5">{row.required}</td>
                        <td className="py-0.5 font-semibold">
                          {row.after != null ? row.after : "—"}
                          {row.low ? " ⚠" : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            <p className="text-xs text-slate-500">
              {t("work.packTotals", {
                weight: `${weightValue}${weightUnit}`,
                dims: `${lengthValue}${dimensionUnit} × ${widthValue}${dimensionUnit} × ${heightValue}${dimensionUnit}`,
              })}
            </p>
            <p className="text-xs text-amber-700">{t("work.packHint")}</p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setPackOpen(false)} className={buttonClasses.secondary}>
                {t("common.cancel")}
              </button>
              <button
                type="button"
                disabled={
                  busy ||
                  !(Number(weightValue) > 0) ||
                  !(Number(lengthValue) > 0) ||
                  !(Number(widthValue) > 0) ||
                  !(Number(heightValue) > 0)
                }
                onClick={() => {
                  onPack({
                    weightValue: Number(weightValue),
                    weightUnit,
                    lengthValue: Number(lengthValue),
                    widthValue: Number(widthValue),
                    heightValue: Number(heightValue),
                    dimensionUnit,
                    note: stepNote.trim() || undefined,
                  });
                  setPackOpen(false);
                }}
                className={buttonClasses.primary}
              >
                {t("work.confirmPack")}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      {problemOpen ? (
        <Modal title={t("problem.reportTitle")} onClose={() => setProblemOpen(false)}>
          <div className="space-y-3 text-sm">
            <div>
              <label className="block text-xs font-medium text-slate-500">
                {t("problem.typeLabel")}
                <select
                  value={problemType}
                  onChange={(e) => setProblemType(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-ink/20 bg-white px-2 py-1.5"
                >
                  <option value="pending_pickup">{t("problem.types.pending_pickup")}</option>
                  <option value="returning">{t("problem.types.returning")}</option>
                  <option value="address">{t("problem.types.address")}</option>
                  <option value="damaged">{t("problem.types.damaged")}</option>
                  <option value="missing">{t("problem.types.missing")}</option>
                  <option value="other">{t("problem.types.other")}</option>
                </select>
              </label>
            </div>
            <label className="block text-xs font-medium text-slate-500">
              {t("problem.contentLabel")}
              <textarea
                value={problemContent}
                onChange={(e) => setProblemContent(e.target.value)}
                rows={3}
                className="mt-1 w-full rounded-lg border border-ink/20 px-2 py-1.5"
              />
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setProblemOpen(false)} className={buttonClasses.secondary}>
                {t("common.cancel")}
              </button>
              <button
                type="button"
                disabled={busy || !problemContent.trim()}
                onClick={() =>
                  onProblem({ type: problemType, content: problemContent.trim(), source: "work" })
                }
                className={buttonClasses.danger}
              >
                {t("problem.report")}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      {returnOpen ? (
        <Modal title={t("work.returnTitle")} onClose={() => setReturnOpen(false)}>
          <div className="space-y-3 text-sm">
            <p className="text-slate-600">{t("work.returnHint")}</p>
            <label className="block text-xs text-slate-500">
              {t("work.returnNoteLabel")}
              <textarea
                value={returnNote}
                onChange={(e) => setReturnNote(e.target.value)}
                rows={3}
                className="mt-1 w-full rounded-lg border border-ink/20 px-2 py-1.5"
              />
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setReturnOpen(false)} className={buttonClasses.secondary}>
                {t("common.cancel")}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  onReturn(order.id, returnNote.trim());
                  setReturnOpen(false);
                }}
                className={buttonClasses.primary}
              >
                {t("work.returnConfirm")}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      {inspectOpen ? (
        <Modal title={t("work.inspectTitle")} onClose={() => setInspectOpen(false)}>
          <div className="space-y-2 text-sm">
            <p className="font-medium">
              {order.displayNumber} · {customerName(order)}
            </p>
            <ul className="space-y-0.5 text-xs text-slate-600">
              {(order.lines ?? []).map((line) => (
                <li key={line.id} className="flex justify-between gap-3">
                  <span>{line.title ?? "—"}</span>
                  <span className="font-mono">× {line.quantity}</span>
                </li>
              ))}
              {(order.addOns ?? []).map((addOn) => (
                <li key={addOn.id} className="flex justify-between gap-3 text-slate-500">
                  <span>{t("work.addOns")}: {addOn.title}</span>
                  <span className="font-mono">× {addOn.quantity}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-slate-500">
              {t("work.carrier")}: {shipment?.carrier?.name ?? "—"} ·{" "}
              {t("work.trackingNumber")}:{" "}
              <span className="font-mono">
                {shipment?.attakyTrackingNumber ?? shipment?.originalTrackingNumber ?? "—"}
              </span>
            </p>
            <p className="text-xs text-amber-700">{t("work.inspectHint")}</p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setInspectOpen(false)} className={buttonClasses.secondary}>
                {t("common.cancel")}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  onInspect(stepNote.trim() || undefined);
                  setInspectOpen(false);
                }}
                className={buttonClasses.primary}
              >
                {t("work.inspectConfirm")}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </Card>
  );
}

function TailCard({
  shipment,
  canSave,
  busy,
  onSave,
}: {
  shipment: TailShipment;
  canSave: boolean;
  busy: boolean;
  onSave: (body: {
    tailTrackingNumber: string;
    tailCarrier?: string;
    tailTrackingUrl?: string;
    note?: string;
  }) => void;
}) {
  const { t } = useTranslation();
  const [number, setNumber] = useState("");
  const [carrier, setCarrier] = useState("");
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-display text-base font-semibold text-ink">
          {shipment.order.displayNumber}
        </span>
        <Badge tone="neutral">{shipment.carrier.name}</Badge>
        {shipment.order.shippingRegion ? (
          <Badge tone="info">{shipment.order.shippingRegion.name}</Badge>
        ) : null}
        <span className="ml-auto text-xs text-slate-400">
          {customerName(shipment.order)}
        </span>
      </div>
      <div className="mt-2 grid gap-2 text-sm md:grid-cols-3">
        <label className="text-xs text-slate-500">
          {t("work.tailNumber")}
          <input
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            className="mt-1 w-full rounded-lg border border-ink/20 px-2 py-1 font-mono"
          />
        </label>
        <label className="text-xs text-slate-500">
          {t("work.tailCarrier")}
          <input
            value={carrier}
            onChange={(e) => setCarrier(e.target.value)}
            className="mt-1 w-full rounded-lg border border-ink/20 px-2 py-1"
          />
        </label>
        <label className="text-xs text-slate-500">
          {t("work.tailUrl")}
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="mt-1 w-full rounded-lg border border-ink/20 px-2 py-1 font-mono text-xs"
          />
        </label>
        <label className="text-xs text-slate-500 md:col-span-3">
          {t("work.stepNote")}
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            className="mt-1 w-full rounded-lg border border-ink/20 px-2 py-1 text-xs"
          />
        </label>
      </div>
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          disabled={busy || !canSave || !number.trim()}
          onClick={() =>
            onSave({
              tailTrackingNumber: number.trim(),
              ...(carrier.trim() ? { tailCarrier: carrier.trim() } : {}),
              ...(url.trim() ? { tailTrackingUrl: url.trim() } : {}),
              ...(note.trim() ? { note: note.trim() } : {}),
            })
          }
          className={buttonClasses.primary}
        >
          {t("common.save")}
        </button>
      </div>
    </Card>
  );
}
