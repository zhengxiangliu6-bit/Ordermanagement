import { useState } from "react";
import { useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Modal } from "../../components/modal";
import { api } from "../../api-client/client";
import type { CustomerInput, OrderListResponse } from "../../types/order";

export default function OrdersPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [source, setSource] = useState<"" | "manual" | "external">("");
  const [archived, setArchived] = useState(false);
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading, isError, error: listError } = useQuery({
    queryKey: ["orders", { search, source, archived, page }],
    queryFn: async () => {
      const { data, response } = await api.GET("/api/v1/orders", {
        params: {
          query: {
            search: search || undefined,
            source: (source || undefined) as "manual" | "external" | undefined,
            archived: archived || undefined,
            page,
            pageSize: 20,
          },
        },
      });
      if (!response.ok || !data) throw new Error(`List failed (${response.status})`);
      return data as OrderListResponse;
    },
  });

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t("orders.title")}</h1>
        <button
          type="button"
          onClick={() => {
            setCreating((value) => !value);
            setError(null);
          }}
          className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
        >
          {creating ? t("common.cancel") : t("orders.createManualOrder")}
        </button>
      </div>

      {creating ? (
        <Modal title={t("orders.createManualOrder")} onClose={() => setCreating(false)}>
          {error ? (
            <p className="mb-3 text-sm text-red-600" role="alert">{error}</p>
          ) : null}

              {error ? (
                <p className="mb-3 text-sm text-red-600" role="alert">{error}</p>
              ) : null}
              <CreateOrderForm
                onDone={(createdId) => {
                  setCreating(false);
                  queryClient.invalidateQueries({ queryKey: ["orders"] });
                  if (createdId) navigate(`/orders/${createdId}`);
                }}
                onError={setError}
              />
                    </Modal>
      ) : null}

      <div className="mt-4 flex items-center gap-4 text-sm">
        <input
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
          placeholder={t("orders.searchPlaceholder")}
          className="w-64 rounded border border-slate-300 px-2 py-1"
        />
        <select
          value={source}
          onChange={(event) => {
            setSource(event.target.value as "" | "manual" | "external");
            setPage(1);
          }}
          className="rounded border border-slate-300 px-2 py-1"
        >
          <option value="">{t("orders.allSources")}</option>
          <option value="manual">{t("orders.sourceManual")}</option>
          <option value="external">{t("orders.sourceExternal")}</option>
        </select>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={archived}
            onChange={(event) => {
              setArchived(event.target.checked);
              setPage(1);
            }}
          />
          {t("orders.showArchived")}
        </label>
      </div>

      <table className="mt-3 w-full border-collapse bg-white text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-slate-500">
            <th className="px-3 py-2 font-medium">{t("orders.number")}</th>
            <th className="px-3 py-2 font-medium">{t("orders.source")}</th>
            <th className="px-3 py-2 font-medium">{t("orders.customer")}</th>
            <th className="px-3 py-2 font-medium">{t("orders.lines")}</th>
            <th className="px-3 py-2 font-medium">{t("orders.created")}</th>
            <th className="px-3 py-2 font-medium">{t("orders.status")}</th>
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            <tr><td colSpan={6} className="px-3 py-6 text-slate-400">{t("common.loading")}</td></tr>
          ) : isError ? (
            <tr><td colSpan={6} className="px-3 py-6 text-red-600">{(listError as Error).message}</td></tr>
          ) : data && data.orders.length > 0 ? (
            data.orders.map((order) => (
              <tr
                key={order.id}
                onClick={() => navigate(`/orders/${order.id}`)}
                className="cursor-pointer border-b border-slate-100 hover:bg-slate-50"
              >
                <td className="px-3 py-2 font-mono text-xs">{order.displayNumber}</td>
                <td className="px-3 py-2 capitalize">{order.source}</td>
                <td className="px-3 py-2">
                  {String(order.customerSnapshot?.name ?? "—")}
                </td>
                <td className="px-3 py-2">{order._count?.lines ?? 0}</td>
                <td className="px-3 py-2 text-slate-500">
                  {new Date(order.createdAt).toLocaleString()}
                </td>
                <td className="px-3 py-2">
                  {order.archivedAt ? (
                    <span className="text-amber-700">{t("common.archived")}</span>
                  ) : (
                    <span className="text-emerald-700">{t("common.active")}</span>
                  )}
                </td>
              </tr>
            ))
          ) : (
            <tr><td colSpan={6} className="px-3 py-6 text-slate-400">{t("orders.noOrdersFound")}</td></tr>
          )}
        </tbody>
      </table>

      {data && data.pageCount > 1 ? (
        <div className="mt-3 flex items-center gap-3 text-sm">
          <button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)} className="rounded border border-slate-300 px-2 py-1 disabled:opacity-40">
            {t("common.previous")}
          </button>
          <span>{t("common.page", { page: data.page, pageCount: data.pageCount, total: data.total })}</span>
          <button type="button" disabled={page >= data.pageCount} onClick={() => setPage((value) => value + 1)} className="rounded border border-slate-300 px-2 py-1 disabled:opacity-40">
            {t("common.next")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

interface VariantOption {
  id: string;
  itemCode: string;
  name: string;
  item: { id: string; name: string };
}

function CreateOrderForm({
  onDone,
  onError,
}: {
  onDone: (createdId: string | null) => void;
  onError: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const [variantQuery, setVariantQuery] = useState("");

  const variantOptions = useQuery({
    queryKey: ["item-variants", variantQuery],
    queryFn: async () => {
      const { data, response } = await api.GET("/api/v1/item-variants", {
        params: { query: { search: variantQuery || undefined } },
      });
      if (!response.ok || !data) return [] as VariantOption[];
      return data as unknown as VariantOption[];
    },
  });
  const [lines, setLines] = useState<Array<{ title: string; quantity: number; itemVariantId: string }>>([
    { title: "", quantity: 1, itemVariantId: "" },
  ]);
  const [busy, setBusy] = useState(false);

  const submit = async (form: HTMLFormElement) => {
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
    const { data, response } = await api.POST("/api/v1/orders", {
      body: {
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
      onError(`Creating the order failed (${response.status}).`);
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ["orders"] });
    onDone((data as { id: string }).id);
  };

  return (
    <form
      className="mt-4 rounded border border-slate-200 bg-white p-4 text-sm"
      onSubmit={(event) => {
        event.preventDefault();
        void submit(event.currentTarget);
      }}
    >
      <div className="font-medium">{t("orders.orderLines")}</div>
      {lines.map((line, index) => (
        <div key={index} className="mt-2 flex items-center gap-2">
          <input
            value={line.title}
            onChange={(event) =>
              setLines(lines.map((l, i) => (i === index ? { ...l, title: event.target.value } : l)))
            }
            placeholder={t("orders.lineTitle")}
            className="w-72 rounded border border-slate-300 px-2 py-1"
          />
          <input
            type="number"
            min={1}
            value={line.quantity}
            onChange={(event) =>
              setLines(lines.map((l, i) => (i === index ? { ...l, quantity: Number(event.target.value) } : l)))
            }
            className="w-20 rounded border border-slate-300 px-2 py-1"
          />
          <select
            value={line.itemVariantId ?? ""}
            onChange={(event) =>
              setLines(lines.map((l, i) => (i === index ? { ...l, itemVariantId: event.target.value } : l)))
            }
            className="w-64 rounded border border-slate-300 px-2 py-1"
          >
            <option value="">{t("orders.noItemLink")}</option>
            {(variantOptions.data ?? []).map((option) => (
              <option key={option.id} value={option.id}>
                {option.itemCode} · {option.name}
              </option>
            ))}
          </select>
          {lines.length > 1 ? (
            <button type="button" onClick={() => setLines(lines.filter((_, i) => i !== index))} className="text-slate-400 hover:text-red-600" aria-label="Remove line">
              ✕
            </button>
          ) : null}
        </div>
      ))}
      <button type="button" onClick={() => setLines([...lines, { title: "", quantity: 1, itemVariantId: "" }])} className="mt-1 text-sm text-slate-500 hover:text-slate-800">
        {t("orders.addLine")}
      </button>
      <div className="mt-1 text-xs text-slate-400">
        Variant list {variantQuery ? `matching "${variantQuery}"` : "(first 20)"} —{" "}
        <input
          value={variantQuery}
          onChange={(event) => setVariantQuery(event.target.value)}
          placeholder={t("orders.filterByCodeName")}
          className="rounded border border-slate-300 px-1.5 py-0.5"
        />
      </div>

      <div className="mt-4 grid grid-cols-[9rem_1fr] gap-x-3 gap-y-2">
        <label htmlFor="customer-name" className="self-center font-medium">{t("orders.customerName")}</label>
        <input id="customer-name" name="customerName" className="rounded border border-slate-300 px-2 py-1" />
        <label htmlFor="customer-phone" className="self-center font-medium">{t("orders.phone")}</label>
        <input id="customer-phone" name="customerPhone" className="rounded border border-slate-300 px-2 py-1" />
        <label htmlFor="customer-email" className="self-center font-medium">{t("orders.email")}</label>
        <input id="customer-email" name="customerEmail" type="email" className="rounded border border-slate-300 px-2 py-1" />
        <label htmlFor="address-line1" className="self-center font-medium">{t("orders.address")}</label>
        <input id="address-line1" name="addressLine1" className="rounded border border-slate-300 px-2 py-1" />
        <label htmlFor="city" className="self-center font-medium">{t("orders.city")}</label>
        <input id="city" name="city" className="rounded border border-slate-300 px-2 py-1" />
        <label htmlFor="postal-code" className="self-center font-medium">{t("orders.postalCode")}</label>
        <input id="postal-code" name="postalCode" className="rounded border border-slate-300 px-2 py-1" />
        <label htmlFor="country" className="self-center font-medium">{t("orders.country")}</label>
        <input id="country" name="country" className="rounded border border-slate-300 px-2 py-1" />
        <label htmlFor="delivery-method" className="self-center font-medium">{t("orders.deliveryMethod")}</label>
        <input id="delivery-method" name="deliveryMethod" className="rounded border border-slate-300 px-2 py-1" />
        <label htmlFor="buyer-note" className="self-center font-medium">{t("orders.buyerNote")}</label>
        <textarea id="buyer-note" name="buyerNote" rows={2} className="rounded border border-slate-300 px-2 py-1" />
      </div>
      <button type="submit" disabled={busy} className="mt-3 rounded bg-slate-900 px-3 py-1.5 text-white hover:bg-slate-800 disabled:opacity-40">
        {busy ? t("orders.creating") : t("orders.createOrder")}
      </button>
    </form>
  );
}
