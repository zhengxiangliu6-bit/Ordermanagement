import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { useRouteLoaderData } from "react-router";
import { useQuery } from "@tanstack/react-query";
import type { rootLoader } from "../layouts/root-loader";
import { api } from "../api-client/client";
import { PageHeader, Card, buttonClasses, Mono } from "../components/ui";

interface QueueCount {
  total: number;
}

function useReviewCount(type: string, enabled: boolean) {
  return useQuery({
    queryKey: ["dashboard-review", type],
    enabled,
    retry: false,
    queryFn: async () => {
      const { data, response } = await api.GET("/api/v1/review-queue", {
        params: { query: { type } as never },
      });
      if (!response.ok || !data) return { total: 0 } as QueueCount;
      return data as unknown as QueueCount;
    },
  });
}

/**
 * Dashboard as the day's work center (§19-lite): pending counts across the
 * review queues and shipments needing attention, with quick links.
 */
export default function DashboardPage() {
  const data = useRouteLoaderData<typeof rootLoader>("root");
  const user = data?.user;
  const { t } = useTranslation();
  const permissions = new Set(user?.permissions ?? []);

  const canOrders = permissions.has("orders:read");
  const canShipping = permissions.has("shipping:read");

  const newOrders = useReviewCount("new_order", canOrders);
  const orderUpdates = useReviewCount("order_update", canOrders);
  const listings = useReviewCount("listing", canOrders);
  const shipmentsQueue = useReviewCount("shipment", canShipping);

  const attention = useQuery({
    queryKey: ["dashboard-shipments-attention"],
    enabled: canShipping,
    retry: false,
    queryFn: async () => {
      const { data, response } = await api.GET("/api/v1/shipments", {
        params: { query: { view: "needs_attention" } as never },
      });
      if (!response.ok || !data) return { total: 0 } as QueueCount;
      return data as unknown as QueueCount;
    },
  });

  const todoItems = [
    {
      to: "/review?type=new_order",
      enabled: canOrders,
      label: t("dashboard.todoNewOrders"),
      count: newOrders.data?.total ?? 0,
      dot: "bg-play-blue",
    },
    {
      to: "/review?type=order_update",
      enabled: canOrders,
      label: t("dashboard.todoOrderUpdates"),
      count: orderUpdates.data?.total ?? 0,
      dot: "bg-play-orange",
    },
    {
      to: "/review?type=listing",
      enabled: canOrders,
      label: t("dashboard.todoListings"),
      count: listings.data?.total ?? 0,
      dot: "bg-play-pink",
    },
    {
      to: "/review?type=shipment",
      enabled: canShipping,
      label: t("dashboard.todoOutbound"),
      count: shipmentsQueue.data?.total ?? 0,
      dot: "bg-play-yellow",
    },
    {
      to: "/shipments?view=needs_attention",
      enabled: canShipping,
      label: t("dashboard.todoShipmentsAttention"),
      count: attention.data?.total ?? 0,
      dot: "bg-brand",
    },
  ].filter((item) => item.enabled);

  const totalOpen = todoItems.reduce((sum, item) => sum + item.count, 0);

  const shortcuts = [
    { to: "/orders", label: t("nav.allOrders"), enabled: canOrders },
    { to: "/shipments", label: t("shipments.pageTitle"), enabled: canShipping },
    { to: "/items", label: t("nav.items"), enabled: permissions.has("items:read") },
    { to: "/stores", label: t("nav.stores"), enabled: permissions.has("stores:read") },
  ].filter((item) => item.enabled);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("dashboard.title")}
        description={t("dashboard.subtitle", { name: user?.displayName ?? "" })}
      />

      <Card title={t("dashboard.todoTitle")}>
        <p className="mb-3 text-sm text-slate-500">
          {totalOpen === 0
            ? t("dashboard.allClear")
            : t("dashboard.todoSummary", { count: totalOpen })}
        </p>
        <ul className="grid gap-2 md:grid-cols-2">
          {todoItems.map((item) => (
            <li key={item.to}>
              <Link
                to={item.to}
                className="flex items-center justify-between rounded-lg border border-ink/10 bg-paper px-3 py-2.5 text-sm font-medium text-ink transition-colors hover:border-ink/40 hover:bg-white"
              >
                <span className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${item.dot}`} />
                  {item.label}
                </span>
                <Mono>{item.count}</Mono>
              </Link>
            </li>
          ))}
        </ul>
      </Card>

      <Card title={t("dashboard.shortcutsTitle")}>
        <div className="flex flex-wrap gap-2">
          {shortcuts.map((shortcut) => (
            <Link
              key={shortcut.to}
              to={shortcut.to}
              className={buttonClasses.secondary}
            >
              {shortcut.label}
            </Link>
          ))}
        </div>
      </Card>
    </div>
  );
}
