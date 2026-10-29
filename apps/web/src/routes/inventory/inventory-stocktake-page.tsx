import { useState } from "react";
import { useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { PageHeader, Card, EmptyState, buttonClasses } from "../../components/ui";
import { warehouseDisplayName } from "./naming";
import { api } from "../../api-client/client";

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
  total: number;
  low: boolean;
  stocks: StockRow[];
}

interface InventoryItemView {
  id: string;
  name: string;
  nameEn: string;
  archivedAt: string | null;
  variants: InventoryVariantView[];
}

const WAREHOUSES = ["china", "canada"] as const;
type Warehouse = (typeof WAREHOUSES)[number];

const WAREHOUSE_LABELS: Record<string, string> = {
  china: "中国仓",
  canada: "加拿大仓",
};

interface StocktakeRow {
  key: string;
  itemId: string;
  itemName: string;
  itemNameEn: string;
  variantId: string;
  variantName: string;
  variantNameEn: string;
  warehouse: string;
  current: number;
  counted: string;
  note: string;
}

/** Stocktake (M7d): warehouse-split editable count sheets, one route per warehouse. */
export default function InventoryStocktakePage({
  warehouse,
}: {
  warehouse: Warehouse;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [batchNote, setBatchNote] = useState("");
  const [rows, setRows] = useState<StocktakeRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const items = useQuery({
    queryKey: ["inventory-items"],
    queryFn: async () => {
      const { data, response } = await api.GET("/api/v1/inventory/items");
      if (!response.ok || !data) throw new Error(`Load failed (${response.status})`);
      return data as unknown as InventoryItemView[];
    },
  });

  // Build the editable rows once the items load (kept in state so inputs
  // are freely editable while typing). Drafts for both warehouses are kept
  // so switching tabs does not lose unsaved counts.
  const stocktakeRows: StocktakeRow[] =
    rows ??
    (items.data ?? [])
      .filter((item) => !item.archivedAt)
      .flatMap((item) =>
        item.variants
          .filter((variant) => !variant.archivedAt)
          .flatMap((variant) =>
            WAREHOUSES.map((warehouseKey) => {
              const stock = variant.stocks.find((s) => s.warehouse === warehouseKey);
              return {
                key: `${variant.id}:${warehouseKey}`,
                itemId: item.id,
                itemName: item.name,
                itemNameEn: item.nameEn,
                variantId: variant.id,
                variantName: variant.name,
                variantNameEn: variant.nameEn,
                warehouse: warehouseKey,
                current: stock?.quantity ?? 0,
                counted: String(stock?.quantity ?? 0),
                note: "",
              };
            }),
          ),
      );

  const visibleRows = stocktakeRows.filter((row) => row.warehouse === warehouse);

  const setRow = (key: string, patch: Partial<StocktakeRow>) => {
    setRows((current) =>
      (current ?? stocktakeRows).map((row) =>
        row.key === key ? { ...row, ...patch } : row,
      ),
    );
  };

  const saveAll = async () => {
    const filled = visibleRows.filter(
      (row) => row.counted !== "" && !Number.isNaN(Number(row.counted)),
    );
    if (filled.length === 0) {
      setError(t("inventory.stocktakeNothing"));
      return;
    }
    setBusy(true);
    setError(null);
    const { response } = await api.POST("/api/v1/inventory/stocktake-batch", {
      body: {
        entries: filled.map((row) => ({
          inventoryItemVariantId: row.variantId,
          warehouse: row.warehouse,
          countedQuantity: Number(row.counted),
          note: row.note || undefined,
        })),
        note: batchNote,
      } as never,
    });
    setBusy(false);
    if (!response.ok) {
      setError(t("inventory.stocktakeFailed"));
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["inventory-items"] });
    navigate(`/inventory/${warehouse}`);
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={`${t("inventory.stocktakePageTitle")} · ${WAREHOUSE_LABELS[warehouse] ?? warehouse}`}
        description={t("inventory.stocktakePageIntro")}
        actions={
          <span className="flex gap-2">
            <button
              type="button"
              onClick={() => navigate(`/inventory/${warehouse}`)}
              className={buttonClasses.secondary}
            >
              {t("common.back")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void saveAll()}
              className={buttonClasses.primary}
            >
              {t("inventory.saveStocktake")}
            </button>
          </span>
        }
      />
      {error ? <p className="text-sm text-red-600" role="alert">{error}</p> : null}

      {items.isLoading ? (
        <Card><p className="text-sm text-slate-400">{t("common.loading")}</p></Card>
      ) : items.isError ? (
        <p className="text-sm text-red-600">{(items.error as Error).message}</p>
      ) : visibleRows.length === 0 ? (
        <EmptyState message={t("inventory.stocktakeNothing")} />
      ) : (
        <Card>
          <label className="block text-xs text-slate-500">
            {t("inventory.batchNote")}
            <input
              value={batchNote}
              onChange={(event) => setBatchNote(event.target.value)}
              placeholder={t("inventory.batchNotePlaceholder")}
              className="mt-1 w-full rounded-lg border border-ink/20 px-2 py-1.5"
            />
          </label>
          <table className="mt-3 w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-ink/10 text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="px-3 py-2 font-semibold">{t("inventory.itemColumn")}</th>
                <th className="px-3 py-2 font-semibold">{t("inventory.currentStock")}</th>
                <th className="px-3 py-2 font-semibold">{t("inventory.countedQuantity")}</th>
                <th className="px-3 py-2 font-semibold">{t("inventory.entryNote")}</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={row.key} className="border-b border-ink/5">
                  <td className="px-3 py-2">
                    {warehouseDisplayName(
                      { name: row.itemName, nameEn: row.itemNameEn },
                      warehouse,
                    )}{" "}
                    /{" "}
                    {warehouseDisplayName(
                      { name: row.variantName, nameEn: row.variantNameEn },
                      warehouse,
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono">{row.current}</td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      min="0"
                      value={row.counted}
                      onChange={(event) => setRow(row.key, { counted: event.target.value })}
                      className="w-24 rounded-lg border border-ink/20 px-2 py-1"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      value={row.note}
                      onChange={(event) => setRow(row.key, { note: event.target.value })}
                      className="w-full rounded-lg border border-ink/20 px-2 py-1"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

