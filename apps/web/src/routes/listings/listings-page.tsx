import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../../api-client/client";

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

/** Read-only mirror of external Listings (§8.1); content is never edited here. */
export default function ListingsPage() {
  const { t } = useTranslation();
  const listings = useQuery({
    queryKey: ["listings"],
    queryFn: async () => {
      const { data, response } = await api.GET("/api/v1/listings");
      if (!response.ok || !data) throw new Error(`List failed (${response.status})`);
      return data as unknown as ListingRow[];
    },
  });

  return (
    <div>
      <h1 className="text-xl font-semibold">{t("listings.title")}</h1>
      <p className="mt-1 text-sm text-slate-500">{t("listings.intro")}</p>

      <table className="mt-4 w-full border-collapse bg-white text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-slate-500">
            <th className="px-3 py-2 font-medium">{t("listings.listing")}</th>
            <th className="px-3 py-2 font-medium">{t("stores.displayName")}</th>
            <th className="px-3 py-2 font-medium">{t("stores.platform")}</th>
            <th className="px-3 py-2 font-medium">{t("items.status")}</th>
            <th className="px-3 py-2 font-medium">{t("items.variants")}</th>
            <th className="px-3 py-2 font-medium">{t("items.updated")}</th>
          </tr>
        </thead>
        <tbody>
          {listings.isLoading ? (
            <tr><td colSpan={6} className="px-3 py-6 text-slate-400">{t("common.loading")}</td></tr>
          ) : listings.isError ? (
            <tr><td colSpan={6} className="px-3 py-6 text-red-600">{(listings.error as Error).message}</td></tr>
          ) : listings.data && listings.data.length > 0 ? (
            listings.data.map((listing) => (
              <tr key={listing.id} className="border-b border-slate-100">
                <td className="px-3 py-2 font-medium">{listing.title}</td>
                <td className="px-3 py-2">{listing.storeName ?? "—"}</td>
                <td className="px-3 py-2">{listing.platform ?? "—"}</td>
                <td className="px-3 py-2">{listing.status ?? "—"}</td>
                <td className="px-3 py-2">{listing.skuCount}</td>
                <td className="px-3 py-2 text-slate-500">
                  {listing.lastSourceUpdateAt
                    ? new Date(listing.lastSourceUpdateAt).toLocaleString()
                    : "—"}
                </td>
              </tr>
            ))
          ) : (
            <tr><td colSpan={6} className="px-3 py-6 text-slate-400">{t("listings.noListingsFound")}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
