import { useState } from "react";
import { Navigate, useNavigate, useRouteLoaderData } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  PageHeader,
  Card,
  Badge,
  EmptyState,
  buttonClasses,
} from "../../components/ui";
import { Modal } from "../../components/modal";
import { api } from "../../api-client/client";
import type { rootLoader } from "../../layouts/root-loader";
import { ImagePreviewButton } from "../items/image-preview";
import { isActiveInWarehouse } from "./warehouse-stock";
import { warehouseDisplayName } from "./naming";

interface StockRow {
  warehouse: string;
  quantity: number;
  lowThreshold: number | null;
  archivedAt: string | null;
}

interface VariantView {
  id: string;
  itemCode: string;
  name: string;
  nameEn: string;
  archivedAt: string | null;
  images: unknown;
  stocks: StockRow[];
  total: number;
  low: boolean;
}

interface ItemView {
  id: string;
  name: string;
  nameEn: string;
  images: unknown;
  archivedAt: string | null;
  variants: VariantView[];
  total: number;
}

type Warehouse = "china" | "canada";

interface ItemForm {
  name: string;
  nameEn: string;
}

interface VariantForm {
  name: string;
  nameEn: string;
}

const EMPTY_ITEM: ItemForm = { name: "", nameEn: "" };
const EMPTY_VARIANT: VariantForm = { name: "", nameEn: "" };

/** Redirects /inventory to the first warehouse view the principal may see. */
export function InventoryRedirect() {
  const root = useRouteLoaderData<typeof rootLoader>("root");
  const perms = new Set(root?.user.permissions ?? []);
  const canChina =
    perms.has("inventory:read") || perms.has("inventory:china:read");
  const canCanada =
    perms.has("inventory:read") || perms.has("inventory:canada:read");
  if (canChina) return <Navigate to="/inventory/china" replace />;
  if (canCanada) return <Navigate to="/inventory/canada" replace />;
  return <EmptyState message="inventory:china:read / inventory:canada:read" />;
}

/**
 * Inventory management: the catalog is the product entity; each warehouse
 * view shows that warehouse's stock with in/out actions.
 */
export default function InventoryPage({
  warehouse: warehouseProp,
}: {
  warehouse?: Warehouse;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const root = useRouteLoaderData<typeof rootLoader>("root");
  const perms = new Set(root?.user.permissions ?? []);
  // Warehouse stock actions: global key or this warehouse's key.
  // Product catalog management goes through the items module's permissions.
  const canCreateItems = perms.has("items:create");
  const canUpdateItems = perms.has("items:update");
  const canArchiveItems = perms.has("items:archive");
  const canDeleteItems = perms.has("items:delete");
  const warehouse: Warehouse = warehouseProp ?? "china";
  // Within ONE warehouse: toggle between active stock and this
  // warehouse's archived content (the other warehouse never mixes in).
  const [showArchived, setShowArchived] = useState(false);
  const canManageWarehouse =
    perms.has("inventory:manage") || perms.has(`inventory:${warehouse}:manage`);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [stockAction, setStockAction] = useState<{
    variantId: string;
    variantName: string;
    action: "in" | "out";
  } | null>(null);
  const [quantity, setQuantity] = useState("");
  const [note, setNote] = useState("");
  const [itemModal, setItemModal] = useState<
    { mode: "create" } | { mode: "edit"; id: string; name: string } | null
  >(null);
  const [itemForm, setItemForm] = useState<ItemForm>(EMPTY_ITEM);
  const [variantModal, setVariantModal] = useState<{
    itemId: string;
    itemName: string;
  } | null>(null);
  const [variantForm, setVariantForm] = useState<VariantForm>(EMPTY_VARIANT);

  const items = useQuery({
    queryKey: ["inventory-items"],
    queryFn: async () => {
      const { data, response } = await api.GET("/api/v1/inventory/items");
      if (!response.ok || !data)
        throw new Error(`Load failed (${response.status})`);
      return data as unknown as ItemView[];
    },
  });

  const stockOf = (variant: VariantView, key: string) =>
    variant.stocks.find((stock) => stock.warehouse === key)?.quantity ?? 0;
  /** Archived in this specific warehouse (the other stays active). */
  const archivedIn = (variant: VariantView, key: string) =>
    variant.stocks.find((stock) => stock.warehouse === key)?.archivedAt != null;

  const filtered = (items.data ?? []).filter((item) => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return (
      item.name.toLowerCase().includes(q) ||
      item.nameEn.toLowerCase().includes(q) ||
      item.variants.some(
        (variant) =>
          variant.name.toLowerCase().includes(q) ||
          variant.nameEn.toLowerCase().includes(q),
      )
    );
  });
  const activeItems = filtered
    .filter((item) => !item.archivedAt)
    .map((item) => ({
      ...item,
      variants: item.variants.filter((v) => isActiveInWarehouse(v, warehouse)),
    }));
  const archivedItems = filtered.filter((item) => item.archivedAt);
  // Catalog-archived variants…
  const archivedVariants = filtered
    .filter((item) => !item.archivedAt)
    .flatMap((item) =>
      item.variants
        .filter((variant) => variant.archivedAt)
        .map((variant) => ({
          ...variant,
          itemId: item.id,
          itemName: item.name,
        })),
    );
  // …and variants archived in THIS warehouse only (the same product may
  // stay active in the other warehouse).
  const warehouseArchivedVariants = (items.data ?? [])
    .filter((item) => !item.archivedAt)
    .flatMap((item) =>
      item.variants
        .filter(
          (variant) => !variant.archivedAt && archivedIn(variant, warehouse),
        )
        .map((variant) => ({ variant, itemId: item.id, itemName: item.name })),
    );

  const refresh = () => {
    setError(null);
    void queryClient.invalidateQueries({ queryKey: ["inventory-items"] });
    void queryClient.invalidateQueries({ queryKey: ["items"] });
  };

  const fail = (error: unknown, fallback: string) => {
    const body = (error ?? null) as { message?: string } | null;
    setError(body?.message ?? fallback);
  };

  const applyStock = async () => {
    if (!stockAction || !quantity) return;
    setBusy(true);
    setError(null);
    const delta =
      stockAction.action === "in" ? Number(quantity) : -Number(quantity);
    const { response, error } = await api.POST(
      "/api/v1/inventory/variants/{variantId}/adjust",
      {
        params: { path: { variantId: stockAction.variantId } },
        body: { warehouse, delta, note: note || undefined } as never,
      },
    );
    setBusy(false);
    if (!response.ok) {
      fail(error, t("inventory.adjustFailed"));
      return;
    }
    setStockAction(null);
    setQuantity("");
    setNote("");
    refresh();
  };

  const submitItem = async () => {
    if (!itemModal || !itemForm.name.trim()) return;
    setBusy(true);
    setError(null);
    const body = { name: itemForm.name, nameEn: itemForm.nameEn || undefined };
    const { response } =
      itemModal.mode === "create"
        ? await api.POST("/api/v1/items", { body: body as never })
        : await api.PATCH("/api/v1/items/{id}", {
            params: { path: { id: itemModal.id } },
            body: body as never,
          });
    setBusy(false);
    if (!response.ok) {
      fail(error, t("inventory.actionFailed"));
      return;
    }
    setItemModal(null);
    setItemForm(EMPTY_ITEM);
    refresh();
  };

  const submitVariant = async () => {
    if (!variantModal || !variantForm.name.trim()) return;
    setBusy(true);
    setError(null);
    const { response, error } = await api.POST("/api/v1/items/{id}/variants", {
      params: { path: { id: variantModal.itemId } },
      body: {
        name: variantForm.name,
        nameEn: variantForm.nameEn || undefined,
      } as never,
    });
    setBusy(false);
    if (!response.ok) {
      fail(error, t("inventory.actionFailed"));
      return;
    }
    setVariantModal(null);
    setVariantForm(EMPTY_VARIANT);
    refresh();
  };

  const archiveItem = async (id: string) => {
    setBusy(true);
    setError(null);
    const { response, error } = await api.POST("/api/v1/items/{id}/archive", {
      params: { path: { id } },
      body: {} as never,
    });
    setBusy(false);
    if (!response.ok) {
      fail(error, t("inventory.actionFailed"));
      return;
    }
    refresh();
  };

  const restoreItem = async (id: string) => {
    setBusy(true);
    setError(null);
    const { response, error } = await api.POST("/api/v1/items/{id}/restore", {
      params: { path: { id } },
      body: {} as never,
    });
    setBusy(false);
    if (!response.ok) {
      fail(error, t("inventory.actionFailed"));
      return;
    }
    refresh();
  };

  const deleteItemRow = async (id: string) => {
    setBusy(true);
    setError(null);
    const { response, error } = await api.DELETE("/api/v1/items/{id}", {
      params: { path: { id } },
    });
    setBusy(false);
    if (!response.ok) {
      fail(error, t("inventory.actionFailed"));
      return;
    }
    setSelected((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
    refresh();
  };

  const restoreVariantRow = async (itemId: string, variantId: string) => {
    setBusy(true);
    setError(null);
    const { response, error } = await api.POST(
      "/api/v1/items/{id}/variants/{variantId}/restore",
      {
        params: { path: { id: itemId, variantId } },
        body: {} as never,
      },
    );
    setBusy(false);
    if (!response.ok) {
      fail(error, t("inventory.actionFailed"));
      return;
    }
    refresh();
  };

  const archiveVariantRow = async (variantId: string, name: string) => {
    if (
      !window.confirm(
        t("inventory.archiveVariantWarehouseConfirm", {
          name,
          warehouse: t(`inventory.warehouse.${warehouse}`),
        }),
      )
    )
      return;
    setBusy(true);
    setError(null);
    const { response, error } = await api.POST(
      "/api/v1/inventory/variants/{variantId}/archive",
      {
        params: { path: { variantId } },
        body: { warehouse } as never,
      },
    );
    setBusy(false);
    if (!response.ok) {
      fail(error, t("inventory.actionFailed"));
      return;
    }
    refresh();
  };

  const deleteWarehouseStockRow = async (
    variantId: string,
    name: string,
    quantity: number,
  ) => {
    if (
      !window.confirm(
        t("inventory.deleteWarehouseStockConfirm", {
          name,
          warehouse: t(`inventory.warehouse.${warehouse}`),
          quantity,
        }),
      )
    )
      return;
    setBusy(true);
    setError(null);
    const { response, error } = await api.DELETE(
      "/api/v1/inventory/variants/{variantId}/warehouse-stock",
      { params: { query: { warehouse } } as never },
    );
    setBusy(false);
    if (!response.ok) {
      fail(error, t("inventory.actionFailed"));
      return;
    }
    refresh();
  };

  const restoreVariantInWarehouse = async (
    variantId: string,
    targetWarehouse: string,
  ) => {
    setBusy(true);
    setError(null);
    const { response, error } = await api.POST(
      "/api/v1/inventory/variants/{variantId}/restore",
      {
        params: { path: { variantId } },
        body: { warehouse: targetWarehouse } as never,
      },
    );
    setBusy(false);
    if (!response.ok) {
      fail(error, t("inventory.actionFailed"));
      return;
    }
    refresh();
  };

  const deleteVariantRow = async (itemId: string, variantId: string) => {
    setBusy(true);
    setError(null);
    const { response, error } = await api.DELETE(
      "/api/v1/items/{id}/variants/{variantId}",
      {
        params: { path: { id: itemId, variantId } },
      },
    );
    setBusy(false);
    if (!response.ok) {
      fail(error, t("inventory.actionFailed"));
      return;
    }
    refresh();
  };

  const batchDelete = async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    setBusy(true);
    setError(null);
    for (const id of ids) {
      const { response, error } = await api.DELETE("/api/v1/items/{id}", {
        params: { path: { id } },
      });
      if (!response.ok) {
        fail(error, t("inventory.actionFailed"));
        setBusy(false);
        return;
      }
    }
    setBusy(false);
    setSelected(new Set());
    refresh();
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={`${t("inventory.title")} · ${t(`inventory.warehouse.${warehouse}`)}${
          showArchived ? ` · ${t("inventory.tabArchived")}` : ""
        }`}
        description={t("inventory.intro")}
        actions={
          showArchived ? null : (
            <span className="flex gap-2">
              {canCreateItems ? (
                <button
                  type="button"
                  onClick={() => {
                    setItemForm(EMPTY_ITEM);
                    setItemModal({ mode: "create" });
                  }}
                  className={buttonClasses.primary}
                >
                  {t("inventory.newItem")}
                </button>
              ) : null}
              {canManageWarehouse ? (
                <button
                  type="button"
                  onClick={() => navigate(`/inventory/stocktake/${warehouse}`)}
                  className={buttonClasses.secondary}
                >
                  {t("inventory.stocktake")}
                </button>
              ) : null}
            </span>
          )
        }
      />

      {error ? (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <div className="flex overflow-hidden rounded-xl border border-ink/15">
          {([false, true] as const).map((archivedView) => (
            <button
              key={String(archivedView)}
              type="button"
              onClick={() => setShowArchived(archivedView)}
              className={`px-3.5 py-1.5 transition-colors ${
                showArchived === archivedView
                  ? "bg-ink font-semibold text-white"
                  : "bg-white text-slate-600 hover:bg-pill hover:text-ink"
              }`}
            >
              {t(
                archivedView ? "inventory.tabArchived" : "inventory.tabActive",
              )}
            </button>
          ))}
        </div>
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("inventory.searchPlaceholder")}
          className="w-64 rounded-lg border border-ink/20 bg-white px-2.5 py-1.5"
        />
      </div>

      {items.isLoading ? (
        <Card>
          <p className="text-sm text-slate-400">{t("common.loading")}</p>
        </Card>
      ) : items.isError ? (
        <p className="text-sm text-red-600">{(items.error as Error).message}</p>
      ) : !showArchived ? (
        activeItems.length > 0 ? (
          <div className="space-y-3">
            {activeItems.map((item) => {
              const itemTotal = item.variants.reduce(
                (sum, variant) => sum + stockOf(variant, warehouse),
                0,
              );
              return (
                <Card key={item.id}>
                  <div className="flex flex-wrap items-center gap-2">
                    <ImagePreviewButton
                      images={item.images}
                      name={warehouseDisplayName(item, warehouse)}
                    />
                    <button
                      type="button"
                      onClick={() =>
                        navigate(`/inventory/${item.id}?warehouse=${warehouse}`)
                      }
                      className="font-display text-base font-semibold text-ink underline-offset-2 hover:underline"
                    >
                      {warehouseDisplayName(item, warehouse)}
                    </button>
                    <span className="ml-auto text-sm text-slate-600">
                      {t("inventory.total")}:{" "}
                      <span className="font-semibold">{itemTotal}</span>
                    </span>
                    {canUpdateItems ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setVariantForm(EMPTY_VARIANT);
                          setVariantModal({
                            itemId: item.id,
                            itemName: item.name,
                          });
                        }}
                        className="rounded-lg border border-ink/20 bg-white px-2.5 py-1 text-xs hover:bg-pill disabled:opacity-50"
                      >
                        {t("inventory.addVariant")}
                      </button>
                    ) : null}
                    {canUpdateItems ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setItemForm({ name: item.name, nameEn: item.nameEn });
                          setItemModal({
                            mode: "edit",
                            id: item.id,
                            name: item.name,
                          });
                        }}
                        className="rounded-lg border border-ink/20 bg-white px-2.5 py-1 text-xs hover:bg-pill disabled:opacity-50"
                      >
                        {t("common.edit")}
                      </button>
                    ) : null}
                    {canArchiveItems ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          if (
                            !window.confirm(
                              t("inventory.archiveItemConfirm", {
                                name: warehouseDisplayName(item, warehouse),
                              }),
                            )
                          )
                            return;
                          void archiveItem(item.id);
                        }}
                        className="rounded-lg border border-ink/20 bg-white px-2.5 py-1 text-xs text-slate-500 hover:bg-pill disabled:opacity-50"
                      >
                        {t("inventory.archive")}
                      </button>
                    ) : null}
                  </div>
                  <table className="mt-2 w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-ink/10 text-left text-xs uppercase tracking-wide text-slate-400">
                        <th className="px-2 py-1.5 font-semibold">
                          {t("inventory.variantColumn")}
                        </th>
                        <th className="px-2 py-1.5 font-semibold">
                          {t(`inventory.warehouse.${warehouse}`)}
                        </th>
                        <th className="px-2 py-1.5 font-semibold text-right">
                          {t("common.actions")}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {item.variants.map((variant) => (
                        <tr key={variant.id} className="border-b border-ink/5">
                          <td className="px-2 py-1.5">
                            <div className="flex items-center gap-2">
                              <ImagePreviewButton
                                images={variant.images}
                                name={warehouseDisplayName(variant, warehouse)}
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  navigate(
                                    `/inventory/variant/${variant.id}?warehouse=${warehouse}`,
                                  )
                                }
                                className="font-medium text-ink underline-offset-2 hover:underline"
                              >
                                {warehouseDisplayName(variant, warehouse)}
                              </button>
                              {variant.stocks.some(
                                (stock) =>
                                  stock.warehouse === warehouse &&
                                  stock.lowThreshold != null &&
                                  stock.quantity <= stock.lowThreshold,
                              ) ? (
                                <Badge tone="danger">
                                  {t("inventory.low")}
                                </Badge>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-2 py-1.5 font-mono font-semibold">
                            {stockOf(variant, warehouse)}
                          </td>
                          <td className="px-2 py-1.5 text-right">
                            {canManageWarehouse ? (
                              <span className="inline-flex justify-end gap-1.5">
                                {canManageWarehouse ? (
                                  <>
                                    <button
                                      type="button"
                                      disabled={busy}
                                      onClick={() =>
                                        setStockAction({
                                          variantId: variant.id,
                                          variantName: warehouseDisplayName(
                                            variant,
                                            warehouse,
                                          ),
                                          action: "in",
                                        })
                                      }
                                      className="rounded border border-ink/20 px-2 py-0.5 text-xs text-slate-600 hover:bg-pill disabled:opacity-50"
                                    >
                                      {t("inventory.inbound")}
                                    </button>
                                    <button
                                      type="button"
                                      disabled={busy}
                                      onClick={() =>
                                        setStockAction({
                                          variantId: variant.id,
                                          variantName: warehouseDisplayName(
                                            variant,
                                            warehouse,
                                          ),
                                          action: "out",
                                        })
                                      }
                                      className="rounded border border-red-300 px-2 py-0.5 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
                                    >
                                      {t("inventory.outbound")}
                                    </button>
                                  </>
                                ) : null}
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() =>
                                    void archiveVariantRow(
                                      variant.id,
                                      warehouseDisplayName(variant, warehouse),
                                    )
                                  }
                                  className="rounded border border-ink/20 px-2 py-0.5 text-xs text-slate-500 hover:bg-pill disabled:opacity-50"
                                >
                                  {t("inventory.archive")}
                                </button>
                              </span>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                      {item.variants.length === 0 ? (
                        <tr>
                          <td
                            colSpan={3}
                            className="px-2 py-2 text-xs text-slate-400"
                          >
                            {t("inventory.noVariants")}
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </Card>
              );
            })}
          </div>
        ) : (
          <EmptyState message={t("inventory.empty")} />
        )
      ) : (
        <div className="space-y-3">
          <Card>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-display text-base font-semibold text-ink">
                {t("inventory.archivedItemsTitle")}
              </span>
              {selected.size > 0 ? (
                <span className="text-xs text-slate-500">
                  {t("inventory.selectedCount", { count: selected.size })}
                </span>
              ) : null}
              {canDeleteItems && selected.size > 0 ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (
                      !window.confirm(
                        t("inventory.batchDeleteConfirm", {
                          count: selected.size,
                        }),
                      )
                    )
                      return;
                    void batchDelete();
                  }}
                  className="ml-auto rounded border border-red-300 px-2.5 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
                >
                  {t("inventory.batchDelete")}
                </button>
              ) : null}
            </div>
            {archivedItems.length > 0 ? (
              <ul className="mt-2 divide-y divide-ink/5">
                {archivedItems.map((item) => (
                  <li
                    key={item.id}
                    className="flex flex-wrap items-center gap-2 py-2 text-sm"
                  >
                    {canDeleteItems ? (
                      <input
                        type="checkbox"
                        checked={selected.has(item.id)}
                        onChange={(event) =>
                          setSelected((current) => {
                            const next = new Set(current);
                            if (event.target.checked) next.add(item.id);
                            else next.delete(item.id);
                            return next;
                          })
                        }
                      />
                    ) : null}
                    <span className="font-medium">
                      {warehouseDisplayName(item, "china")}
                    </span>
                    <span className="text-xs text-slate-400">
                      {t("inventory.variantCount", {
                        count: item.variants.length,
                      })}
                    </span>
                    <span className="ml-auto flex gap-1.5">
                      {canArchiveItems ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void restoreItem(item.id)}
                          className="rounded border border-ink/20 px-2 py-0.5 text-xs hover:bg-pill disabled:opacity-50"
                        >
                          {t("inventory.restore")}
                        </button>
                      ) : null}
                      {canDeleteItems ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            if (
                              !window.confirm(
                                t("inventory.deleteItemConfirm", {
                                  name: item.name,
                                }),
                              )
                            )
                              return;
                            void deleteItemRow(item.id);
                          }}
                          className="rounded border border-red-300 px-2 py-0.5 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
                        >
                          {t("common.delete")}
                        </button>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-slate-400">
                {t("inventory.archivedEmpty")}
              </p>
            )}
          </Card>
          {warehouseArchivedVariants.length > 0 ? (
            <Card>
              <span className="font-display text-base font-semibold text-ink">
                {t("inventory.archivedWarehousesTitle")}
              </span>
              <ul className="mt-2 divide-y divide-ink/5">
                {warehouseArchivedVariants.map(({ variant, itemName }) => (
                  <li
                    key={variant.id}
                    className="flex flex-wrap items-center gap-2 py-2 text-sm"
                  >
                    <span className="text-xs text-slate-400">{itemName}</span>
                    <span className="text-slate-400">/</span>
                    <span className="font-medium">
                      {warehouseDisplayName(variant)}
                    </span>
                    <span className="rounded bg-ink/10 px-1.5 py-0.5 text-xs text-ink">
                      {t(`inventory.warehouse.${warehouse}`)}
                    </span>
                    <span className="ml-auto flex gap-1.5">
                      <button
                        type="button"
                        disabled={busy || !canManageWarehouse}
                        onClick={() =>
                          void restoreVariantInWarehouse(variant.id, warehouse)
                        }
                        className="rounded border border-ink/20 px-2 py-0.5 text-xs hover:bg-pill disabled:opacity-50"
                      >
                        {t("inventory.restore")}
                      </button>
                      {canManageWarehouse ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void deleteWarehouseStockRow(
                              variant.id,
                              warehouseDisplayName(variant),
                              variant.stocks.find(
                                (stock) => stock.warehouse === warehouse,
                              )?.quantity ?? 0,
                            )
                          }
                          className="rounded border border-red-300 px-2 py-0.5 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
                        >
                          {t("common.delete")}
                        </button>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
          {archivedVariants.length > 0 ? (
            <Card>
              <span className="font-display text-base font-semibold text-ink">
                {t("inventory.archivedVariantsTitle")}
              </span>
              <ul className="mt-2 divide-y divide-ink/5">
                {archivedVariants.map((variant) => (
                  <li
                    key={variant.id}
                    className="flex flex-wrap items-center gap-2 py-2 text-sm"
                  >
                    <span className="text-xs text-slate-400">
                      {variant.itemName}
                    </span>
                    <span className="text-slate-400">/</span>
                    <span className="font-medium">
                      {warehouseDisplayName(variant, "china")}
                    </span>
                    <span className="ml-auto flex gap-1.5">
                      {canArchiveItems ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void restoreVariantRow(variant.itemId, variant.id)
                          }
                          className="rounded border border-ink/20 px-2 py-0.5 text-xs hover:bg-pill disabled:opacity-50"
                        >
                          {t("inventory.restore")}
                        </button>
                      ) : null}
                      {canDeleteItems ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            if (
                              !window.confirm(
                                t("inventory.deleteVariantConfirm", {
                                  name: variant.name,
                                }),
                              )
                            )
                              return;
                            void deleteVariantRow(variant.itemId, variant.id);
                          }}
                          className="rounded border border-red-300 px-2 py-0.5 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
                        >
                          {t("common.delete")}
                        </button>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      )}

      {stockAction ? (
        <Modal
          title={`${stockAction.action === "in" ? t("inventory.inbound") : t("inventory.outbound")} · ${stockAction.variantName} · ${t(`inventory.warehouse.${warehouse}`)}`}
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

      {itemModal ? (
        <Modal
          title={
            itemModal.mode === "create"
              ? t("inventory.newItem")
              : t("inventory.editItem", { name: itemModal.name })
          }
          onClose={() => setItemModal(null)}
        >
          <div className="space-y-3 text-sm">
            <label className="block text-xs text-slate-500">
              {t("inventory.nameZhLabel")}
              <input
                value={itemForm.name}
                onChange={(event) =>
                  setItemForm({ ...itemForm, name: event.target.value })
                }
                className="mt-1 w-full rounded-lg border border-ink/20 px-2 py-1.5"
              />
            </label>
            <label className="block text-xs text-slate-500">
              {t("inventory.nameEnLabel")}
              <input
                value={itemForm.nameEn}
                onChange={(event) =>
                  setItemForm({ ...itemForm, nameEn: event.target.value })
                }
                className="mt-1 w-full rounded-lg border border-ink/20 px-2 py-1.5"
              />
            </label>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setItemModal(null)}
                className={buttonClasses.secondary}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                disabled={busy || !itemForm.name.trim()}
                onClick={() => void submitItem()}
                className={buttonClasses.primary}
              >
                {t("common.save")}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      {variantModal ? (
        <Modal
          title={`${t("inventory.addVariant")} · ${variantModal.itemName}`}
          onClose={() => setVariantModal(null)}
        >
          <div className="space-y-3 text-sm">
            <label className="block text-xs text-slate-500">
              {t("inventory.nameZhLabel")}
              <input
                value={variantForm.name}
                onChange={(event) =>
                  setVariantForm({ ...variantForm, name: event.target.value })
                }
                placeholder={t("inventory.variantPlaceholder")}
                className="mt-1 w-full rounded-lg border border-ink/20 px-2 py-1.5"
              />
            </label>
            <label className="block text-xs text-slate-500">
              {t("inventory.nameEnLabel")}
              <input
                value={variantForm.nameEn}
                onChange={(event) =>
                  setVariantForm({ ...variantForm, nameEn: event.target.value })
                }
                className="mt-1 w-full rounded-lg border border-ink/20 px-2 py-1.5"
              />
            </label>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setVariantModal(null)}
                className={buttonClasses.secondary}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                disabled={busy || !variantForm.name.trim()}
                onClick={() => void submitVariant()}
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
