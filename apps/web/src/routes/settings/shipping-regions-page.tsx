import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../../api-client/client";
import { PageHeader, Card, Badge, EmptyState, buttonClasses } from "../../components/ui";

interface ShippingRegionRow {
  id: string;
  name: string;
  enabled: boolean;
  sortOrder: number;
}

/** Configurable shipping regions used at unfulfilled-order review (M7 follow-up). */
export default function ShippingRegionsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", sortOrder: 0 });

  const methods = useQuery({
    queryKey: ["shipping-regions"],
    queryFn: async () => {
      const { data, response } = await api.GET("/api/v1/shipping-regions");
      if (!response.ok || !data) throw new Error(`List failed (${response.status})`);
      return data as unknown as ShippingRegionRow[];
    },
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["shipping-regions"] });

  const save = async () => {
    setError(null);
    if (!form.name.trim()) return;
    const body = { name: form.name.trim(), sortOrder: form.sortOrder };
    if (editingId) {
      const { response: res } = await api.PATCH("/api/v1/shipping-regions/{id}", {
        params: { path: { id: editingId } },
        body: body as never,
      });
      if (!res.ok) {
        setError(t("shippingRegions.saveFailed", { status: res.status }));
        return;
      }
    } else {
      const { response: res } = await api.POST("/api/v1/shipping-regions", {
        body: body as never,
      });
      if (!res.ok) {
        setError(t("shippingRegions.saveFailed", { status: res.status }));
        return;
      }
    }
    setCreating(false);
    setEditingId(null);
    setForm({ name: "", sortOrder: 0 });
    await refresh();
  };

  const toggleEnabled = async (method: ShippingRegionRow) => {
    await api.PATCH("/api/v1/shipping-regions/{id}", {
      params: { path: { id: method.id } },
      body: { enabled: !method.enabled } as never,
    });
    await refresh();
  };

  const remove = async (method: ShippingRegionRow) => {
    if (!window.confirm(t("shippingRegions.deleteConfirm", { name: method.name }))) return;
    const { data, response } = await api.DELETE("/api/v1/shipping-regions/{id}", {
      params: { path: { id: method.id } },
    });
    if (!response.ok) {
      const detail = (data as unknown as { message?: string })?.message;
      window.alert(detail ?? t("shippingRegions.deleteFailed", { status: response.status }));
      return;
    }
    const result = data as unknown as { disabled?: boolean };
    if (result?.disabled) {
      window.alert(t("shippingRegions.disabledInstead", { name: method.name }));
    }
    await refresh();
  };

  const startEdit = (method: ShippingRegionRow) => {
    setEditingId(method.id);
    setCreating(false);
    setForm({ name: method.name, sortOrder: method.sortOrder });
  };

  const startCreate = () => {
    setCreating(true);
    setEditingId(null);
    setForm({ name: "", sortOrder: (methods.data?.length ?? 0) + 1 });
  };

  const showForm = creating || editingId !== null;

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("shippingRegions.title")}
        description={t("shippingRegions.intro")}
        actions={
          <button
            type="button"
            onClick={showForm ? () => { setCreating(false); setEditingId(null); } : startCreate}
            className={showForm ? buttonClasses.secondary : buttonClasses.primary}
          >
            {showForm ? t("common.cancel") : t("shippingRegions.newMethod")}
          </button>
        }
      />

      {error ? <p className="text-sm text-red-600" role="alert">{error}</p> : null}

      {showForm ? (
        <Card title={editingId ? t("shippingRegions.editMethod") : t("shippingRegions.newMethod")}>
          <div className="grid gap-3 text-sm md:grid-cols-3">
            <div>
              <label className="block text-xs font-medium text-slate-500">
                {t("shippingRegions.name")}
              </label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="中国"
                className="mt-1 w-full rounded-lg border border-ink/20 bg-white px-2 py-1.5"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500">
                {t("shippingRegions.sortOrder")}
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

      {methods.isLoading ? (
        <Card><p className="text-sm text-slate-400">{t("common.loading")}</p></Card>
      ) : methods.data && methods.data.length > 0 ? (
        <Card className="overflow-hidden">
          <div className="-m-4 overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-ink/10 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="px-4 py-2.5 font-semibold">{t("shippingRegions.name")}</th>
                  <th className="px-3 py-2.5 font-semibold">{t("shippingRegions.sortOrder")}</th>
                  <th className="px-3 py-2.5 font-semibold">{t("items.status")}</th>
                  <th className="px-3 py-2.5 font-semibold"></th>
                </tr>
              </thead>
              <tbody>
                {methods.data.map((method) => (
                  <tr key={method.id} className="border-b border-ink/5 transition-colors last:border-0 hover:bg-pill">
                    <td className="px-4 py-2.5 font-medium text-ink">{method.name}</td>
                    <td className="px-3 py-2.5 font-mono text-xs">{method.sortOrder}</td>
                    <td className="px-3 py-2.5">
                      <button type="button" onClick={() => void toggleEnabled(method)}>
                        <Badge tone={method.enabled ? "success" : "neutral"}>
                          {method.enabled ? t("common.active") : t("common.disabled")}
                        </Badge>
                      </button>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <span className="flex justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => startEdit(method)}
                          className={buttonClasses.ghost}
                        >
                          {t("common.edit")}
                        </button>
                        <button
                          type="button"
                          onClick={() => void remove(method)}
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
        <EmptyState message={t("shippingRegions.empty")} />
      )}
    </div>
  );
}
