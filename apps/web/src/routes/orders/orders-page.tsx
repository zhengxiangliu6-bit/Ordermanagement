import { useState } from "react";
import { useNavigate, useRouteLoaderData } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Modal } from "../../components/modal";
import { PageHeader, EmptyState, buttonClasses } from "../../components/ui";
import { api } from "../../api-client/client";
import type { CustomerInput, OrderListResponse } from "../../types/order";
import type { rootLoader } from "../../layouts/root-loader";
import { OrdersTable } from "./orders-table";

export default function OrdersPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const root = useRouteLoaderData<typeof rootLoader>("root");
  const canCreateManual = (root?.user.permissions ?? []).some(p => p === "*" || p === "orders:create-manual");
  const [search, setSearch] = useState("");
  const [source, setSource] = useState<"" | "manual" | "external">("");
  const [shippingRegionId, setShippingRegionId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [status, setStatus] = useState<"" | "unfulfilled" | "fulfilled" | "cancelled">("");
  const [archived, setArchived] = useState(false);
  const [activePage, setActivePage] = useState(1);
  const [finishedPage, setFinishedPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resetPages = () => {
    setActivePage(1);
    setFinishedPage(1);
  };

  const fetchOrders = async (stageGroup: "active" | "finished", page: number) => {
    const { data, response } = await api.GET("/api/v1/orders", {
      params: {
        query: {
          search: search || undefined,
          source: (source || undefined) as "manual" | "external" | undefined,
          archived: archived || undefined,
          shippingRegionId: shippingRegionId || undefined,
          categoryId: categoryId || undefined,
          status: (status || undefined) as
            | "unfulfilled"
            | "fulfilled"
            | "cancelled"
            | undefined,
          stageGroup,
          page,
          pageSize: 10,
        },
      },
    });
    if (!response.ok || !data) throw new Error(`List failed (${response.status})`);
    return data as OrderListResponse;
  };

  const active = useQuery({
    queryKey: ["orders", "active", { search, source, archived, shippingRegionId, categoryId, status, activePage }],
    queryFn: () => fetchOrders("active", activePage),
  });
  const finished = useQuery({
    queryKey: ["orders", "finished", { search, source, archived, shippingRegionId, categoryId, status, finishedPage }],
    queryFn: () => fetchOrders("finished", finishedPage),
  });

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

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("orders.title")}
        actions={
          canCreateManual ? (
            <button
              type="button"
              onClick={() => {
                setCreating((value) => !value);
                setError(null);
              }}
              className={creating ? buttonClasses.secondary : buttonClasses.primary}
            >
              {creating ? t("common.cancel") : t("orders.createManualOrder")}
            </button>
          ) : undefined
        }
      />

      {creating ? (
        <Modal title={t("orders.createManualOrder")} onClose={() => setCreating(false)}>
          {error ? (
            <p className="mb-3 text-sm text-red-600" role="alert">{error}</p>
          ) : null}
          <CreateOrderForm
            initialRegionId={shippingRegionId}
            onDone={(createdId) => {
              setCreating(false);
              queryClient.invalidateQueries({ queryKey: ["orders"] });
              if (createdId) navigate(`/orders/${createdId}`);
            }}
            onError={setError}
          />
        </Modal>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <div className="flex flex-wrap overflow-hidden rounded-xl border border-ink/15">
          {[
            { id: "", name: t("orders.regionAll") },
            ...(shippingRegions.data ?? []),
          ].map((region) => (
            <button
              key={region.id || "all"}
              type="button"
              onClick={() => {
                setShippingRegionId(region.id);
                resetPages();
              }}
              className={`px-3.5 py-1.5 transition-colors ${
                shippingRegionId === region.id
                  ? "bg-ink font-semibold text-white"
                  : "bg-white text-slate-600 hover:bg-pill hover:text-ink"
              }`}
            >
              {region.name}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              setCategoryId("");
              resetPages();
            }}
            className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
              categoryId === "" ? "bg-brand text-white" : "bg-pill text-slate-600 hover:text-ink"
            }`}
          >
            {t("orders.categoryAll")}
          </button>
          {(categories.data ?? [])
            .filter((category) => category.name !== "__disabled__")
            .map((category) => (
              <button
                key={category.id}
                type="button"
                onClick={() => {
                  setCategoryId(categoryId === category.id ? "" : category.id);
                  resetPages();
                }}
                className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                  categoryId === category.id
                    ? "bg-brand text-white"
                    : "bg-pill text-slate-600 hover:text-ink"
                }`}
              >
                {category.name}
              </button>
            ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <input
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            resetPages();
          }}
          placeholder={t("orders.searchPlaceholder")}
          className="w-64 rounded-lg border border-ink/20 bg-white px-2.5 py-1.5"
        />
        <select
          value={source}
          onChange={(event) => {
            setSource(event.target.value as "" | "manual" | "external");
            resetPages();
          }}
          className="rounded-lg border border-ink/20 bg-white px-2 py-1.5"
        >
          <option value="">{t("orders.allSources")}</option>
          <option value="manual">{t("orders.sourceManual")}</option>
          <option value="external">{t("orders.sourceExternal")}</option>
        </select>
        <select
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as "" | "unfulfilled" | "fulfilled" | "cancelled");
            resetPages();
          }}
          className="rounded-lg border border-ink/20 bg-white px-2 py-1.5"
          aria-label={t("orders.statusFilter")}
        >
          <option value="">{t("orders.allStatuses")}</option>
          <option value="unfulfilled">{t("orders.statusUnfulfilled")}</option>
          <option value="fulfilled">{t("orders.statusFulfilled")}</option>
          <option value="cancelled">{t("orders.statusCancelled")}</option>
        </select>
        <label className="flex items-center gap-1.5 text-slate-600">
          <input
            type="checkbox"
            checked={archived}
            onChange={(event) => {
              setArchived(event.target.checked);
              resetPages();
            }}
          />
          {t("orders.showArchived")}
        </label>
      </div>

      <section className="space-y-2">
        <div className="flex items-baseline justify-between">
          <h2 className="text-base font-semibold text-ink">{t("orders.activeTable")}</h2>
          <span className="text-xs text-slate-400">
            {t("common.page", {
              page: active.data?.page ?? 1,
              pageCount: active.data?.pageCount ?? 1,
              total: active.data?.total ?? 0,
            })}
          </span>
        </div>
        {active.isLoading ? (
          <p className="text-sm text-slate-400">{t("common.loading")}</p>
        ) : active.isError ? (
          <p className="text-sm text-red-600">{(active.error as Error).message}</p>
        ) : active.data && active.data.orders.length > 0 ? (
          <OrdersTable
            orders={active.data.orders}
            page={active.data.page}
            pageCount={active.data.pageCount}
            total={active.data.total}
            onPage={setActivePage}
            onOpen={(id) => navigate(`/orders/${id}`)}
          />
        ) : (
          <EmptyState message={t("orders.noActiveOrders")} />
        )}
      </section>

      <section className="space-y-2">
        <div className="flex items-baseline justify-between">
          <h2 className="text-base font-semibold text-ink">{t("orders.finishedTable")}</h2>
          <span className="text-xs text-slate-400">
            {t("common.page", {
              page: finished.data?.page ?? 1,
              pageCount: finished.data?.pageCount ?? 1,
              total: finished.data?.total ?? 0,
            })}
          </span>
        </div>
        {finished.isLoading ? (
          <p className="text-sm text-slate-400">{t("common.loading")}</p>
        ) : finished.isError ? (
          <p className="text-sm text-red-600">{(finished.error as Error).message}</p>
        ) : finished.data && finished.data.orders.length > 0 ? (
          <OrdersTable
            orders={finished.data.orders}
            page={finished.data.page}
            pageCount={finished.data.pageCount}
            total={finished.data.total}
            onPage={setFinishedPage}
            onOpen={(id) => navigate(`/orders/${id}`)}
          />
        ) : (
          <EmptyState message={t("orders.noFinishedOrders")} />
        )}
      </section>
    </div>
  );
}

interface VariantOption {
  id: string;
  itemCode: string;
  name: string;
  item: { id: string; name: string; categoryId?: string | null };
  stocks?: Array<{ warehouse: string; quantity: number; archivedAt?: string | null }>;
}

export function CreateOrderForm({
  initialRegionId = "",
  onDone,
  onError,
}: {
  initialRegionId?: string;
  onDone: (createdId: string | null) => void;
  onError: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const [variantQuery, setVariantQuery] = useState("");
  const [regionId, setRegionId] = useState(initialRegionId);
  const regions = useQuery({ queryKey: ["shipping-regions"], queryFn: async () => {
    const { data, response } = await api.GET("/api/v1/shipping-regions");
    if (!response.ok) throw new Error(t("common.loadFailed"));
    return data as unknown as Array<{ id: string; name: string; enabled: boolean; warehouse: "china" | "canada" | null }>;
  } });
  const warehouse = regions.data?.find(region => region.id === regionId)?.warehouse ?? undefined;

  const variantOptions = useQuery({
    queryKey: ["item-variants", warehouse, variantQuery],
    enabled: Boolean(warehouse),
    queryFn: async () => {
      const { data, response } = await api.GET("/api/v1/item-variants", {
        params: { query: { search: variantQuery || undefined, warehouse } },
      });
      if (!response.ok || !data) return [] as VariantOption[];
      return data as unknown as VariantOption[];
    },
  });
  const [lines, setLines] = useState<Array<{ title: string; quantity: number; itemVariantId: string; autoTitle?: string }>>([
    { title: "", quantity: 1, itemVariantId: "" },
  ]);
  const [busy, setBusy] = useState(false);

  const submit = async (form: HTMLFormElement) => {
    if (!warehouse || !regionId) { onError(t("shippingRegions.warehouseRequired")); return; }
    const formData = new FormData(form);
    const customer: CustomerInput = {
      name: String(formData.get("customerName") ?? "").trim() || undefined,
      phone: String(formData.get("customerPhone") ?? "").trim() || undefined,
      email: String(formData.get("customerEmail") ?? "").trim() || undefined,
      addressLine1: String(formData.get("addressLine1") ?? "").trim() || undefined,
      city: String(formData.get("city") ?? "").trim() || undefined,
      postalCode: String(formData.get("postalCode") ?? "").trim() || undefined,
      country: String(formData.get("country") ?? "").trim() || undefined,
    };
    setBusy(true);
    onError("");
    const { data, response, error } = await api.POST("/api/v1/orders", {
      body: {
        shippingRegionId: regionId,
        lines: lines
          .filter((line) => line.title.trim())
          .map((line) => ({
            title: line.title.trim(),
            quantity: line.quantity,
            itemVariantId: line.itemVariantId.trim() || undefined,
          })),
        customer,
        buyerNote: String(formData.get("buyerNote") ?? "").trim() || undefined,
        deliveryMethod: String(formData.get("deliveryMethod") ?? "").trim() || undefined,
      },
    });
    setBusy(false);
    if (!response.ok || !data) {
      onError((error as { message?: string } | undefined)?.message ?? `Creating the order failed (${response.status}).`);
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ["orders"] });
    onDone((data as { id: string }).id);
  };

  const pickVariant = (index: number, variantId: string) => {
    const chosen = (variantOptions.data ?? []).find((option) => option.id === variantId);
    setLines(
      lines.map((line, i) => {
        if (i !== index) return line;
        // Selecting an internal item fills the product name when the line
        // has no hand-typed name yet (or was auto-filled from a variant).
        const autoName = chosen ? `${chosen.item.name}${chosen.name && chosen.name !== "Default" ? ` · ${chosen.name}` : ""}` : "";
        const title = !line.title.trim() || line.title === line.autoTitle ? autoName || line.title : line.title;
        return { ...line, itemVariantId: variantId, title, autoTitle: autoName };
      }),
    );
  };

  return (
    <form
      className="mt-4 rounded border border-slate-200 bg-white p-4 text-sm"
      onSubmit={(event) => {
        event.preventDefault();
        void submit(event.currentTarget);
      }}
    >
      <label htmlFor="manual-region" className="font-medium">{t("orders.shippingRegionLabel")}</label>
      <select id="manual-region" required value={regionId} onChange={e => {
        setRegionId(e.target.value);
        setLines(current => current.map(line => line.itemVariantId ? { ...line, title: "", itemVariantId: "", autoTitle: "" } : line));
      }} className="mb-4 ml-3 rounded-lg border border-ink/20 bg-white px-2 py-1.5">
        <option value="">—</option>
        {(regions.data ?? []).filter(region => region.enabled && region.warehouse).map(region => <option key={region.id} value={region.id}>{region.name}</option>)}
      </select>
      {regions.isError ? <p role="alert">{t("common.loadFailed")}</p> : null}
      <div className="font-medium">{t("orders.orderLines")}</div>
      <div className="mt-1 text-xs text-slate-400">{t("orders.linesHint")}</div>
      {lines.map((line, index) => (
        <div key={index} className="mt-2 flex flex-wrap items-center gap-2">
          <input
            value={line.title}
            onChange={(event) =>
              setLines(lines.map((l, i) => (i === index ? { ...l, title: event.target.value } : l)))
            }
            placeholder={t("orders.lineTitle")}
            className="w-64 rounded-lg border border-ink/20 px-2 py-1"
            aria-label={t("orders.lineTitle")}
          />
          <input
            type="number"
            min={1}
            value={line.quantity}
            title={t("orders.lineQty")}
            aria-label={t("orders.lineQty")}
            onChange={(event) =>
              setLines(lines.map((l, i) => (i === index ? { ...l, quantity: Number(event.target.value) } : l)))
            }
            className="w-16 rounded-lg border border-ink/20 px-2 py-1"
          />
          <select
            value={line.itemVariantId ?? ""}
            title={t("orders.lineItem")}
            aria-label={t("orders.lineItem")}
            onChange={(event) => pickVariant(index, event.target.value)}
            className="w-64 rounded-lg border border-ink/20 bg-white px-2 py-1"
          >
            <option value="">{t("orders.noItemLink")}</option>
            {Object.entries(
              (variantOptions.data ?? []).reduce<Record<string, VariantOption[]>>((groups, option) => {
                (groups[option.item.name] ??= []).push(option);
                return groups;
              }, {}),
            ).map(([itemName, groupVariants]) => (
              <optgroup key={itemName} label={itemName}>
                {groupVariants.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name} ({option.itemCode}) · {t("orders.warehouseStock", { count: option.stocks?.find(stock => stock.warehouse === warehouse)?.quantity ?? 0 })}{(option.stocks?.find(stock => stock.warehouse === warehouse)?.quantity ?? 0) < line.quantity ? ` · ${t("orders.outOfStock")}` : ""}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {lines.length > 1 ? (
            <button type="button" onClick={() => setLines(lines.filter((_, i) => i !== index))} className="text-slate-400 hover:text-red-600" aria-label="Remove line">
              ✕
            </button>
          ) : null}
        </div>
      ))}
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setLines([...lines, { title: "", quantity: 1, itemVariantId: "" }])} className="text-sm text-slate-500 hover:text-slate-800">
          {t("orders.addLine")}
        </button>
        <input
          value={variantQuery}
          onChange={(event) => setVariantQuery(event.target.value)}
          placeholder={t("orders.filterByCodeName")}
          className="ml-auto w-56 rounded-lg border border-ink/20 px-2 py-1 text-xs"
        />
      </div>

      <div className="mt-4 grid grid-cols-[9rem_1fr] gap-x-3 gap-y-2">
        <label htmlFor="customer-name" className="self-center font-medium">{t("orders.customerName")}</label>
        <input id="customer-name" name="customerName" className="rounded-lg border border-ink/20 bg-white px-2 py-1.5" />
        <label htmlFor="customer-phone" className="self-center font-medium">{t("orders.phone")}</label>
        <input id="customer-phone" name="customerPhone" className="rounded-lg border border-ink/20 bg-white px-2 py-1.5" />
        <label htmlFor="customer-email" className="self-center font-medium">{t("orders.email")}</label>
        <input id="customer-email" name="customerEmail" type="email" className="rounded-lg border border-ink/20 bg-white px-2 py-1.5" />
        <label htmlFor="address-line1" className="self-center font-medium">{t("orders.address")}</label>
        <input id="address-line1" name="addressLine1" className="rounded-lg border border-ink/20 bg-white px-2 py-1.5" />
        <label htmlFor="city" className="self-center font-medium">{t("orders.city")}</label>
        <input id="city" name="city" className="rounded-lg border border-ink/20 bg-white px-2 py-1.5" />
        <label htmlFor="postal-code" className="self-center font-medium">{t("orders.postalCode")}</label>
        <input id="postal-code" name="postalCode" className="rounded-lg border border-ink/20 bg-white px-2 py-1.5" />
        <label htmlFor="country" className="self-center font-medium">{t("orders.country")}</label>
        <input id="country" name="country" className="rounded-lg border border-ink/20 bg-white px-2 py-1.5" />
        <label htmlFor="delivery-method" className="self-center font-medium">{t("orders.deliveryMethod")}</label>
        <input id="delivery-method" name="deliveryMethod" className="rounded-lg border border-ink/20 bg-white px-2 py-1.5" />
        <label htmlFor="buyer-note" className="self-center font-medium">{t("orders.buyerNote")}</label>
        <textarea id="buyer-note" name="buyerNote" rows={2} className="rounded-lg border border-ink/20 bg-white px-2 py-1.5" />
      </div>
      <button type="submit" disabled={busy} className={`mt-3 ${buttonClasses.primary}`}>
        {busy ? t("orders.creating") : t("orders.createOrder")}
      </button>
    </form>
  );
}
