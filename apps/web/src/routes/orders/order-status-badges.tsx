import { useTranslation } from "react-i18next";

/**
 * Platform status badges rendered from the preserved raw status (§10.3):
 * Shopify's displayFulfillmentStatus / displayFinancialStatus plus the
 * cancellation flag. Unknown platform values fall back to their raw text.
 */

const FULFILLMENT_LABEL_KEYS: Record<string, string> = {
  UNFULFILLED: "orders.fulUnfulfilled",
  PARTIALLY_FULFILLED: "orders.fulPartial",
  FULFILLED: "orders.fulFulfilled",
};

const FULFILLMENT_BADGE_CLASSES: Record<string, string> = {
  UNFULFILLED: "bg-slate-100 text-slate-700",
  PARTIALLY_FULFILLED: "bg-amber-100 text-amber-800",
  FULFILLED: "bg-emerald-100 text-emerald-800",
};

const FINANCIAL_LABEL_KEYS: Record<string, string> = {
  PAID: "orders.finPaid",
  PENDING: "orders.finPending",
  PARTIALLY_PAID: "orders.finPartialPaid",
  AUTHORIZED: "orders.finAuthorized",
  REFUNDED: "orders.finRefunded",
  PARTIALLY_REFUNDED: "orders.finPartialRefunded",
  VOIDED: "orders.finVoided",
};

const FINANCIAL_BADGE_CLASSES: Record<string, string> = {
  PAID: "bg-emerald-100 text-emerald-800",
  PARTIALLY_PAID: "bg-amber-100 text-amber-800",
  AUTHORIZED: "bg-sky-100 text-sky-800",
  PENDING: "bg-amber-100 text-amber-800",
  REFUNDED: "bg-red-100 text-red-700",
  PARTIALLY_REFUNDED: "bg-red-100 text-red-700",
  VOIDED: "bg-red-100 text-red-700",
};

/** Payment-only badge for the merged list status cell. */
export function FinancialStatusBadge({
  statusRaw,
}: {
  statusRaw: Record<string, unknown> | null;
}) {
  const { t } = useTranslation();
  const financial = String((statusRaw ?? {}).financialStatus ?? "") || null;
  if (!financial) return null;
  return (
    <span
      className={`whitespace-nowrap rounded px-1.5 py-0.5 text-xs ${
        FINANCIAL_BADGE_CLASSES[financial] ?? "bg-slate-100 text-slate-700"
      }`}
    >
      {FINANCIAL_LABEL_KEYS[financial]
        ? t(FINANCIAL_LABEL_KEYS[financial])
        : financial}
    </span>
  );
}

export function OrderStatusBadges({
  statusRaw,
  cancelledAt,
}: {
  statusRaw: Record<string, unknown> | null;
  /** Local cancellation (manual, or mirrored from the platform at import). */
  cancelledAt?: string | null;
}) {
  const { t } = useTranslation();
  const raw = statusRaw ?? {};
  const fulfillment = String(raw.fulfillmentStatus ?? "") || null;
  const cancelled = Boolean(cancelledAt ?? raw.cancelledAt);

  return (
    <span className="flex flex-wrap items-center gap-1 whitespace-nowrap">
      {cancelled ? (
        <span className="whitespace-nowrap rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-700">
          {t("orders.cancelled")}
        </span>
      ) : null}
      {fulfillment ? (
        <span
          className={`whitespace-nowrap rounded px-1.5 py-0.5 text-xs ${
            FULFILLMENT_BADGE_CLASSES[fulfillment] ?? "bg-slate-100 text-slate-700"
          }`}
        >
          {FULFILLMENT_LABEL_KEYS[fulfillment]
            ? t(FULFILLMENT_LABEL_KEYS[fulfillment])
            : fulfillment}
        </span>
      ) : null}
    </span>
  );
}
