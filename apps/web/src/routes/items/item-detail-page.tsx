import { CategorySelect } from "./category-select";
import { useState } from "react";
import { useParams, useRouteLoaderData } from "react-router";
import { useTranslation } from "react-i18next";
import { Modal } from "../../components/modal";
import { ItemImages } from "./item-images";
import { VariantsSection } from "./variants-section";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api-client/client";
import { ImageUrlsEditor, imageUrls } from "./image-urls-editor";
import type { Item } from "../../types/item";
import type { rootLoader } from "../../layouts/root-loader";

function usePermissions(): Set<string> {
  const root = useRouteLoaderData<typeof rootLoader>("root");
  const permissions = new Set(root?.user.permissions ?? []);
  if (permissions.has("*"))
    for (const permission of [
      "items:create",
      "items:update",
      "items:archive",
      "items:delete",
      "notes:create",
      "notes:edit-own",
      "notes:edit-all",
      "notes:delete",
    ])
      permissions.add(permission);
  return permissions;
}

export default function ItemDetailPage() {
  return <ItemDetailContent />;
}

function ItemDetailContent() {
  const { id = "" } = useParams();
  const permissions = usePermissions();
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  const {
    data: item,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ["item", id],
    queryFn: async () => {
      const { data, response } = await api.GET("/api/v1/items/{id}", {
        params: { path: { id } },
      });
      if (!response.ok || !data)
        throw new Error(`Load failed (${response.status})`);
      return data as unknown as Item;
    },
  });

  const refresh = async () => {
    await Promise.all(["item", "items", "item-variants", "review-item-variants", "inventory", "review", "order", "orders"].map(key => queryClient.invalidateQueries({ queryKey: [key] })));
  };

  if (isLoading)
    return <p className="text-sm text-slate-400">{t("common.loading")}</p>;
  if (isError)
    return <p className="text-sm text-red-600">{(error as Error).message}</p>;
  if (!item) return null;

  return (
    <div>
      <ItemHeader item={item} onChanged={refresh} />
      <ItemImages images={item.images} name={item.name} />
      <VariantsSection
        item={item}
        permissions={permissions}
        onChanged={refresh}
      />
      <NotesSection item={item} onChanged={refresh} />
    </div>
  );
}

function ItemHeader({
  item,
  onChanged,
}: {
  item: Item;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const permissions = usePermissions();
  const canUpdate = permissions.has("items:update");
  const canArchive = permissions.has("items:archive");
  const canDelete = permissions.has("items:delete");
  const [uploadBusy, setUploadBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [editImages, setEditImages] = useState<string[]>([]);

  const openEdit = () => {
    setSaveError("");
    setEditImages(imageUrls(item.images));
    setEditing(true);
  };

  const save = async (form: HTMLFormElement) => {
    if (uploadBusy || busy) return;
    const formData = new FormData(form);
    setBusy(true);
    setSaveError("");
    try {
      const { response } = await api.PATCH("/api/v1/items/{id}", {
        params: { path: { id: item.id } },
        body: {
          name: String(formData.get("name") ?? "").trim() || undefined,
          nameEn: String(formData.get("nameEn") ?? "").trim(),
          categoryId: String(formData.get("categoryId") ?? "").trim() || null,
          description:
            String(formData.get("description") ?? "").trim(),
          images: editImages.map((url) => url.trim()).filter(Boolean),
        },
      });
      if (!response.ok) {
        setSaveError(t("items.saveFailed", { status: response.status }));
        return;
      }
      setEditing(false);
      onChanged();
    } catch {
      setSaveError(t("items.networkError"));
    } finally {
      setBusy(false);
    }
  };

  const toggleArchive = async () => {
    setBusy(true);
    if (item.archivedAt) {
      await api.POST("/api/v1/items/{id}/restore", {
        params: { path: { id: item.id } },
      });
    } else {
      await api.POST("/api/v1/items/{id}/archive", {
        params: { path: { id: item.id } },
      });
    }
    setBusy(false);
    onChanged();
  };

  const remove = async () => {
    if (!window.confirm(t("items.deleteItemConfirm", { name: item.name })))
      return;
    setBusy(true);
    await api.DELETE("/api/v1/items/{id}", {
      params: { path: { id: item.id } },
    });
    window.location.href = "/items";
  };

  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex items-start gap-3">
        <div>
          <h1 className="font-display text-2xl leading-tight text-ink">
            {item.name}
            {item.nameEn && item.nameEn !== item.name ? (
              <span className="ml-2 text-base font-normal text-slate-400">
                · {item.nameEn}
              </span>
            ) : null}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {item.category ?? "—"}
            {item.archivedAt ? (
              <span className="ml-2 whitespace-nowrap rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                {t("common.archived")}
              </span>
            ) : null}
          </p>
          {item.description && (
            <p className="mt-3 max-w-3xl whitespace-pre-wrap text-sm text-slate-600">
              {item.description}
            </p>
          )}
        </div>
      </div>
      <div className="flex gap-2 text-sm">
        {canUpdate ? (
          <button
            type="button"
            onClick={() => (editing ? setEditing(false) : openEdit())}
            className="rounded-lg border border-ink/20 px-2.5 py-1 hover:bg-pill"
          >
            {editing ? t("common.cancel") : t("items.edit")}
          </button>
        ) : null}
        {item.archivedAt ? (
          canUpdate ? (
            <button
              type="button"
              disabled={busy}
              onClick={toggleArchive}
              className="rounded-lg border border-ink/20 px-2.5 py-1 hover:bg-pill disabled:opacity-40"
            >
              {t("items.restore")}
            </button>
          ) : null
        ) : canArchive ? (
          <button
            type="button"
            disabled={busy}
            onClick={toggleArchive}
            className="rounded-lg border border-ink/20 px-2.5 py-1 hover:bg-pill disabled:opacity-40"
          >
            {t("items.archiveLabel")}
          </button>
        ) : null}
        {canDelete ? (
          <button
            type="button"
            disabled={busy}
            onClick={remove}
            className="rounded border border-red-300 px-2.5 py-1 text-red-700 hover:bg-red-50 disabled:opacity-40"
          >
            {t("common.delete")}
          </button>
        ) : null}
      </div>
      {editing ? (
        <Modal
          title={t("items.edit")}
          onClose={() => {
            if (!busy && !uploadBusy) setEditing(false);
          }}
        >
          <form
            className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-[7rem_minmax(0,1fr)]"
            onSubmit={(event) => {
              event.preventDefault();
              void save(event.currentTarget);
            }}
          >
            <label htmlFor="edit-name" className="self-center font-medium">
              {t("items.name")}
            </label>
            <input
              id="edit-name"
              name="name"
              defaultValue={item.name}
              required
              className="rounded-lg border border-ink/20 bg-white px-2 py-1.5"
            />
            <label htmlFor="edit-name-en" className="self-center font-medium">
              {t("inventory.nameEnLabel")}
            </label>
            <input
              id="edit-name-en"
              name="nameEn"
              defaultValue={item.nameEn ?? ""}
              className="rounded-lg border border-ink/20 bg-white px-2 py-1.5"
            />
            <label htmlFor="edit-images" className="self-center font-medium">
              {t("items.imagesLabel")}
            </label>
            <ImageUrlsEditor
              id="edit-images"
              value={editImages}
              onChange={setEditImages}
              disabled={busy}
              onBusyChange={setUploadBusy}
            />
            <label htmlFor="edit-category" className="self-center font-medium">
              {t("items.category")}
            </label>
            <CategorySelect id="edit-category" defaultValue={item.categoryId} />
            <label
              htmlFor="edit-description"
              className="self-center font-medium"
            >
              {t("items.description")}
            </label>
            <textarea
              id="edit-description"
              name="description"
              rows={3}
              defaultValue={item.description ?? ""}
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
              className="justify-self-start rounded bg-slate-900 px-3 py-1.5 text-white disabled:opacity-40"
            >
              {t("items.saveChanges")}
            </button>
          </form>
        </Modal>
      ) : null}
    </div>
  );
}

function NotesSection({
  item,
  onChanged,
}: {
  item: Item;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const permissions = usePermissions();
  const canCreate = permissions.has("notes:create");
  const canEdit =
    permissions.has("notes:edit-own") || permissions.has("notes:edit-all");
  const canDelete = permissions.has("notes:delete");
  const [body, setBody] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);

  const add = async () => {
    if (!body.trim()) return;
    setBusy(true);
    setNoteError(null);
    const { response } = await api.POST("/api/v1/items/{id}/notes", {
      params: { path: { id: item.id } },
      body: { body: body.trim() },
    });
    setBusy(false);
    if (!response.ok) {
      setNoteError(t("items.noteAddFailed", { status: response.status }));
      return;
    }
    setBody("");
    onChanged();
  };

  const saveEdit = async (noteId: string) => {
    if (!editBody.trim()) return;
    setBusy(true);
    setNoteError(null);
    const { response } = await api.PATCH("/api/v1/notes/{id}", {
      params: { path: { id: noteId } },
      body: { body: editBody.trim() },
    });
    setBusy(false);
    if (!response.ok) {
      setNoteError(t("items.noteEditFailed", { status: response.status }));
      return;
    }
    setEditingId(null);
    onChanged();
  };

  const remove = async (noteId: string) => {
    if (!window.confirm(t("items.deleteNoteConfirm"))) return;
    setBusy(true);
    setNoteError(null);
    const { response } = await api.DELETE("/api/v1/notes/{id}", {
      params: { path: { id: noteId } },
    });
    setBusy(false);
    if (!response.ok) {
      setNoteError(t("items.noteDeleteFailed", { status: response.status }));
      return;
    }
    onChanged();
  };

  return (
    <section className="mt-8">
      <h2 className="text-base font-semibold">{t("items.notes")}</h2>
      {noteError ? (
        <p className="mt-1 text-sm text-red-600" role="alert">
          {noteError}
        </p>
      ) : null}
      {canCreate ? (
        <div className="mt-2 flex items-end gap-3">
          <div className="flex-1">
            <label htmlFor="new-note" className="block text-sm font-medium">
              {t("items.addNote")}
            </label>
            <textarea
              id="new-note"
              rows={2}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              className="mt-1 w-full rounded-lg border border-ink/20 px-2 py-1 text-sm"
            />
          </div>
          <button
            type="button"
            disabled={busy || !body.trim()}
            onClick={add}
            className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-40"
          >
            {t("items.addNoteButton")}
          </button>
        </div>
      ) : null}
      <ul className="mt-3 space-y-3">
        {(item.notes ?? []).map((note) => (
          <li
            key={note.id}
            className="rounded border border-slate-200 bg-white p-3 text-sm"
          >
            {editingId === note.id ? (
              <div>
                <textarea
                  rows={2}
                  value={editBody}
                  onChange={(event) => setEditBody(event.target.value)}
                  className="w-full rounded-lg border border-ink/20 bg-white px-2 py-1.5"
                />
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => saveEdit(note.id)}
                    className="rounded bg-slate-900 px-2.5 py-1 text-white disabled:opacity-40"
                  >
                    {t("common.save")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    className="rounded-lg border border-ink/20 px-2.5 py-1"
                  >
                    {t("common.cancel")}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <p>{note.body}</p>
                <div className="mt-1 flex items-center justify-between text-xs text-slate-400">
                  <span>
                    {t("items.by")} {note.createdByUser?.name ?? note.createdBy}{" "}
                    · {new Date(note.createdAt).toLocaleString()}
                    {note.revisions && note.revisions.length > 0
                      ? ` · ${t("items.editedTimes", { count: note.revisions.length })}`
                      : ""}
                  </span>
                  <span className="flex gap-3">
                    {canEdit ? (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(note.id);
                          setEditBody(note.body);
                        }}
                        className="hover:text-slate-700"
                      >
                        {t("common.edit")}
                      </button>
                    ) : null}
                    {canDelete ? (
                      <button
                        type="button"
                        onClick={() => remove(note.id)}
                        className="hover:text-red-600"
                      >
                        {t("common.delete")}
                      </button>
                    ) : null}
                  </span>
                </div>
              </>
            )}
          </li>
        ))}
        {!item.notes || item.notes.length === 0 ? (
          <li className="text-sm text-slate-400">{t("items.noNotesYet")}</li>
        ) : null}
      </ul>
    </section>
  );
}
