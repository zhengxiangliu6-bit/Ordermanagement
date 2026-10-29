import { useTranslation } from "react-i18next";

/** Movement types shown in the filter select (order matters). */
export const MOVEMENT_TYPES = [
  "outbound",
  "return",
  "adjust_in",
  "adjust_out",
  "stocktake",
] as const;

export const MOVEMENT_LABELS: Record<string, string> = {
  outbound: "出库",
  return: "退回入库",
  adjust_in: "入库调整",
  adjust_out: "出库调整",
  stocktake: "盘点",
};

export const WAREHOUSE_LABELS: Record<string, string> = {
  china: "中国仓",
  canada: "加拿大仓",
};

export const PAGE_SIZES = [5, 10, 20, 50, 100] as const;

interface MovementFilterBarProps {
  type: string;
  onType: (value: string) => void;
  order: "asc" | "desc";
  onOrder: (value: "asc" | "desc") => void;
  pageSize: number;
  onPageSize: (value: number) => void;
  variants?: Array<{ id: string; nameZh: string }>;
  variantId?: string;
  onVariantId?: (value: string) => void;
}

/** Shared filter bar above movement tables (type / variant / sort / page size). */
export function MovementFilterBar({
  type,
  onType,
  order,
  onOrder,
  pageSize,
  onPageSize,
  variants,
  variantId,
  onVariantId,
}: MovementFilterBarProps) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center justify-end gap-2 text-xs text-slate-500">
      {variants && onVariantId !== undefined ? (
        <span className="flex items-center gap-1.5">
          <span>{t("inventory.variantColumn")}</span>
          <select
            value={variantId ?? ""}
            onChange={(event) => onVariantId(event.target.value)}
            className="rounded-lg border border-ink/20 bg-white px-1.5 py-1"
          >
            <option value="">{t("inventory.allVariants")}</option>
            {variants.map((variant) => (
              <option key={variant.id} value={variant.id}>
                {variant.nameZh}
              </option>
            ))}
          </select>
        </span>
      ) : null}
      <span className="flex items-center gap-1.5">
        <span>{t("inventory.movementType")}</span>
        <select
          value={type}
          onChange={(event) => onType(event.target.value)}
          className="rounded-lg border border-ink/20 bg-white px-1.5 py-1"
        >
          <option value="">{t("inventory.movementTypeAll")}</option>
          {MOVEMENT_TYPES.map((movementType) => (
            <option key={movementType} value={movementType}>
              {MOVEMENT_LABELS[movementType]}
            </option>
          ))}
        </select>
      </span>
      <span className="flex items-center gap-1.5">
        <span>{t("inventory.sortLabel")}</span>
        <select
          value={order}
          onChange={(event) => onOrder(event.target.value as "asc" | "desc")}
          className="rounded-lg border border-ink/20 bg-white px-1.5 py-1"
        >
          <option value="desc">{t("inventory.sortNewest")}</option>
          <option value="asc">{t("inventory.sortOldest")}</option>
        </select>
      </span>
      <span className="flex items-center gap-1.5">
        <span>{t("inventory.pageSizeLabel")}</span>
        <select
          value={pageSize}
          onChange={(event) => onPageSize(Number(event.target.value))}
          className="rounded-lg border border-ink/20 bg-white px-1.5 py-1"
        >
          {PAGE_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </span>
    </div>
  );
}
