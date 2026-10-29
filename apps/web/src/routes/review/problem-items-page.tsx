import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../../api-client/client";
import { PageHeader, Card, EmptyState, Badge, buttonClasses } from "../../components/ui";
import { Modal } from "../../components/modal";

interface ProblemItemView {
  id: string;
  orderId: string;
  stageAtReport: string;
  source: string;
  type: string;
  content: string;
  status: string;
  reportedAt: string;
  reportedByName: string | null;
  order: {
    id: string;
    displayNumber: string;
    stage: string;
    customerSnapshot: Record<string, unknown> | null;
    shippingRegion?: { id: string; name: string } | null;
  };
}

type Resolution = "cancel" | "restart" | "copy";

export default function ProblemItemsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [typeFilter, setTypeFilter] = useState("");
  const [classFilter, setClassFilter] = useState("");
  const [regionFilter, setRegionFilter] = useState("");
  const [search, setSearch] = useState("");
  const [resolving, setResolving] = useState<{ item: ProblemItemView; resolution: Resolution } | null>(null);
  const [returnStage, setReturnStage] = useState<"packing" | "ordering" | "inspection">("packing");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const shippingRegions = useQuery({
    queryKey: ["shipping-regions"],
    queryFn: async () => {
      const { data, response } = await api.GET("/api/v1/shipping-regions");
      if (!response.ok || !data) return [] as Array<{ id: string; name: string }>;
      return data as unknown as Array<{ id: string; name: string }>;
    },
  });

  const items = useQuery({
    queryKey: ["problem-items"],
    queryFn: async () => {
      const { data, response } = await api.GET("/api/v1/problem-items");
      if (!response.ok || !data) throw new Error(`Load failed (${response.status})`);
      return data as unknown as ProblemItemView[];
    },
  });

  const startResolve = (item: ProblemItemView, resolution: Resolution) => {
    setResolving({ item, resolution });
    setNote("");
    setError(null);
  };

  const confirmResolve = async () => {
    if (!resolving) return;
    setBusy(true);
    setError(null);
    const { data, response } = await api.POST("/api/v1/problem-items/{id}/resolve", {
      params: { path: { id: resolving.item.id } },
      body: {
        resolution: resolving.resolution,
        ...(resolving.resolution === "restart" ? { returnStage } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      } as never,
    });
    setBusy(false);
    if (!response.ok) {
      const detail = (data as unknown as { message?: string })?.message;
      setError(detail ?? t("problem.resolveFailed", { status: response.status }));
      return;
    }
    setResolving(null);
    queryClient.invalidateQueries({ queryKey: ["problem-items"] });
    queryClient.invalidateQueries({ queryKey: ["orders"] });
  };

  const allItems = items.data ?? [];
  const regions = shippingRegions.data && shippingRegions.data.length > 0
    ? shippingRegions.data
    : Array.from(
        new Map(
          allItems
            .map((item) => item.order.shippingRegion)
            .filter((region): region is { id: string; name: string } => Boolean(region))
            .map((region) => [region.id, region]),
        ).values(),
      );
  const classification = (item: ProblemItemView): "ordering" | "inspection" | "generic" => {
    if (item.source !== "work") return "generic";
    if (item.stageAtReport === "ordering") return "ordering";
    if (item.stageAtReport === "inspection") return "inspection";
    return "generic";
  };
  const filtered = allItems.filter((item) => {
    if (classFilter && classification(item) !== classFilter) return false;
    if (typeFilter && item.type !== typeFilter) return false;
    if (regionFilter && item.order.shippingRegion?.id !== regionFilter) return false;
    if (search.trim() && !item.order.displayNumber.toLowerCase().includes(search.trim().toLowerCase())) {
      return false;
    }
    return true;
  });

  return (
    <div className="space-y-4">
      <PageHeader title={t("problem.title")} description={t("problem.intro")} />
      {error && !resolving ? (
        <p className="text-sm text-red-600" role="alert">{error}</p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <select
          value={classFilter}
          onChange={(event) => setClassFilter(event.target.value)}
          className="rounded-lg border border-ink/20 bg-white px-2 py-1.5"
        >
          <option value="">{t("problem.allClasses")}</option>
          <option value="ordering">{t("problem.classOrdering")}</option>
          <option value="inspection">{t("problem.classInspection")}</option>
          <option value="generic">{t("problem.classGeneric")}</option>
        </select>
        <select
          value={typeFilter}
          onChange={(event) => setTypeFilter(event.target.value)}
          className="rounded-lg border border-ink/20 bg-white px-2 py-1.5"
        >
          <option value="">{t("problem.allTypes")}</option>
          {(["pending_pickup", "returning", "address", "damaged", "missing", "other"] as const).map(
            (type) => (
              <option key={type} value={type}>
                {t(`problem.types.${type}`)}
              </option>
            ),
          )}
        </select>
        <select
          value={regionFilter}
          onChange={(event) => setRegionFilter(event.target.value)}
          className="rounded-lg border border-ink/20 bg-white px-2 py-1.5"
        >
          <option value="">{t("problem.allRegions")}</option>
          {regions.map((region) => (
            <option key={region.id} value={region.id}>
              {region.name}
            </option>
          ))}
        </select>
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("problem.searchPlaceholder")}
          className="w-64 rounded-lg border border-ink/20 bg-white px-2.5 py-1.5"
        />
      </div>

      {items.isLoading ? (
        <Card><p className="text-sm text-slate-400">{t("common.loading")}</p></Card>
      ) : items.isError ? (
        <p className="text-sm text-red-600">{(items.error as Error).message}</p>
      ) : filtered.length > 0 ? (
        <div className="space-y-2">
          {filtered.map((item) => (
            <Card key={item.id}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-display text-base font-semibold text-ink">
                  {item.order.displayNumber}
                </span>
                <Badge tone="danger">{t(`problem.types.${item.type}`, item.type)}</Badge>
                <Badge tone="warning">
                  {item.source === "work" && item.stageAtReport === "ordering"
                    ? t("problem.classOrdering")
                    : item.source === "work" && item.stageAtReport === "inspection"
                      ? t("problem.classInspection")
                      : t("problem.classGeneric")}
                </Badge>
                {item.order.shippingRegion ? (
                  <Badge tone="info">{item.order.shippingRegion.name}</Badge>
                ) : null}
                <span className="ml-auto text-xs text-slate-400">
                  {String(item.order.customerSnapshot?.name ?? "—")}
                </span>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{item.content}</p>
              <p className="mt-1 text-xs text-slate-400">
                {t("problem.reportedBy")}: {item.reportedByName ?? "—"} ·{" "}
                {new Date(item.reportedAt).toLocaleString()}
              </p>
              <div className="mt-3 flex flex-wrap justify-end gap-2">
                <button type="button" onClick={() => startResolve(item, "cancel")} className={buttonClasses.danger}>
                  {t("problem.resolveCancel")}
                </button>
                <button type="button" onClick={() => startResolve(item, "restart")} className={buttonClasses.secondary}>
                  {t("problem.resolveReturn")}
                </button>
                <button type="button" onClick={() => startResolve(item, "copy")} className={buttonClasses.primary}>
                  {t("problem.resolveCopy")}
                </button>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState message={t("problem.empty")} />
      )}

      {resolving ? (
        <Modal
          title={
            resolving.resolution === "cancel"
              ? t("problem.resolveCancel")
              : resolving.resolution === "restart"
                ? t("problem.resolveReturn")
                : t("problem.resolveCopy")
          }
          onClose={() => setResolving(null)}
        >
          <div className="space-y-3 text-sm">
            <p className="text-slate-600">
              {resolving.resolution === "cancel"
                ? t("problem.cancelHint")
                : resolving.resolution === "restart"
                  ? t("problem.restartHint")
                  : t("problem.copyHint")}
            </p>
            {resolving.resolution === "restart" ? (
              <div className="space-y-1">
                {(
                  [
                    ["packing", t("problem.returnToPacking")],
                    ["ordering", t("problem.returnToOrdering")],
                    ["inspection", t("problem.returnToInspection")],
                  ] as const
                ).map(([value, label]) => (
                  <label key={value} className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="return-stage"
                      checked={returnStage === value}
                      onChange={() => setReturnStage(value)}
                    />
                    {label}
                  </label>
                ))}
              </div>
            ) : null}
            <label className="block text-xs text-slate-500">
              {t("problem.resolutionNote")}
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={3}
                className="mt-1 w-full rounded-lg border border-ink/20 px-2 py-1.5"
              />
            </label>
            {error ? <p className="text-sm text-red-600" role="alert">{error}</p> : null}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setResolving(null)} className={buttonClasses.secondary}>
                {t("common.cancel")}
              </button>
              <button type="button" disabled={busy} onClick={() => void confirmResolve()} className={buttonClasses.primary}>
                {t("problem.confirmResolve")}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
