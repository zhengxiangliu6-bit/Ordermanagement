import { useState } from "react";
import { Link, useParams, useNavigate, useRouteLoaderData, useSearchParams } from "react-router";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { PageHeader, Card, Badge, buttonClasses } from "../../components/ui";
import { Modal } from "../../components/modal";
import {
  MovementFilterBar,
  MOVEMENT_LABELS,

  WAREHOUSE_LABELS,
} from "./movement-filter-bar";
import { warehouseDisplayName } from "./naming";
import { AccessDeniedPage } from "../access-denied";
import { api } from "../../api-client/client";
import type { rootLoader } from "../../layouts/root-loader";

interface StockRow {
  warehouse: string;
  quantity: number;
  lowThreshold: number | null;
}

interface InventoryVariantView {
  id: string;
  name: string;
  nameEn: string;
  archivedAt: string | null;
  stocks: StockRow[];
  total: number;
  low: boolean;
}

interface InventoryItemView {
  id: string;
  name: string;
  nameEn: string;
  archivedAt: string | null;
  variants: InventoryVariantView[];
}

interface MovementView {
  id: string;
  inventoryItemVariantId: string;
  warehouse: string;
  type: string;
  quantity: number;
  resultQuantity: number;
  actorId: string;
  actorName: string | null;
  note: string | null;
  createdAt: string;
  variantName: string | null;
  orderId: string | null;
  orderDisplayNumber: string | null;
}

interface MovementsPage {
  rows: MovementView[];
  total: number;
  page: number;
  pageSize: number;
}

type StockAction = "in" | "out";

export default function InventoryItemDetailPage() {
  const { t } = useTranslation();
  const { id = "" } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const root = useRouteLoaderData<typeof rootLoader>("root");
  const perms = new Set(root?.user.permissions ?? []);
  // The item page lives inside ONE warehouse context (no switching): the
  // two warehouses are independent and share only the catalog.
  const warehouse =
    searchParams.get("warehouse") === "canada" ? "canada" : "china";
  const canManage = perms.has("inventory:manage");
  const canReadWarehouse =
    perms.has("inventory:read") || perms.has(`inventory:${warehouse}:read`);
  const canManageWarehouse =
    canManage || perms.has(`inventory:${warehouse}:manage`);
  const [stockAction, setStockAction] = useState<{
    variantId: string;
    variantName: string;
    warehouse: string;
    action: StockAction;
  } | null>(null);
  const [quantity, setQuantity] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [movementPage, setMovementPage] = useState(1);
  const [movementPageSize, setMovementPageSize] = useState(10);
  const [movementType, setMovementType] = useState("");
  const [movementOrder, setMovementOrder] = useState<"asc" | "desc">("desc");
  const [movementVariantId, setMovementVariantId] = useState("");

  const item = useQuery({
    queryKey: ["inventory-item", id],
    queryFn: async () => {
      const { data, response } = await api.GET("/api/v1/inventory/items");
      if (!response.ok || !data) throw new Error(`Load failed (${response.status})`);
      const items = data as unknown as InventoryItemView[];
      const found = items.find((row) => row.id === id);
      if (!found) throw new Error(t("inventory.itemNotFound"));
      return found;
    },
  });

  const movements = useQuery({
    queryKey: [
      "inventory-movements",
      id,
      movementPage,
      movementPageSize,
      movementType,
      movementOrder,
      movementVariantId,
      warehouse,
    ],
    queryFn: async () => {
      const { data, response } = await api.GET("/api/v1/inventory/items/{id}/movements", {
        params: {
          path: { id },
          query: {
            page: movementPage,
            pageSize: movementPageSize,
            warehouse,
            ...(movementType ? { type: movementType } : {}),
            order: movementOrder,
            ...(movementVariantId ? { variantId: movementVariantId } : {}),
          },
        } as never,
      });
      if (!response.ok || !data) throw new Error(`Load failed (${response.status})`);
      return data as unknown as MovementsPage;
    },
    placeholderData: keepPreviousData,
  });

  const refresh = () => {
    setError(null);
    queryClient.invalidateQueries({ queryKey: ["inventory-item", id] });
    queryClient.invalidateQueries({ queryKey: ["inventory-movements", id] });
    queryClient.invalidateQueries({ queryKey: ["inventory-items"] });
  };

  const applyStock = async () => {
    if (!stockAction || !quantity) return;
    setBusy(true);
    setError(null);
    const delta = stockAction.action === "in" ? Number(quantity) : -Number(quantity);
    const { response, error } = await api.POST(
      "/api/v1/inventory/variants/{variantId}/adjust",
      {
        params: { path: { variantId: stockAction.variantId } },
        body: { warehouse: stockAction.warehouse, delta, note } as never,
      },
    );
    setBusy(false);
    if (!response.ok) {
      const body = (error ?? null) as { message?: string } | null;
      setError(body?.message ?? t("inventory.adjustFailed"));
      return;
    }
    setStockAction(null);
    setQuantity("");
    setNote("");
    refresh();
  };

  if (!canReadWarehouse) {
    return (
      <AccessDeniedPage
        requiredPermission={`inventory:${warehouse}:read / inventory:read`}
      />
    );
  }
  if (item.isLoading) {
    return <p className="text-sm text-slate-400">{t("common.loading")}</p>;
  }
  if (item.isError) {
    return <p className="text-sm text-red-600">{(item.error as Error).message}</p>;
  }
  const detail = item.data;
  if (!detail) return null;
  const stockOf = (variant: InventoryVariantView) =>
    variant.stocks.find((row) => row.warehouse === warehouse)?.quantity ?? 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title={`${warehouseDisplayName(detail, warehouse)} · ${t(`inventory.warehouse.${warehouse}`)}`}
        actions={
          <button
            type="button"
            onClick={() => navigate(`/inventory/${warehouse}`)}
            className={buttonClasses.secondary}
          >
            {t("common.back")}
          </button>
        }
      />
      {error ? <p className="text-sm text-red-600" role="alert">{error}</p> : null}

      {detail.variants
        .filter((variant) => !variant.archivedAt)
        .map((variant) => (
        <Card key={variant.id}>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to={`/inventory/variant/${variant.id}?warehouse=${warehouse}`}
              className="font-semibold text-ink underline-offset-2 hover:underline"
            >
              {warehouseDisplayName(variant, warehouse)}
            </Link>
            <Badge tone="neutral">
              {t(`inventory.warehouse.${warehouse}`)}: {stockOf(variant)}
            </Badge>
            {variant.low ? <Badge tone="danger">{t("inventory.low")}</Badge> : null}
          </div>
          {canManageWarehouse ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  setStockAction({
                    variantId: variant.id,
                    variantName: warehouseDisplayName(variant, warehouse),
                    warehouse,
                    action: "in",
                  })
                }
                className="rounded-lg border border-ink/20 px-2 py-0.5 text-xs text-slate-600 hover:bg-pill"
              >
                {t("inventory.inbound")}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  setStockAction({
                    variantId: variant.id,
                    variantName: warehouseDisplayName(variant, warehouse),
                    warehouse,
                    action: "out",
                  })
                }
                className="rounded-lg border border-ink/20 px-2 py-0.5 text-xs text-red-700 hover:bg-red-50"
              >
                {t("inventory.outbound")}
              </button>
            </div>
          ) : null}
        </Card>
      ))}

      <Card title={t("inventory.movementsTitle")}>
        {movements.isLoading ? (
          <p className="text-sm text-slate-400">{t("common.loading")}</p>
        ) : movements.data ? (
          <>
          <MovementFilterBar
            type={movementType}
            onType={(value) => {
              setMovementType(value);
              setMovementPage(1);
            }}
            order={movementOrder}
            onOrder={setMovementOrder}
            pageSize={movementPageSize}
            onPageSize={(value) => {
              setMovementPageSize(value);
              setMovementPage(1);
            }}
            variants={detail.variants.map((variant) => ({
              id: variant.id,
              nameZh: variant.name,
            }))}
            variantId={movementVariantId}
            onVariantId={(value) => {
              setMovementVariantId(value);
              setMovementPage(1);
            }}
          />
          {movements.data.rows.length === 0 ? (
            <p className="mt-2 text-sm text-slate-400">{t("inventory.noMovements")}</p>
          ) : (
          <>
          <table className="mt-2 w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-ink/10 text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="px-3 py-2 font-semibold">{t("inventory.movementTime")}</th>
                <th className="px-3 py-2 font-semibold">{t("inventory.movementVariant")}</th>
                <th className="px-3 py-2 font-semibold">{t("inventory.movementType")}</th>
                <th className="px-3 py-2 font-semibold">{t("inventory.movementQty")}</th>
                <th className="px-3 py-2 font-semibold">{t("inventory.movementAfter")}</th>
                <th className="px-3 py-2 font-semibold">{t("inventory.movementActor")}</th>
                <th className="px-3 py-2 font-semibold">{t("inventory.movementNote")}</th>
              </tr>
            </thead>
            <tbody>
              {movements.data.rows.map((movement) => (
                <tr key={movement.id} className="border-b border-ink/5">
                  <td className="px-3 py-2 text-xs text-slate-500">
                    {new Date(movement.createdAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-2">{movement.variantName ?? "—"}</td>
                  <td className="px-3 py-2">
                    {MOVEMENT_LABELS[movement.type] ?? movement.type}
                  </td>
                  <td className="px-3 py-2 font-mono">
                    {movement.quantity > 0 ? `+${movement.quantity}` : movement.quantity}
                  </td>
                  <td className="px-3 py-2 font-mono">{movement.resultQuantity}</td>
                  <td className="px-3 py-2 text-xs text-slate-500">
                    {movement.actorName ?? movement.actorId}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {movement.orderId && movement.orderDisplayNumber ? (
                      <span>
                        <Link
                          to={`/orders/${movement.orderId}`}
                          className="text-indigo-600 underline-offset-2 hover:underline"
                        >
                          {movement.orderDisplayNumber}
                        </Link>
                        -{MOVEMENT_LABELS[movement.type] ?? movement.type}
                      </span>
                    ) : (
                      <span className="text-slate-500">{movement.note ?? "—"}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
            <span>
              {t("common.page", {
                page: movements.data.page,
                pageCount: Math.max(1, Math.ceil(movements.data.total / movements.data.pageSize)),
                total: movements.data.total,
              })}
            </span>
            <span className="flex gap-1.5">
              <button
                type="button"
                disabled={movements.data.page <= 1}
                onClick={() => setMovementPage((current) => Math.max(1, current - 1))}
                className="rounded border border-ink/20 px-2 py-1 hover:bg-pill disabled:opacity-40"
              >
                {t("common.previous")}
              </button>
              <button
                type="button"
                disabled={
                  movements.data.page >=
                  Math.max(1, Math.ceil(movements.data.total / movements.data.pageSize))
                }
                onClick={() => setMovementPage((current) => current + 1)}
                className="rounded border border-ink/20 px-2 py-1 hover:bg-pill disabled:opacity-40"
              >
                {t("common.next")}
              </button>
            </span>
          </div>
          </>
          )}
          </>
        ) : (
          <p className="text-sm text-slate-400">{t("inventory.noMovements")}</p>
        )}
      </Card>

      {stockAction ? (
        <Modal
          title={`${stockAction.action === "in" ? t("inventory.inbound") : t("inventory.outbound")} · ${stockAction.variantName} · ${WAREHOUSE_LABELS[stockAction.warehouse] ?? stockAction.warehouse}`}
          onClose={() => setStockAction(null)}
        >
          <div className="space-y-3 text-sm">
            <label className="block text-xs text-slate-500">
              {t("inventory.quantity")}
              <input
                type="number"
                min="1"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                className="mt-1 w-full rounded-lg border border-ink/20 px-2 py-1.5"
              />
            </label>
            <label className="block text-xs text-slate-500">
              {t("inventory.adjustNote")}
              <input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                className="mt-1 w-full rounded-lg border border-ink/20 px-2 py-1.5"
              />
            </label>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setStockAction(null)}
                className={buttonClasses.secondary}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                disabled={busy || !quantity || Number(quantity) <= 0}
                onClick={() => void applyStock()}
                className={buttonClasses.primary}
              >
                {t("common.save")}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
