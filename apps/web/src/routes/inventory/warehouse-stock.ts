interface WarehouseVariant {
  archivedAt: string | null;
  stocks: Array<{ warehouse: string; archivedAt?: string | null }>;
}

/** Catalog archive is global; stock archive applies only to its own warehouse. */
export function isActiveInWarehouse(
  variant: WarehouseVariant,
  warehouse: string,
): boolean {
  return (
    !variant.archivedAt &&
    !variant.stocks.some(
      (stock) => stock.warehouse === warehouse && stock.archivedAt != null,
    )
  );
}
