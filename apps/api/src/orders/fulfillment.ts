/**
 * Local mirror of the platform fulfillment status. The verbatim platform
 * status stays in Order.statusRaw (§10.3); this normalized copy exists for
 * reliable list filtering (JSON path filters cannot distinguish missing
 * keys, JSON null and non-fulfilled values).
 */
export function normalizeFulfillmentStatus(statusRaw: unknown): string | null {
  const value = (statusRaw as Record<string, unknown> | null)?.fulfillmentStatus;
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  return normalized || null;
}
