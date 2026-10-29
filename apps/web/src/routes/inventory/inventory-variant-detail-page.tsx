import { useState } from "react";
import { Link, useNavigate, useParams, useRouteLoaderData, useSearchParams } from "react-router";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { PageHeader, Card, Badge, buttonClasses, Mono } from "../../components/ui";
import { Modal } from "../../components/modal";
import {
  MovementFilterBar,
  MOVEMENT_LABELS,
  WAREHOUSE_LABELS,
} from "./movement-filter-bar";
import { warehouseDisplayName, imageUrls } from "./naming";
import { AccessDeniedPage } from "../access-denied";
import { api } from "../../api-client/client";
import type { rootLoader } from "../../layouts/root-loader";

interface StockRow {
  warehouse: string;
  quantity: number;
  lowThreshold: number | null;
  archivedAt: string | null;
}

interface VariantDetail {
  id: string;
  itemCode: string;
  name: string;
  nameEn: string;
  images: unknown;
  archivedAt: string | null;
  item: {
    id: string;
    name: string;
    nameEn: string;
    images?: unknown;
    archivedAt: string | null;
  };
  stocks: StockRow[];
  total: number;
  low: boolean;
}

interface MovementRow {
  id: string;
  warehouse: string;
  type: string;
  quantity: number;
  resultQuantity: number;
  actorName: string | null;
  note: string | null;
  createdAt: string;
  orderId: string | null;
  orderDisplayNumber: string | null;
}

interface MovementsPage {
  rows: MovementRow[];
  total: number;
  page: number;
  pageSize: number;
}

const WAREHOUSES = ["china", "canada"] as const;
type Warehouse = (typeof WAREHOUSES)[number];

/**
 * Single product-variant inventory page, scoped to ONE warehouse: the two
 * warehouses are fully independent and merely share the catalog.
 */
export default function InventoryVariantDetailPage() {
  const { t } = useTranslation();
  const { variantId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const root = useRouteLoaderData<typeof rootLoader>("root");
  const perms = new Set(root?.user.permissions ?? []);
  const warehouse: Warehouse =
    searchParams.get("warehouse") === "canada" ? "canada" : "china";
  const canReadGlobal = perms.has("inventory:read");
  // Reading this page requires the global key or this warehouse's key.
  const canReadWarehouse =
    canReadGlobal || perms.has(`inventory:${warehouse}:read`);
  const canManageWarehouse =
    perms.has("inventory:manage") || perms.has(`inventory:${warehouse}:manage`);
  // Product catalog actions go through the items module's permissions.
  const canUpdateItems = perms.has("items:update");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [movementType, setMovementType] = useState("");
  const [movementOrder, setMovementOrder] = useState<"asc" | "desc">("desc");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [stockAction, setStockAction] = useState<"in" | "out" | null>(null);
  const [quantity, setQuantity] = useState("");
  const [note, setNote] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({ name: "", nameEn: "" });

  const detail = useQuery({
    queryKey: ["inventory-variant", variantId],
    queryFn: async () => {
      const { data, response } = await api.GET("/api/v1/inventory/variants/{variantId}", {
        params: { path: { variantId } },
      });
      if (!response.ok || !data) throw new Error(`Load failed (${response.status})`);
      return data as unknown as VariantDetail;
    },
    enabled: canReadWarehouse,
  });

  const movements = useQuery({
    queryKey: [
      "inventory-variant-movements",
      variantId,
      page,
      pageSize,
      movementType,
      movementOrder,
      warehouse,
    ],
    queryFn: async () => {
      const { data, response } = await api.GET(
        "/api/v1/inventory/variants/{variantId}/movements",
        {
          params: {
            path: { variantId },
            query: {
              page,
              pageSize,
              warehouse,
              ...(movementType ? { type: movementType } : {}),
              order: movementOrder,
            },
          },
        } as never,
      );
      if (!response.ok || !data) throw new Error(`Load failed (${response.status})`);
      return data as unknown as MovementsPage;
    },
    placeholderData: keepPreviousData,
    enabled: canReadWarehouse,
  });

  if (!canReadWarehouse) {
    return (
      <AccessDeniedPage
        requiredPermission={`inventory:${warehouse}:read / inventory:read`}
      />
    );
  }

  const stockOf = (key: string) =>
    detail.data?.stocks.find((stock) => stock.warehouse === key)?.quantity ?? 0;

  const refresh = () => {
    setError(null);
    void queryClient.invalidateQueries({ queryKey: ["inventory-variant", variantId] });
    void queryClient.invalidateQueries({
      queryKey: ["inventory-variant-movements", variantId],
    });
    void queryClient.invalidateQueries({ queryKey: ["inventory-items"] });
    void queryClient.invalidateQueries({ queryKey: ["items"] });
  };

  const applyStock = async () => {
    if (!stockAction || !quantity) return;
    setBusy(true);
    setError(null);
    const delta = stockAction === "in" ? Number(quantity) : -Number(quantity);
    const { response, error } = await api.POST(
      "/api/v1/inventory/variants/{variantId}/adjust",
      {
        params: { path: { variantId } },
        body: { warehouse, delta, note: note || undefined } as never,
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

  // Archive is warehouse-scoped: this page's warehouse only.
  const setArchived = async (archived: boolean) => {
    setBusy(true);
    setError(null);
    const call = archived
      ? api.POST("/api/v1/inventory/variants/{variantId}/archive", {
          params: { path: { variantId } },
          body: { warehouse } as never,
        })
      : api.POST("/api/v1/inventory/variants/{variantId}/restore", {
          params: { path: { variantId } },
          body: { warehouse } as never,
        });
    const { response, error } = await call;
    setBusy(false);
    if (!response.ok) {
      const body = (error ?? null) as { message?: string } | null;
      setError(body?.message ?? t("inventory.actionFailed"));
      return;
    }
    refresh();
  };

  const saveEdit = async () => {
    if (!detail.data || !editForm.name.trim()) return;
    setBusy(true);
    setError(null);
    const { response, error } = await api.PATCH(
      "/api/v1/items/{id}/variants/{variantId}",
      {
        params: { path: { id: detail.data.item.id, variantId } },
        body: { name: editForm.name, nameEn: editForm.nameEn } as never,
      },
    );
    setBusy(false);
    if (!response.ok) {
      const body = (error ?? null) as { message?: string } | null;
      setError(body?.message ?? t("inventory.actionFailed"));
      return;
    }
    setEditOpen(false);
    refresh();
  };

  if (detail.isLoading) {
    return <p className="text-sm text-slate-400">{t("common.loading")}</p>;
  }
  if (detail.isError) {
    return <p className="text-sm text-red-600">{(detail.error as Error).message}</p>;
  }
  const variant = detail.data;
  if (!variant) return null;

  const total = movements.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = movements.data?.page ?? page;
  const archived =
    !!variant.archivedAt ||
    variant.stocks.find((stock) => stock.warehouse === warehouse)?.archivedAt != null;
  const displayName = warehouseDisplayName(variant, warehouse);
  const itemDisplayName = warehouseDisplayName(variant.item, warehouse);

  return (
    <div className="space-y-4">
      <PageHeader
        title={`${itemDisplayName} - ${displayName}`}

        description={`${variant.itemCode} · ${t(`inventory.warehouse.${warehouse}`)}`}
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

      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-xl bg-ink px-3 py-1.5 text-sm font-semibold text-white">
            {t(`inventory.warehouse.${warehouse}`)}:{" "}
            <span className="font-mono">{stockOf(warehouse)}</span>
          </span>
          {variant.low ? <Badge tone="danger">{t("inventory.low")}</Badge> : null}
          {archived ? <Badge tone="neutral">{t("common.archived")}</Badge> : null}
          {!archived && (canManageWarehouse || canUpdateItems) ? (
            <span className="ml-auto flex flex-wrap gap-1.5">
              {canManageWarehouse ? (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setStockAction("in")}
                    className="rounded border border-ink/20 px-2.5 py-1 text-xs text-slate-700 hover:bg-pill disabled:opacity-50"
                  >
                    {t("inventory.inbound")}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setStockAction("out")}
                    className="rounded border border-red-300 px-2.5 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >
                    {t("inventory.outbound")}
                  </button>
                </>
              ) : null}
              {canUpdateItems ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setEditForm({ name: variant.name, nameEn: variant.nameEn });
                    setEditOpen(true);
                  }}
                  className="rounded border border-ink/20 px-2.5 py-1 text-xs hover:bg-pill disabled:opacity-50"
                >
                  {t("common.edit")}
                </button>
              ) : null}
              {canManageWarehouse ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (
                      !window.confirm(
                        t("inventory.archiveVariantWarehouseConfirm", {
                          name: displayName,
                          warehouse: t(`inventory.warehouse.${warehouse}`),
                        }),
                      )
                    )
                      return;
                    void setArchived(true);
                  }}
                  className="rounded border border-ink/20 px-2.5 py-1 text-xs text-slate-500 hover:bg-pill disabled:opacity-50"
                >
                  {t("inventory.archive")}
                </button>
              ) : null}
            </span>
          ) : null}
          {archived && canManageWarehouse ? (
            <span className="ml-auto flex gap-1.5">
              <button
                type="button"
                disabled={busy}
                onClick={() => void setArchived(false)}
                className="rounded border border-ink/20 px-2.5 py-1 text-xs hover:bg-pill disabled:opacity-50"
              >
                {t("inventory.restore")}
              </button>
            </span>
          ) : null}
        </div>
      </Card>

      <Card title={t("inventory.imagesTitle")}>
        {(() => {
          const urls = imageUrls(variant.images);
          const fallback = imageUrls(
            (variant.item as unknown as { images?: unknown }).images,
          );
          const list = urls.length > 0 ? urls : fallback;
          if (list.length === 0) {
            return <p className="text-sm text-slate-400">{t("inventory.noImages")}</p>;
          }
          return (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                {list.map((url) => (
                  <a key={url} href={url} target="_blank" rel="noreferrer" title={url}>
                    <img
                      src={url}
                      alt={displayName}
                      onError={(event) => {
                        event.currentTarget.style.display = "none";
                      }}
                      className="h-16 w-16 rounded-lg border border-ink/10 object-cover"
                    />
                  </a>
                ))}
              </div>
              <ul className="space-y-0.5">
                {list.map((url) => (
                  <li key={`link-${url}`} className="max-w-md truncate text-xs">
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-indigo-600 underline-offset-2 hover:underline"
                    >
                      {url}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          );
        })()}
      </Card>

      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-display text-base font-semibold text-ink">
            {t("inventory.movementsTitle")}
          </span>
          <Mono>{variant.itemCode}</Mono>
        </div>
        {movements.isLoading ? (
          <p className="mt-2 text-sm text-slate-400">{t("common.loading")}</p>
        ) : movements.data ? (
          <>
            <MovementFilterBar
              type={movementType}
              onType={(value) => {
                setMovementType(value);
                setPage(1);
              }}
              order={movementOrder}
              onOrder={setMovementOrder}
              pageSize={pageSize}
              onPageSize={(value) => {
                setPageSize(value);
                setPage(1);
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
                        <td className="px-3 py-2">
                          {MOVEMENT_LABELS[movement.type] ?? movement.type}
                        </td>
                        <td className="px-3 py-2 font-mono">
                          {movement.quantity > 0 ? `+${movement.quantity}` : movement.quantity}
                        </td>
                        <td className="px-3 py-2 font-mono">{movement.resultQuantity}</td>
                        <td className="px-3 py-2 text-xs text-slate-500">
                          {movement.actorName ?? "—"}
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
                      page: currentPage,
                      pageCount,
                      total,
                    })}
                  </span>
                  <span className="flex gap-1.5">
                    <button
                      type="button"
                      disabled={currentPage <= 1}
                      onClick={() => setPage((current) => Math.max(1, current - 1))}
                      className="rounded border border-ink/20 px-2 py-1 hover:bg-pill disabled:opacity-40"
                    >
                      {t("common.previous")}
                    </button>
                    <button
                      type="button"
                      disabled={currentPage >= pageCount}
                      onClick={() => setPage((current) => current + 1)}
                      className="rounded border border-ink/20 px-2 py-1 hover:bg-pill disabled:opacity-40"
                    >
                      {t("common.next")}
                    </button>
                  </span>
                </div>
              </>
            )}
          </>
        ) : null}
      </Card>

      {stockAction ? (
        <Modal
          title={`${stockAction === "in" ? t("inventory.inbound") : t("inventory.outbound")} · ${itemDisplayName} / ${displayName} · ${WAREHOUSE_LABELS[warehouse] ?? warehouse}`}
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

      {editOpen ? (
        <Modal title={t("inventory.editVariantTitle")} onClose={() => setEditOpen(false)}>
          <div className="space-y-3 text-sm">
            <label className="block text-xs text-slate-500">
              {t("inventory.nameZhLabel")}
              <input
                value={editForm.name}
                onChange={(event) => setEditForm({ ...editForm, name: event.target.value })}
                className="mt-1 w-full rounded-lg border border-ink/20 px-2 py-1.5"
              />
            </label>
            <label className="block text-xs text-slate-500">
              {t("inventory.nameEnLabel")}
              <input
                value={editForm.nameEn}
                onChange={(event) => setEditForm({ ...editForm, nameEn: event.target.value })}
                className="mt-1 w-full rounded-lg border border-ink/20 px-2 py-1.5"
              />
            </label>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditOpen(false)}
                className={buttonClasses.secondary}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                disabled={busy || !editForm.name.trim()}
                onClick={() => void saveEdit()}
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
