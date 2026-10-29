import { useTranslation } from "react-i18next";
import { Badge, Mono, buttonClasses } from "../../components/ui";
import { StageBadge } from "./stage-badge";
import type { OrderView } from "../../types/order";

/** One order-list table (active or finished) with its own pagination. */
export function OrdersTable({
  orders,
  page,
  pageCount,
  total,
  onPage,
  onOpen,
}: {
  orders: OrderView[];
  page: number;
  pageCount: number;
  total: number;
  onPage: (page: number) => void;
  onOpen: (id: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-xl border border-ink/10 pop-shadow-sm">
        <table className="w-full min-w-[1300px] border-collapse bg-white text-sm">
          <thead>
            <tr className="border-b border-ink/10 text-left text-xs uppercase tracking-wide text-slate-400">
              <th className="px-4 py-2.5 font-semibold">{t("orders.number")}</th>
              <th className="px-3 py-2.5 font-semibold">{t("orders.customer")}</th>
              <th className="px-3 py-2.5 font-semibold">{t("orders.reviewNoteCol")}</th>
              <th className="px-3 py-2.5 font-semibold">{t("orders.categoryCol")}</th>
              <th className="px-3 py-2.5 font-semibold">{t("orders.productCol")}</th>
              <th className="px-3 py-2.5 font-semibold">{t("orders.carrierCol")}</th>
              <th className="px-3 py-2.5 font-semibold">{t("orders.trackingCol")}</th>
              <th className="px-3 py-2.5 font-semibold">{t("orders.tailTrackingCol")}</th>
              <th className="px-3 py-2.5 font-semibold">{t("orders.shippedAtCol")}</th>
              <th className="px-3 py-2.5 font-semibold">{t("orders.status")}</th>
              <th className="px-3 py-2.5 font-semibold">{t("orders.source")}</th>
              <th className="px-3 py-2.5 font-semibold">{t("orders.created")}</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr
                key={order.id}
                onClick={() => onOpen(order.id)}
                className="cursor-pointer border-b border-ink/5 transition-colors last:border-0 hover:bg-pill"
              >
                <td className="px-4 py-2.5"><Mono>{order.displayNumber}</Mono></td>
                <td className="px-3 py-2.5">{String(order.customerSnapshot?.name ?? "—")}</td>
                <td className="max-w-40 truncate px-3 py-2.5 text-xs text-slate-600">
                  {order.latestReviewNote ? (
                    <span title={order.latestReviewNote}>
                      {order.latestReviewNote.replace(/^\[Review\]\s*/, "")}
                    </span>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  {order.category ? (
                    <Badge tone="neutral">{order.category.name}</Badge>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </td>
                <td className="max-w-44 truncate px-3 py-2.5 text-slate-600">
                  {order.lines?.[0]?.title ?? "—"}
                  {(order._count?.lines ?? 0) > 1 ? (
                    <span className="ml-1 text-xs text-slate-400">
                      +{(order._count?.lines ?? 0) - 1}
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-2.5 text-slate-600">
                  {order.shipments?.[0]?.carrier?.name ?? "—"}
                </td>
                <td className="px-3 py-2.5">
                  <Mono>
                    {order.shipments?.[0]?.attakyTrackingNumber
                      ?? order.shipments?.[0]?.originalTrackingNumber
                      ?? "—"}
                  </Mono>
                </td>
                <td className="px-3 py-2.5">
                  <Mono>{order.shipments?.[0]?.tailTrackingNumber ?? "—"}</Mono>
                </td>
                <td className="px-3 py-2.5 text-xs text-slate-500">
                  {order.shipments?.[0]?.dispatchedAt
                    ? new Date(order.shipments[0].dispatchedAt).toLocaleDateString()
                    : "—"}
                </td>
                <td className="px-3 py-2.5">
                  <span className="flex flex-wrap items-center gap-1">
                    {order.archivedAt ? (
                      <Badge tone="warning">{t("common.archived")}</Badge>
                    ) : null}
                    <StageBadge stage={order.stage} />
                  </span>
                </td>
                <td className="px-3 py-2.5">
                  <Badge tone={order.source === "manual" ? "info" : "neutral"}>
                    {order.source === "manual"
                      ? t("orders.sourceManual")
                      : t("orders.sourceExternal")}
                  </Badge>
                </td>
                <td className="px-3 py-2.5 text-xs text-slate-500">
                  {new Date(order.createdAt).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pageCount > 1 ? (
        <div className="flex items-center justify-center gap-3 text-sm">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => onPage(page - 1)}
            className={buttonClasses.secondary}
          >
            {t("common.previous")}
          </button>
          <span className="text-slate-500">
            {t("common.page", { page, pageCount, total })}
          </span>
          <button
            type="button"
            disabled={page >= pageCount}
            onClick={() => onPage(page + 1)}
            className={buttonClasses.secondary}
          >
            {t("common.next")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
