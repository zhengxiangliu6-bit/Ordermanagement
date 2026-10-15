import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "../../components/modal";
import { useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api-client/client";
import type { ItemListResponse } from "../../types/item";

export default function ItemsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [archived, setArchived] = useState(false);
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["items", { search, category, archived, page }],
    queryFn: async () => {
      const { data, response } = await api.GET("/api/v1/items", {
        params: { query: { search: search || undefined, archived: archived || undefined, page, pageSize: 20 } },
      });
      if (!response.ok || !data) throw new Error(`List failed (${response.status})`);
      return data as ItemListResponse;
    },
  });

  const createItem = async (form: HTMLFormElement) => {
    const formData = new FormData(form);
    const { data, response } = await api.POST("/api/v1/items", {
      body: {
        name: String(formData.get("name") ?? "").trim(),
        description: String(formData.get("description") ?? "").trim() || undefined,
        category: String(formData.get("category") ?? "").trim() || undefined,
      },
    });
    if (response.ok && data) {
      setCreating(false);
      await queryClient.invalidateQueries({ queryKey: ["items"] });
      navigate(`/items/${(data as { id: string }).id}`);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t("items.title")}</h1>
        <button
          type="button"
          onClick={() => setCreating((value) => !value)}
          className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
        >
          {creating ? t("common.cancel") : t("items.newItem")}
        </button>
      </div>

      {creating ? (
        <Modal title={t("items.newItem")} onClose={() => setCreating(false)}>
        <form
          className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-2 text-sm"
          onSubmit={(event) => {
            event.preventDefault();
            void createItem(event.currentTarget);
          }}
        >
          <label htmlFor="item-name" className="self-center font-medium">
            {t("items.name")}
          </label>
          <input id="item-name" name="name" required className="rounded border border-slate-300 px-2 py-1" />
          <label htmlFor="item-category" className="self-center font-medium">
            {t("items.category")}
          </label>
          <input id="item-category" name="category" className="rounded border border-slate-300 px-2 py-1" />
          <label htmlFor="item-description" className="self-center font-medium">
            {t("items.description")}
          </label>
          <textarea id="item-description" name="description" rows={2} className="rounded border border-slate-300 px-2 py-1" />
          <div />
          <button type="submit" className="justify-self-start rounded bg-slate-700 px-3 py-1.5 text-white hover:bg-slate-600">
            {t("items.createItem")}
          </button>
        </form>
        </Modal>
      ) : null}

      <div className="mt-4 flex items-center gap-4 text-sm">
        <input
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
          placeholder={t("items.searchByName")}
          className="w-64 rounded border border-slate-300 px-2 py-1"
        />
        <input
          value={category}
          onChange={(event) => {
            setCategory(event.target.value);
            setPage(1);
          }}
          placeholder="Filter by category…"
          className="w-56 rounded border border-slate-300 px-2 py-1"
        />
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={archived}
            onChange={(event) => {
              setArchived(event.target.checked);
              setPage(1);
            }}
          />
          {t("items.showArchived")}
        </label>
      </div>

      <table className="mt-3 w-full border-collapse bg-white text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-slate-500">
            <th className="px-3 py-2 font-medium">{t("items.name")}</th>
            <th className="px-3 py-2 font-medium">{t("items.category")}</th>
            <th className="px-3 py-2 font-medium">{t("items.variants")}</th>
            <th className="px-3 py-2 font-medium">{t("items.notes")}</th>
            <th className="px-3 py-2 font-medium">{t("items.updated")}</th>
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            <tr>
              <td colSpan={5} className="px-3 py-6 text-slate-400">
                Loading…
              </td>
            </tr>
          ) : isError ? (
            <tr>
              <td colSpan={5} className="px-3 py-6 text-red-600">
                {(error as Error).message}
              </td>
            </tr>
          ) : data && data.items.length > 0 ? (
            data.items.map((item) => (
              <tr
                key={item.id}
                onClick={() => navigate(`/items/${item.id}`)}
                className="cursor-pointer border-b border-slate-100 hover:bg-slate-50"
              >
                <td className="px-3 py-2 font-medium">{item.name}</td>
                <td className="px-3 py-2">{item.category ?? "—"}</td>
                <td className="px-3 py-2">{item._count?.variants ?? 0}</td>
                <td className="px-3 py-2">{item._count?.notes ?? 0}</td>
                <td className="px-3 py-2 text-slate-500">
                  {new Date(item.updatedAt).toLocaleString()}
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={5} className="px-3 py-6 text-slate-400">
                No items found.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {data && data.pageCount > 1 ? (
        <div className="mt-3 flex items-center gap-3 text-sm">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((value) => value - 1)}
            className="rounded border border-slate-300 px-2 py-1 disabled:opacity-40"
          >
            {t("common.previous")}
          </button>
          <span>
            {t("common.page", { page: data.page, pageCount: data.pageCount, total: data.total })}
          </span>
          <button
            type="button"
            disabled={page >= data.pageCount}
            onClick={() => setPage((value) => value + 1)}
            className="rounded border border-slate-300 px-2 py-1 disabled:opacity-40"
          >
            {t("common.next")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
