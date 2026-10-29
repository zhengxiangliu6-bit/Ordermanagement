import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../../api-client/client";
import { PageHeader, Card, Badge, EmptyState } from "../../components/ui";

interface ListingRow {
  id: string;
  storeName: string | null;
  platform: string | null;
  externalListingId: string;
  status: string | null;
  title: string;
  skuCount: number;
  noteCount: number;
  lastSourceUpdateAt: string | null;
}

interface StoreOption {
  id: string;
  displayName: string;
  platform: string;
}

/** Read-only mirror of external Listings (§8.1); content is never edited here. */
interface ListingVariantDetail {
  id: string;
  externalVariantId: string;
  externalTitle: string | null;
  externalSku: string | null;
  optionValues: Record<string, unknown> | null;
}

function VariantDetails({ listingId }: { listingId: string }) {
  const { t } = useTranslation();
  const detail = useQuery({
    queryKey: ["listing-detail", listingId],
    queryFn: async () => {
      const { data, response } = await api.GET("/api/v1/listings/{id}", {
        params: { path: { id: listingId } },
      });
      if (!response.ok || !data) throw new Error(`${response.status}`);
      return data as unknown as { variants: ListingVariantDetail[] };
    },
  });
  if (detail.isLoading) return <span className="text-xs text-slate-400">{t("common.loading")}</span>;
  if (detail.isError) return <span className="text-xs text-red-600">{(detail.error as Error).message}</span>;
  return (
    <table className="w-full border-collapse text-xs">
      <thead>
        <tr className="border-b border-ink/10 text-left uppercase tracking-wide text-slate-400">
          <th className="px-2 py-1 font-medium">{t("items.variantName")}</th>
          <th className="px-2 py-1 font-medium">SKU</th>
          <th className="px-2 py-1 font-medium">{t("items.optionValues")}</th>
          <th className="px-2 py-1 font-medium">ID</th>
        </tr>
      </thead>
      <tbody>
        {(detail.data?.variants ?? []).map((variant) => (
          <tr key={variant.id} className="border-b border-slate-50">
            <td className="px-2 py-1">{variant.externalTitle ?? "—"}</td>
            <td className="px-2 py-1 font-mono">{variant.externalSku ?? "—"}</td>
            <td className="px-2 py-1 text-slate-500">
              {variant.optionValues
                ? Object.entries(variant.optionValues)
                    .map(([key, value]) => `${key}: ${String(value)}`)
                    .join(" · ") || "—"
                : "—"}
            </td>
            <td className="px-2 py-1 font-mono text-slate-400">{variant.externalVariantId}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function ListingsPage() {
  const { t } = useTranslation();
  const [storeId, setStoreId] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const stores = useQuery({
    queryKey: ["stores"],
    queryFn: async () => {
      const { data, response } = await api.GET("/api/v1/stores");
      if (!response.ok || !data) return [] as StoreOption[];
      return data as unknown as StoreOption[];
    },
  });

  const listings = useQuery({
    queryKey: ["listings", storeId],
    queryFn: async () => {
      const { data, response } = await api.GET("/api/v1/listings", {
        params: { query: { storeId: storeId || undefined } },
      });
      if (!response.ok || !data) throw new Error(`List failed (${response.status})`);
      return data as unknown as ListingRow[];
    },
  });

  return (
    <div className="space-y-4">
      <PageHeader title={t("listings.title")} description={t("listings.intro")} />

      <div className="flex items-center gap-3 text-sm">
        <select
          value={storeId}
          onChange={(event) => setStoreId(event.target.value)}
          className="rounded-lg border border-ink/20 bg-white px-2 py-1.5"
          aria-label={t("review.allStores")}
        >
          <option value="">{t("review.allStores")}</option>
          {(stores.data ?? []).map((store) => (
            <option key={store.id} value={store.id}>
              {store.displayName} · {store.platform}
            </option>
          ))}
        </select>
      </div>

      {listings.isLoading ? (
        <Card><p className="text-sm text-slate-400">{t("common.loading")}</p></Card>
      ) : listings.isError ? (
        <Card><p className="text-sm text-red-600">{(listings.error as Error).message}</p></Card>
      ) : listings.data && listings.data.length > 0 ? (
        <Card className="overflow-hidden">
          <div className="-m-4 overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-ink/10 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="px-4 py-2.5 font-semibold">{t("listings.listing")}</th>
                  <th className="px-3 py-2.5 font-semibold">{t("stores.displayName")}</th>
                  <th className="px-3 py-2.5 font-semibold">{t("stores.platform")}</th>
                  <th className="px-3 py-2.5 font-semibold">{t("items.status")}</th>
                  <th className="px-3 py-2.5 font-semibold">{t("items.variants")}</th>
                  <th className="px-3 py-2.5 font-semibold">{t("items.updated")}</th>
                </tr>
              </thead>
              <tbody>
              {listings.data.flatMap((listing) => [
              <tr
                key={listing.id}
                onClick={() =>
                  setExpandedId(expandedId === listing.id ? null : listing.id)
                }
                className="cursor-pointer border-b border-ink/5 transition-colors last:border-0 hover:bg-pill"
              >
                <td className="px-4 py-2.5 font-medium text-ink">
                  <span className="mr-1 text-slate-400">{expandedId === listing.id ? "▾" : "▸"}</span>
                  {listing.title}
                </td>
                <td className="px-3 py-2.5">{listing.storeName ?? "—"}</td>
                <td className="px-3 py-2.5">{listing.platform ?? "—"}</td>
                <td className="px-3 py-2.5">
                  <Badge tone={listing.status === "active" ? "success" : "neutral"}>
                    {listing.status ?? "—"}
                  </Badge>
                </td>
                <td className="px-3 py-2.5 font-mono text-[13px]">{listing.skuCount}</td>
                <td className="px-3 py-2.5 text-slate-500">
                  {listing.lastSourceUpdateAt
                    ? new Date(listing.lastSourceUpdateAt).toLocaleString()
                    : "—"}
                </td>
              </tr>,
              expandedId === listing.id ? (
                <tr key={`${listing.id}-detail`} className="border-b border-ink/5">
                  <td colSpan={6} className="bg-pill px-4 py-2.5">
                    <VariantDetails listingId={listing.id} />
                  </td>
                </tr>
              ) : null,
            ])}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <EmptyState message={t("listings.noListingsFound")} />
      )}
    </div>
  );
}
