import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../../api-client/client";
import { PageHeader, Card, Badge, EmptyState, buttonClasses } from "../../components/ui";

interface CategoryRow {
  id: string;
  name: string;
  trackingUrlTemplate: string | null;
  enabled: boolean;
  sortOrder: number;
}

export default function CategoriesPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", trackingUrlTemplate: "", sortOrder: 0 });

  const categories = useQuery({
    queryKey: ["categories"],
    queryFn: async () => {
      const { data, response } = await api.GET("/api/v1/categories");
      if (!response.ok || !data) throw new Error(`List failed (${response.status})`);
      return data as unknown as CategoryRow[];
    },
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["categories"] });

  const save = async () => {
    setError(null);
    if (!form.name.trim()) return;
    const body = {
      name: form.name.trim(),
      trackingUrlTemplate: form.trackingUrlTemplate.trim() || null,
      sortOrder: form.sortOrder,
    };
    if (editingId) {
      const { response: res } = await api.PATCH("/api/v1/categories/{id}", {
        params: { path: { id: editingId } },
        body: body as never,
      });
      if (!res.ok) {
        setError(t("categories.saveFailed", { status: res.status }));
        return;
      }
    } else {
      const { response: res } = await api.POST("/api/v1/categories", {
        body: body as never,
      });
      if (!res.ok) {
        setError(t("categories.saveFailed", { status: res.status }));
        return;
      }
    }
    setCreating(false);
    setEditingId(null);
    setForm({ name: "", trackingUrlTemplate: "", sortOrder: 0 });
    await refresh();
  };

  const toggleEnabled = async (category: CategoryRow) => {
    await api.PATCH("/api/v1/categories/{id}", {
      params: { path: { id: category.id } },
      body: { enabled: !category.enabled } as never,
    });
    await refresh();
  };

  const remove = async (category: CategoryRow) => {
    if (!window.confirm(t("categories.deleteConfirm", { name: category.name }))) return;
    const { data, response } = await api.DELETE("/api/v1/categories/{id}", {
      params: { path: { id: category.id } },
    });
    if (!response.ok) {
      const detail = (data as unknown as { message?: string })?.message;
      window.alert(detail ?? t("categories.deleteFailed", { status: response.status }));
      return;
    }
    const result = data as unknown as { disabled?: boolean };
    if (result?.disabled) {
      window.alert(t("categories.disabledInstead", { name: category.name }));
    }
    await refresh();
  };

  const startEdit = (category: CategoryRow) => {
    setEditingId(category.id);
    setCreating(false);
    setForm({
      name: category.name,
      trackingUrlTemplate: category.trackingUrlTemplate ?? "",
      sortOrder: category.sortOrder,
    });
  };

  const startCreate = () => {
    setCreating(true);
    setEditingId(null);
    setForm({ name: "", trackingUrlTemplate: "", sortOrder: (categories.data?.length ?? 0) + 1 });
  };

  const showForm = creating || editingId !== null;

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("categories.title")}
        description={t("categories.intro")}
        actions={
          <button
            type="button"
            onClick={showForm ? () => { setCreating(false); setEditingId(null); } : startCreate}
            className={showForm ? buttonClasses.secondary : buttonClasses.primary}
          >
            {showForm ? t("common.cancel") : t("categories.newCategory")}
          </button>
        }
      />

      {error ? <p className="text-sm text-red-600" role="alert">{error}</p> : null}

      {showForm ? (
        <Card title={editingId ? t("categories.editCategory") : t("categories.newCategory")}>
          <div className="grid gap-3 text-sm md:grid-cols-3">
            <div>
              <label className="block text-xs font-medium text-slate-500">
                {t("categories.name")}
              </label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Beartech"
                className="mt-1 w-full rounded-lg border border-ink/20 bg-white px-2 py-1.5"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500">
                {t("categories.trackingTemplate")}
              </label>
              <input
                value={form.trackingUrlTemplate}
                onChange={(e) => setForm({ ...form, trackingUrlTemplate: e.target.value })}
                placeholder="https://track.beartech.com/{number}"
                className="mt-1 w-full rounded-lg border border-ink/20 bg-white px-2 py-1.5 font-mono text-xs"
              />
              <p className="mt-0.5 text-xs text-slate-400">{t("categories.templateHint")}</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500">
                {t("categories.sortOrder")}
              </label>
              <input
                type="number"
                value={form.sortOrder}
                onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) })}
                className="mt-1 w-20 rounded-lg border border-ink/20 bg-white px-2 py-1.5"
              />
            </div>
          </div>
          <div className="mt-3 flex justify-end">
            <button type="button" onClick={() => void save()} className={buttonClasses.primary}>
              {t("common.save")}
            </button>
          </div>
        </Card>
      ) : null}

      {categories.isLoading ? (
        <Card><p className="text-sm text-slate-400">{t("common.loading")}</p></Card>
      ) : categories.data && categories.data.length > 0 ? (
        <Card className="overflow-hidden">
          <div className="-m-4 overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-ink/10 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="px-4 py-2.5 font-semibold">{t("categories.name")}</th>
                  <th className="px-3 py-2.5 font-semibold">{t("categories.trackingTemplate")}</th>
                  <th className="px-3 py-2.5 font-semibold">{t("categories.sortOrder")}</th>
                  <th className="px-3 py-2.5 font-semibold">{t("items.status")}</th>
                  <th className="px-3 py-2.5 font-semibold"></th>
                </tr>
              </thead>
              <tbody>
                {categories.data.map((category) => (
                  <tr key={category.id} className="border-b border-ink/5 transition-colors last:border-0 hover:bg-pill">
                    <td className="px-4 py-2.5 font-medium text-ink">{category.name}</td>
                    <td className="px-3 py-2.5 font-mono text-xs text-slate-500">
                      {category.trackingUrlTemplate ?? "—"}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs">{category.sortOrder}</td>
                    <td className="px-3 py-2.5">
                      <button type="button" onClick={() => void toggleEnabled(category)}>
                        <Badge tone={category.enabled ? "success" : "neutral"}>
                          {category.enabled ? t("common.active") : t("common.disabled")}
                        </Badge>
                      </button>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <span className="flex justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => startEdit(category)}
                          className={buttonClasses.ghost}
                        >
                          {t("common.edit")}
                        </button>
                        <button
                          type="button"
                          onClick={() => void remove(category)}
                          className={buttonClasses.danger}
                        >
                          {t("common.delete")}
                        </button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <EmptyState message={t("categories.empty")} />
      )}
    </div>
  );
}
