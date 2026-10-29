import { NavLink, Outlet, useLocation, useNavigate, useRouteLoaderData } from "react-router";
import { useTranslation } from "react-i18next";
import { api } from "../api-client/client";
import { setLanguage, SUPPORTED_LANGUAGES } from "../i18n";
import type { SupportedLanguage } from "../i18n";
import type { rootLoader } from "./root-loader";

interface NavItem {
  label: string;
  to?: string;
  /** Permission key required to see this entry (UI convenience only). */
  requires?: string;
  /** Any-of alternative: shown when at least one listed key is granted. */
  requiresAny?: string[];
  /** Search-param value that marks this entry active (for shared pages). */
  matchType?: string;
}

interface NavGroup {
  label: string;
  requires?: string;
  items: NavItem[];
}

// Navigation follows the provisional UI overview (non-normative).
// Entries with `to` are implemented; the rest stay placeholders that
// arrive in later milestones. `requires` hides entries the signed-in
// user has no permission for — the backend remains the authorization
// boundary either way.
function useNavGroups(): NavGroup[] {
  const { t } = useTranslation();
  return [
    {
      label: t("nav.orders"),
      requires: "orders:read",
      items: [
        { label: t("nav.allOrders"), to: "/orders" },
        { label: t("nav.archived") },
        { label: t("nav.trash") },
      ],
    },
    {
      label: t("nav.reviewCenter"),
      items: [
        {
          label: t("nav.newOrders"),
          to: "/review?type=new_order",
          matchType: "new_order",
          requires: "orders:review",
        },
        {
          label: t("nav.problemItems"),
          to: "/review/problems",
          requires: "shipping:issue-review",
        },
      ],
    },
    {
      label: t("nav.shipments"),
      requires: "shipping:read",
      items: [
        { label: t("nav.packingQueue"), to: "/shipping-work/packing", matchType: "packing", requires: "shipping:weigh" },
        { label: t("nav.orderingQueue"), to: "/shipping-work/ordering", matchType: "ordering", requires: "shipping:backfill" },
        { label: t("nav.inspectionQueue"), to: "/shipping-work/inspection", matchType: "inspection", requires: "shipping:inspect" },
        { label: t("nav.tailQueue"), to: "/shipping-work/tail", matchType: "tail", requires: "shipping:tail" },
        { label: t("nav.needsAttentionQueue"), to: "/shipping-work/needs-attention", matchType: "needs_attention", requires: "shipping:issue-review" },
        { label: t("nav.carriers"), to: "/carriers", requires: "carrier-providers:read" },
      ],
    },
    {
      label: t("nav.inventoryGroup"),
      items: [
        {
          label: t("nav.inventoryChina"),
          to: "/inventory/china",
          requiresAny: ["inventory:read", "inventory:china:read"],
        },
        {
          label: t("nav.inventoryCanada"),
          to: "/inventory/canada",
          requiresAny: ["inventory:read", "inventory:canada:read"],
        },
      ],
    },
    {
      label: t("nav.catalog"),
      requires: "items:read",
      items: [
        { label: t("nav.items"), to: "/items", requires: "items:read" },
        { label: t("nav.listingsCatalog"), to: "/listings", requires: "listings:read" },
        { label: t("nav.itemMapping"), to: "/mapping", requires: "mapping:read" },
      ],
    },
    {
      label: t("nav.system"),
      items: [
        { label: t("nav.stores"), to: "/stores", requires: "stores:read" },
        { label: t("nav.usersAndRoles"), to: "/users", requires: "users:read" },
        { label: t("nav.auditHistory"), to: "/audit", requires: "audit:read" },
        {
          label: t("nav.outboundPolicies"),
          to: "/settings/shipping",
          requires: "shipping:read",
        },
        { label: t("nav.settings"), requires: "review-settings:read" },
        { label: t("nav.categories"), to: "/settings/categories", requires: "categories:read" },
        {
          label: t("nav.shippingRegions"),
          to: "/settings/shipping-regions",
          requires: "shipping:manage-settings",
        },
      ],
    },
  ];
}

/** Ink sidebar with the locked brand red as the active stamp. */
const ACTIVE_CLASSES = "bg-brand font-medium text-white";
const INACTIVE_CLASSES = "text-white/70 hover:bg-white/10 hover:text-white";

export function RootLayout() {
  const data = useRouteLoaderData<typeof rootLoader>("root");
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const permissions = new Set(data?.user.permissions ?? []);
  const navGroups = useNavGroups();

  const signOut = async () => {
    await api.POST("/api/v1/auth/logout");
    navigate("/login", { replace: true });
  };

  const switchLanguage = (language: string) => {
    setLanguage(language as SupportedLanguage);
  };

  return (
    <div className="flex h-screen flex-col bg-slate-50 text-slate-900">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-ink/10 bg-white px-4">
        <div className="flex items-baseline gap-1.5">
          <span className="font-display text-lg tracking-wide text-ink">
            ATTAKY
          </span>
          <span className="text-xs font-medium uppercase tracking-widest text-brand">
            OM
          </span>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <select
            value={i18n.language.startsWith("zh") ? "zh" : "en"}
            onChange={(event) => switchLanguage(event.target.value)}
            className="rounded border border-slate-300 px-1.5 py-0.5"
            aria-label="Language"
          >
            {SUPPORTED_LANGUAGES.map((language) => (
              <option key={language.code} value={language.code}>
                {language.label}
              </option>
            ))}
          </select>
          <span className="text-slate-600">{data?.user.displayName}</span>
          <button
            type="button"
            onClick={signOut}
            className="rounded border border-slate-300 px-2.5 py-1 hover:bg-slate-100"
          >
            {t("common.signOut")}
          </button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <nav className="w-60 shrink-0 overflow-y-auto bg-ink px-3 py-4">
          <SidebarLink to="/" label={t("nav.dashboard")} />
          {navGroups
            .filter((group) => !group.requires || permissions.has(group.requires))
            .map((group) => {
              const items = group.items.filter(
                (item) =>
                  (!item.requires || permissions.has(item.requires)) &&
                  (!item.requiresAny ||
                    item.requiresAny.some((key) => permissions.has(key))),
              );
              if (items.length === 0) return null;
              return (
                <div key={group.label} className="mt-4">
                  <div className="px-2 text-xs font-semibold uppercase tracking-wider text-white/40">
                    {group.label}
                  </div>
                  <ul className="mt-1">
                    {items.map((item) => (
                      <li key={item.label}>
                        {item.to ? (
                          <NavItemLink
                            to={item.to}
                            label={item.label}
                            matchType={item.matchType}
                          />
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
        </nav>
        <main className="min-w-0 flex-1 overflow-y-auto p-6">
          <div className="mx-auto max-w-[1600px]">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

function isNavItemActive(
  location: { pathname: string; search: string },
  item: NavItem,
): boolean {
  if (!item.to) return false;
  const [path, query = ""] = item.to.split("?");
  if (item.matchType) {
    // Shared-page entries are active only for their own tab, e.g.
    // /review?type=new_order vs /review?type=listing. The compared param
    // name comes from the entry's own target (type for review, view for
    // shipments).
    if (location.pathname !== path) return false;
    const paramName = new URLSearchParams(query).keys().next().value ?? "type";
    return (
      new URLSearchParams(location.search).get(paramName) === item.matchType
    );
  }
  return location.pathname === item.to;
}



function NavItemLink({
  to,
  label,
  matchType,
}: {
  to: string;
  label: string;
  matchType?: string;
}) {
  const location = useLocation();
  const active = isNavItemActive(location, { to, label, matchType });
  return (
    <NavLink
      to={to}
      className={`block rounded px-2 py-1 text-sm ${active ? ACTIVE_CLASSES : INACTIVE_CLASSES}`}
    >
      {label}
    </NavLink>
  );
}

function SidebarLink({ to, label }: { to: string; label: string }) {
  return (
    <NavLink
      to={to}
      end
      className={({ isActive }) =>
        `block rounded px-2 py-1 text-sm ${isActive ? ACTIVE_CLASSES : INACTIVE_CLASSES}`
      }
    >
      {label}
    </NavLink>
  );
}
