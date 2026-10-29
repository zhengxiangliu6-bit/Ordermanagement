import { CategorySelect } from "./category-select";
import { ImagePreviewButton } from "./image-preview";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "../../components/modal";
import { useNavigate, useRouteLoaderData } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api-client/client";
import { ImageUrlsEditor } from "./image-urls-editor";
import {
  PageHeader,
  Card,
  EmptyState,
  buttonClasses,
  Mono,
} from "../../components/ui";
import type { ItemListResponse } from "../../types/item";
import type { rootLoader } from "../../layouts/root-loader";

export default function ItemsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const root = useRouteLoaderData<typeof rootLoader>("root");
  const permissions = new Set(root?.user.permissions ?? []);
  const canCreate = permissions.has("*") || permissions.has("items:create");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [archived, setArchived] = useState(false);
  const [page, setPage] = useState(1);
  const [newImages, setNewImages] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState("");

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["items", { search, category, archived, page }],
    queryFn: async () => {
      const { data, response } = await api.GET("/api/v1/items", {
        params: {
          query: {
            search: search || undefined,
            category: category || undefined,
            archived: archived || undefined,
            page,
            pageSize: 20,
          },
        },
      });
      if (!response.ok || !data)
        throw new Error(`List failed (${response.status})`);
      return data as ItemListResponse;
    },
  });

  const createItem = async (form: HTMLFormElement) => {
    if (uploadBusy || busy) return;
    const formData = new FormData(form);
    setBusy(true);
    setSaveError("");
    try {
      const { data, response } = await api.POST("/api/v1/items", {
        body: {
          name: String(formData.get("name") ?? "").trim(),
          nameEn: String(formData.get("nameEn") ?? "").trim(),
          images: newImages.map((url) => url.trim()).filter(Boolean),
          description:
            String(formData.get("description") ?? "").trim() || undefined,
          categoryId: String(formData.get("categoryId") ?? "").trim() || null,
        },
      });
      if (!response.ok) {
        setSaveError(t("items.saveFailed", { status: response.status }));
        return;
      }
      if (response.ok && data) {
        setCreating(false);
        setNewImages([]);
        await Promise.all(["items", "item-variants", "review-item-variants", "inventory"].map(key => queryClient.invalidateQueries({ queryKey: [key] })));
        navigate(`/items/${(data as { id: string }).id}`);
      }
    } catch {
      setSaveError(t("items.networkError"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("items.title")}
        actions={
          canCreate ? (
            <button
              type="button"
              onClick={() => {
                setNewImages([]);
                setSaveError("");
                setCreating(true);
              }}
              className={
                creating ? buttonClasses.secondary : buttonClasses.primary
              }
            >
              {creating ? t("common.cancel") : t("items.newItem")}
            </button>
          ) : undefined
        }
      />

      <p className="text-sm text-slate-500">{t("items.subtitle")}</p>
      {creating ? (
        <Modal
          title={t("items.newItem")}
          onClose={() => {
            if (!busy && !uploadBusy) setCreating(false);
          }}
        >
          <form
            className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-[8rem_minmax(0,1fr)]"
            onSubmit={(event) => {
              event.preventDefault();
              void createItem(event.currentTarget);
            }}
          >
            <label htmlFor="item-name" className="self-center font-medium">
              {t("items.name")}
            </label>
            <input
              id="item-name"
              name="name"
              required
              className="rounded-lg border border-ink/20 bg-white px-2 py-1.5"
            />
            <label htmlFor="item-name-en" className="self-center font-medium">
              {t("inventory.nameEnLabel")}
            </label>
            <input
              id="item-name-en"
              name="nameEn"
              className="rounded-lg border border-ink/20 bg-white px-2 py-1.5"
            />
            <label htmlFor="item-images" className="self-center font-medium">
              {t("items.imagesLabel")}
            </label>
            <ImageUrlsEditor
              id="item-images"
              value={newImages}
              onChange={setNewImages}
              disabled={busy}
              onBusyChange={setUploadBusy}
            />
            <label htmlFor="item-category" className="self-center font-medium">
              {t("items.category")}
            </label>
            <CategorySelect id="item-category" />
            <label
              htmlFor="item-description"
              className="self-center font-medium"
            >
              {t("items.description")}
            </label>
            <textarea
              id="item-description"
              name="description"
              rows={2}
              className="rounded-lg border border-ink/20 bg-white px-2 py-1.5"
            />
            {saveError && (
              <p role="alert" className="text-red-600 sm:col-span-2">
                {saveError}
              </p>
            )}
            <div />
            <button
              type="submit"
              disabled={busy || uploadBusy}
              className={`justify-self-start ${buttonClasses.primary}`}
            >
              {t("items.createItem")}
            </button>
          </form>
        </Modal>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <input
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
          placeholder={t("items.searchByName")}
          className="w-64 rounded-lg border border-ink/20 bg-white px-2.5 py-1.5"
        />
        <input
          value={category}
          onChange={(event) => {
            setCategory(event.target.value);
            setPage(1);
          }}
          placeholder={t("items.filterCategory")}
          className="w-56 rounded-lg border border-ink/20 bg-white px-2.5 py-1.5"
        />
        <label className="flex items-center gap-1.5 text-slate-600">
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

      {isLoading ? (
        <Card>
          <p className="text-sm text-slate-400">Loading…</p>
        </Card>
      ) : isError ? (
        <Card>
          <p className="text-sm text-red-600">{(error as Error).message}</p>
        </Card>
      ) : data && data.items.length > 0 ? (
        <Card className="overflow-hidden">
          <div className="-m-4 overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-ink/10 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="w-20 px-4 py-2.5 font-semibold">
                    {t("inventory.imagesTitle")}
                  </th>
                  <th className="px-4 py-2.5 font-semibold">
                    {t("items.name")}
                  </th>
                  <th className="px-3 py-2.5 font-semibold">
                    {t("inventory.nameEnLabel")}
                  </th>
                  <th className="px-3 py-2.5 font-semibold">
                    {t("items.category")}
                  </th>
                  <th className="px-3 py-2.5 font-semibold">
                    {t("items.variants")}
                  </th>
                  <th className="px-3 py-2.5 font-semibold">
                    {t("items.notes")}
                  </th>
                  <th className="px-3 py-2.5 font-semibold">
                    {t("items.updated")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <tr
                    key={item.id}
                    onClick={() => navigate(`/items/${item.id}`)}
                    className="cursor-pointer border-b border-ink/5 transition-colors last:border-0 hover:bg-pill"
                  >
                    <td className="px-4 py-2.5">
                      <ImagePreviewButton
                        images={item.images}
                        name={item.name}
                      />
                    </td>
                    <td className="px-4 py-2.5 font-medium text-ink">
                      {item.name}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">
                      {item.nameEn || "—"}
                    </td>
                    <td className="px-3 py-2.5">{item.category ?? "—"}</td>
                    <td className="px-3 py-2.5">
                      <Mono>{item._count?.variants ?? 0}</Mono>
                    </td>
                    <td className="px-3 py-2.5">
                      <Mono>{item._count?.notes ?? 0}</Mono>
                    </td>
                    <td className="px-3 py-2.5 text-slate-500">
                      {new Date(item.updatedAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <EmptyState message={t("items.emptyItems")} />
      )}

      {data && data.pageCount > 1 ? (
        <div className="mt-3 flex items-center gap-3 text-sm">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((value) => value - 1)}
            className={buttonClasses.secondary}
          >
            {t("common.previous")}
          </button>
          <span>
            {t("common.page", {
              page: data.page,
              pageCount: data.pageCount,
              total: data.total,
            })}
          </span>
          <button
            type="button"
            disabled={page >= data.pageCount}
            onClick={() => setPage((value) => value + 1)}
            className={buttonClasses.secondary}
          >
            {t("common.next")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
