import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { buttonClasses } from "../../components/ui";
import { Modal } from "../../components/modal";
import { api } from "../../api-client/client";
import { OrderStatusBadges } from "../orders/order-status-badges";

/** Rich review card for new orders (M7 R3): full details + per-order assignment. */

export interface NewOrderRecord {
  id: string;
  subjectId?: string | null;
  priorOrderCount?: number;
  reviewerNote?: string | null;
  payload: {
    returnedFromPacking?: boolean;
    returnedFromStage?: string | null;
    returnedNote?: string | null;
    shippingRegionId?: string | null;
    categoryId?: string | null;
    order?: {
      displayNumber: string;
      customer?: {
        name?: string;
        email?: string;
        phone?: string;
        addressLine1?: string;
        addressLine2?: string;
        city?: string;
        postalCode?: string;
        country?: string;
      };
      lines?: Array<{ title: string; quantity: number }>;
      buyerNote?: string | null;
      deliveryMethod?: string | null;
      statusRaw?: Record<string, unknown> | null;
      sourceUpdatedAt?: string;
    };
  } | null;
  createdAt: string;
}

interface CategoryOption {
  id: string;
  name: string;
}

interface ShippingRegionOption {
  id: string;
  name: string;
}

interface VariantOption {
  id: string;
  itemCode: string;
  name: string;
  item: { id: string; name: string };
}

type CustomerForm = {
  name: string;
  phone: string;
  email: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  postalCode: string;
  country: string;
};

const OVERDUE_MS = 24 * 60 * 60 * 1000;

export function NewOrderReviewCard({
  record,
  categories,
  shippingRegions,
  storeName,
  platform,
  canCancel,
  onApprove,
  onCancel,
  onChanged,
  busy,
}: {
  record: NewOrderRecord;
  categories: CategoryOption[];
  shippingRegions: ShippingRegionOption[];
  storeName: string | null;
  platform: string | null;
  canCancel: boolean;
  onApprove: (recordId: string, assignment: { shippingRegionId?: string; categoryId?: string; note?: string }) => void;
  onCancel: (orderId: string, reason: string) => void;
  onChanged: () => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  const [shippingRegionId, setShippingRegionId] = useState(
    record.payload?.shippingRegionId ?? "",
  );
  const [categoryId, setCategoryId] = useState(record.payload?.categoryId ?? "");
  const [note, setNote] = useState(record.reviewerNote ?? "");
  const [noteSaved, setNoteSaved] = useState(Boolean(record.reviewerNote));
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [customerOpen, setCustomerOpen] = useState(false);
  const [customerSaving, setCustomerSaving] = useState(false);
  const [customerError, setCustomerError] = useState<string | null>(null);
  type ItemLine = { id?: string; itemVariantId: string; title: string; quantity: number };
  const [itemsOpen, setItemsOpen] = useState(false);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemsSaving, setItemsSaving] = useState(false);
  const [itemsError, setItemsError] = useState<string | null>(null);
  const [itemLines, setItemLines] = useState<ItemLine[]>([]);
  const [variantSearch, setVariantSearch] = useState("");
  const itemVariants = useQuery({
    queryKey: ["review-item-variants", variantSearch],
    enabled: itemsOpen,
    queryFn: async () => {
      const { data, response } = await api.GET("/api/v1/item-variants", {
        params: { query: { search: variantSearch || undefined } },
      });
      if (!response.ok || !data) return [] as VariantOption[];
      return data as unknown as VariantOption[];
    },
  });
  const [customer, setCustomer] = useState<CustomerForm>({
    name: "",
    phone: "",
    email: "",
    addressLine1: "",
    addressLine2: "",
    city: "",
    postalCode: "",
    country: "",
  });

  const order = record.payload?.order;
  if (!order) return null;

  const customerName = order.customer?.name ?? "—";
  const priorCount = record.priorOrderCount ?? 0;
  const sourceLabel =
    [platform, storeName].filter(Boolean).join(" ") || t("orders.sourceManual");
  const overdue =
    Date.now() - new Date(record.createdAt).getTime() > OVERDUE_MS;
  const returned = Boolean(record.payload?.returnedFromPacking);
  const canApprove = Boolean(shippingRegionId && categoryId);

  const startCustomerEdit = () => {
    const source = order.customer ?? {};
    setCustomer({
      name: source.name ?? "",
      phone: source.phone ?? "",
      email: source.email ?? "",
      addressLine1: source.addressLine1 ?? "",
      addressLine2: source.addressLine2 ?? "",
      city: source.city ?? "",
      postalCode: source.postalCode ?? "",
      country: source.country ?? "",
    });
    setCustomerError(null);
    setCustomerOpen(true);
  };

  const saveCustomer = async () => {
    if (!record.subjectId) return;
    setCustomerSaving(true);
    setCustomerError(null);
    const { data, response } = await api.PATCH("/api/v1/orders/{id}/review-customer", {
      params: { path: { id: record.subjectId } },
      body: customer as never,
    });
    setCustomerSaving(false);
    if (!response.ok) {
      const detail = (data as unknown as { message?: string })?.message;
      setCustomerError(detail ?? t("review.customerSaveFailed", { status: response.status }));
      return;
    }
    setCustomerOpen(false);
    onChanged();
  };

  const startEditItems = async () => {
    if (!record.subjectId) return;
    setItemsOpen(true);
    setItemsLoading(true);
    setItemsError(null);
    const { data, response } = await api.GET("/api/v1/orders/{id}", {
      params: { path: { id: record.subjectId } },
    });
    setItemsLoading(false);
    if (!response.ok || !data) {
      setItemsError(t("review.itemsLoadFailed", { status: response.status }));
      return;
    }
    const lines = (data as {
      lines?: Array<{
        id: string;
        title: string | null;
        quantity: number;
        itemVariant?: { id: string } | null;
      }>;
    }).lines ?? [];
    setItemLines(
      lines.map((line) => ({
        id: line.id,
        itemVariantId: line.itemVariant?.id ?? "",
        title: line.title ?? "",
        quantity: line.quantity,
      })),
    );
  };

  const saveItems = async () => {
    if (!record.subjectId) return;
    const lines = itemLines.map((line) => ({
      ...(line.id ? { id: line.id } : {}),
      itemVariantId: line.itemVariantId || undefined,
      title: line.title.trim(),
      quantity: line.quantity,
    }));
    if (lines.length === 0 || lines.some((line) => !line.itemVariantId)) {
      setItemsError(t("review.itemsRequireVariant"));
      return;
    }
    setItemsSaving(true);
    setItemsError(null);
    const { data, response } = await api.PATCH("/api/v1/orders/{id}/review-items", {
      params: { path: { id: record.subjectId } },
      body: { lines } as never,
    });
    setItemsSaving(false);
    if (!response.ok) {
      const detail = (data as unknown as { message?: string })?.message;
      setItemsError(detail ?? t("review.itemsSaveFailed", { status: response.status }));
      return;
    }
    setItemsOpen(false);
    onChanged();
  };

  const cancelOrder = () => {
    if (!record.subjectId) return;
    const reason = cancelReason.trim();
    onCancel(record.subjectId, reason);
    setCancelOpen(false);
  };

  return (
    <div
      className={`pop-shadow-sm rounded-xl border bg-white p-4 text-sm transition-transform hover:-translate-y-0.5 ${
        overdue ? "border-red-400 ring-1 ring-red-200" : "border-ink/10"
      }`}
    >
      {/* Header: order number + status + source */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-display text-lg font-semibold text-ink">{order.displayNumber}</span>
        <OrderStatusBadges statusRaw={order.statusRaw ?? null} />
        {overdue ? (
          <span className="whitespace-nowrap rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-700">
            {t("review.overdue")}
          </span>
        ) : null}
        {returned ? (
          <span className="whitespace-nowrap rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700">
            {record.payload?.returnedFromStage === "ordering"
              ? t("review.returnedFromOrdering")
              : record.payload?.returnedFromStage === "packing"
                ? t("review.returnedFromPackingBadge")
                : t("review.returnedBadge")}
          </span>
        ) : null}
        <span className="ml-auto text-xs text-slate-400">
          {t("review.source")}: <span className="text-slate-600">{sourceLabel}</span>
        </span>
      </div>

      {returned ? (
        <p className="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-700">
          {record.payload?.returnedFromStage === "ordering"
            ? t("review.returnedFromOrdering")
            : t("review.returnedFromPackingBadge")}
          {record.payload?.returnedNote ? `：${record.payload.returnedNote}` : ""}
        </p>
      ) : null}

      {/* Customer + products + prior count */}
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              {t("orders.customer")}
            </p>
            {record.subjectId ? (
              <button
                type="button"
                onClick={startCustomerEdit}
                className="rounded-lg border border-ink/20 bg-white px-2 py-0.5 text-xs text-slate-600 transition-colors hover:bg-pill"
              >
                {t("review.editCustomer")}
              </button>
            ) : null}
          </div>
          <p className="mt-0.5 font-medium">{customerName}</p>
          {order.customer?.email ? (
            <p className="text-xs text-slate-500">{order.customer.email}</p>
          ) : null}
          {order.customer?.phone ? (
            <p className="text-xs text-slate-500">{order.customer.phone}</p>
          ) : null}
          {order.customer?.addressLine1 ? (
            <p className="text-xs text-slate-500">
              {[order.customer.addressLine1, order.customer.addressLine2]
                .filter(Boolean)
                .join(" ")}
              {order.customer.city ? `, ${order.customer.city}` : ""}
              {order.customer.postalCode ? ` ${order.customer.postalCode}` : ""}
              {order.customer.country ? `, ${order.customer.country}` : ""}
            </p>
          ) : null}
          <p className="mt-1 text-xs text-slate-500">
            {t("review.priorOrders", { count: priorCount })}
          </p>
          {order.deliveryMethod ? (
            <p className="mt-1 text-xs text-slate-500">
              {t("orders.deliveryMethod")}: {order.deliveryMethod}
            </p>
          ) : null}
        </div>
        <div>
          <div className="flex items-center gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              {t("orders.productCol")}
            </p>
            {record.subjectId ? (
              <button
                type="button"
                onClick={() => void startEditItems()}
                className="rounded-lg border border-ink/20 bg-white px-2 py-0.5 text-xs text-slate-600 transition-colors hover:bg-pill"
              >
                {t("review.editItems")}
              </button>
            ) : null}
          </div>
          <ul className="mt-0.5 space-y-0.5">
            {(order.lines ?? []).map((line, i) => (
              <li key={i} className="flex items-baseline gap-1.5">
                <span className="text-[13px]">{line.title}</span>
                <span className="font-mono text-xs text-slate-500">×{line.quantity}</span>
              </li>
            ))}
            {(order.lines ?? []).length === 0 ? (
              <li className="text-xs text-slate-400">—</li>
            ) : null}
          </ul>
        </div>
      </div>

      {/* Buyer note + time */}
      <div className="mt-2 flex flex-wrap items-baseline gap-4 text-xs text-slate-500">
        <span>
          {t("orders.created")}:{" "}
          {order.sourceUpdatedAt
            ? new Date(order.sourceUpdatedAt).toLocaleString()
            : new Date(record.createdAt).toLocaleString()}
        </span>
        {order.buyerNote ? (
          <span className="whitespace-pre-wrap">
            {t("orders.buyerNote")}: {order.buyerNote}
          </span>
        ) : null}
      </div>

      {/* Per-order assignment controls */}
      <div className="mt-3 flex flex-wrap items-end gap-3 rounded-lg bg-pill px-3 py-2.5">
        <div>
          <label className="block text-xs font-medium text-slate-500">
            {t("review.assignShippingRegion")} *
          </label>
          <select
            value={shippingRegionId}
            onChange={(e) => setShippingRegionId(e.target.value)}
            className="mt-0.5 rounded-lg border border-ink/20 bg-white px-2 py-1 text-sm"
          >
            <option value="">{t("review.assignShippingRegionNone")}</option>
            {shippingRegions.map((region) => (
              <option key={region.id} value={region.id}>
                {region.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500">
            {t("review.assignCategory")} *
          </label>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="mt-0.5 rounded-lg border border-ink/20 bg-white px-2 py-1 text-sm"
          >
            <option value="">{t("review.assignCategoryNone")}</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.name}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-40 flex-1">
          <label className="flex items-center gap-1 text-xs font-medium text-slate-500">
            {t("review.assignNote")}
            {noteSaved ? (
              <span className="text-emerald-600">✓ {t("review.noteSaved")}</span>
            ) : null}
          </label>
          <div className="mt-0.5 flex gap-1.5">
            <input
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
                setNoteSaved(false);
              }}
              placeholder={t("review.assignNotePlaceholder")}
              className="w-full rounded-lg border border-ink/20 bg-white px-2 py-1 text-sm"
            />
            <button
              type="button"
              disabled={busy || !note.trim()}
              onClick={async () => {
                await fetch(`/api/v1/review-queue/${record.id}/note`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ note: note.trim() }),
                  credentials: "include",
                });
                setNoteSaved(true);
              }}
              className="shrink-0 rounded-lg border border-ink/20 px-2 py-1 text-xs text-slate-600 hover:bg-pill disabled:opacity-40"
            >
              {t("review.saveNote")}
            </button>
          </div>
        </div>
        <div className="flex w-full flex-wrap items-center justify-end gap-2">
          {!canApprove ? (
            <span className="mr-auto text-xs text-amber-700">{t("review.requiredHint")}</span>
          ) : null}
          {canCancel && record.subjectId ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setCancelOpen(true);
                setCancelReason("");
              }}
              className={buttonClasses.danger}
            >
              {t("review.cancelOrder")}
            </button>
          ) : null}
          <button
            type="button"
            disabled={busy || !canApprove}
            onClick={() => {
              onApprove(record.id, {
                shippingRegionId,
                categoryId,
                ...(note.trim() ? { note: note.trim() } : {}),
              });
            }}
            className={buttonClasses.primary}
          >
            {t("review.approve")}
          </button>
        </div>
      </div>

      {cancelOpen ? (
        <Modal title={t("review.cancelOrder")} onClose={() => setCancelOpen(false)}>
          <div className="space-y-3 text-sm">
            <p className="text-slate-600">{t("review.cancelHint")}</p>
            <label className="block text-xs text-slate-500">
              {t("review.cancelReason")}
              <textarea
                value={cancelReason}
                onChange={(event) => setCancelReason(event.target.value)}
                rows={3}
                className="mt-1 w-full rounded-lg border border-ink/20 px-2 py-1.5"
              />
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setCancelOpen(false)} className={buttonClasses.secondary}>
                {t("common.cancel")}
              </button>
              <button type="button" onClick={cancelOrder} className={buttonClasses.danger}>
                {t("review.cancelConfirm")}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      {itemsOpen ? (
        <Modal title={t("review.editItems")} onClose={() => setItemsOpen(false)}>
          {itemsLoading ? (
            <p className="text-sm text-slate-400">{t("common.loading")}</p>
          ) : (
            <div className="space-y-3 text-sm">
              <input
                value={variantSearch}
                onChange={(event) => setVariantSearch(event.target.value)}
                placeholder={t("review.variantSearch")}
                className="w-full rounded-lg border border-ink/20 px-2 py-1.5"
              />
              <div className="space-y-2">
                {itemLines.map((line, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <select
                      value={line.itemVariantId}
                      onChange={(event) => {
                        const variant = itemVariants.data?.find(
                          (option) => option.id === event.target.value,
                        );
                        setItemLines((current) =>
                          current.map((item, i) =>
                            i === index
                              ? {
                                  ...item,
                                  itemVariantId: event.target.value,
                                  title: variant
                                    ? `${variant.item.name} / ${variant.name}`
                                    : item.title,
                                }
                              : item,
                          ),
                        )
                      }}
                      className="flex-1 rounded-lg border border-ink/20 px-2 py-1.5"
                    >
                      <option value="">{t("review.selectVariant")}</option>
                      {itemVariants.data?.map((variant) => (
                        <option key={variant.id} value={variant.id}>
                          {variant.item.name} / {variant.name} ({variant.itemCode})
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min="1"
                      value={line.quantity}
                      onChange={(event) =>
                        setItemLines((current) =>
                          current.map((item, i) =>
                            i === index
                              ? { ...item, quantity: Math.max(1, Number(event.target.value) || 1) }
                              : item,
                          ),
                        )
                      }
                      className="w-20 rounded-lg border border-ink/20 px-2 py-1.5"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setItemLines((current) => current.filter((_, i) => i !== index))
                      }
                      className="text-red-600 hover:text-red-800"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() =>
                  setItemLines((current) => [
                    ...current,
                    { itemVariantId: "", title: "", quantity: 1 },
                  ])
                }
                className="text-sm text-slate-600 hover:text-ink"
              >
                + {t("review.addItemLine")}
              </button>
              {itemsError ? (
                <p className="text-sm text-red-600" role="alert">{itemsError}</p>
              ) : null}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setItemsOpen(false)}
                  className={buttonClasses.secondary}
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="button"
                  disabled={itemsSaving}
                  onClick={() => void saveItems()}
                  className={buttonClasses.primary}
                >
                  {t("review.saveItems")}
                </button>
              </div>
            </div>
          )}
        </Modal>
      ) : null}

      {customerOpen ? (
        <Modal title={t("review.editCustomer")} onClose={() => setCustomerOpen(false)}>
          <div className="grid grid-cols-2 gap-2 text-sm">
            {(
              [
                ["name", t("orders.customerName")],
                ["phone", t("orders.phone")],
                ["email", t("orders.email")],
                ["addressLine1", t("orders.address")],
                ["addressLine2", t("orders.address")],
                ["city", t("orders.city")],
                ["postalCode", t("orders.postalCode")],
                ["country", t("orders.country")],
              ] as const
            ).map(([field, label]) => (
              <label key={field} className="text-xs text-slate-500">
                {label}
                <input
                  value={customer[field]}
                  onChange={(event) =>
                    setCustomer((current) => ({ ...current, [field]: event.target.value }))
                  }
                  className="mt-1 w-full rounded-lg border border-ink/20 px-2 py-1.5"
                />
              </label>
            ))}
            {customerError ? (
              <p className="col-span-2 text-sm text-red-600" role="alert">{customerError}</p>
            ) : null}
            <div className="col-span-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCustomerOpen(false)}
                className={buttonClasses.secondary}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                disabled={customerSaving}
                onClick={() => void saveCustomer()}
                className={buttonClasses.primary}
              >
                {t("review.saveCustomer")}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
