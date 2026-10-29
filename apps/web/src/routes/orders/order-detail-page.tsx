import { LineImagePreviews } from "../items/line-image-previews";
import { useState } from "react";
import { useNavigate, useParams, useRouteLoaderData } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { OrderStatusBadges } from "./order-status-badges";
import { StageBadge } from "./stage-badge";
import { parseNoteBody } from "./note-display";
import { api } from "../../api-client/client";
import type { OrderView } from "../../types/order";
import {
  AttachmentsSection,
  RelatedOrdersSection,
} from "./related-and-attachments";
import { ShipmentSection } from "./shipment-section";
import { Modal } from "../../components/modal";
import { PageHeader, Card, Badge, buttonClasses } from "../../components/ui";
import type { rootLoader } from "../../layouts/root-loader";

/** Platform-state gate (§12.1): fulfilled/cancelled platform orders take no shipment entry. */
function platformShippingBlocked(statusRaw: Record<string, unknown> | null): boolean {
  const status = statusRaw ?? {};
  return (
    Boolean(status.cancelledAt) ||
    String(status.fulfillmentStatus ?? "").toUpperCase() === "FULFILLED"
  );
}

interface PlatformFulfillmentView {
  externalId: string;
  status: string | null;
  createdAt: string | null;
  tracking: Array<{ number: string | null; company: string | null; url: string | null }>;
}

/** Fulfillments the platform recorded itself, mirrored from the raw import. */
function readPlatformFulfillments(
  rawSource: Record<string, unknown> | null,
): PlatformFulfillmentView[] {
  const order = (rawSource as { order?: { platformFulfillments?: PlatformFulfillmentView[] } } | null)
    ?.order;
  return order?.platformFulfillments ?? [];
}

export default function OrderDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const rootData = useRouteLoaderData<typeof rootLoader>("root");
  const permissions = new Set(rootData?.user.permissions ?? []);
  const canCancel = permissions.has("orders:cancel");
  const canCreateManual = permissions.has("orders:create-manual");
  const canRevise = permissions.has("orders:revise");
  const canArchive = permissions.has("orders:archive");
  const canRestore = permissions.has("orders:restore");
  const canDelete = permissions.has("orders:delete");
  const canReportProblem = permissions.has("shipping:issue-report");
  const [view, setView] = useState<"current" | "original" | "history">("current");
  const [actionError, setActionError] = useState<string | null>(null);
  const [copyBusy, setCopyBusy] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [editingAssignment, setEditingAssignment] = useState(false);
  const [editShippingRegionId, setEditShippingRegionId] = useState("");
  const [editCategoryId, setEditCategoryId] = useState("");
  const [reviseOpen, setReviseOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [problemOpen, setProblemOpen] = useState(false);
  const [problemType, setProblemType] = useState("other");
  const [problemContent, setProblemContent] = useState("");
  const [problemBusy, setProblemBusy] = useState(false);
  const [problemError, setProblemError] = useState<string | null>(null);

  const { data: order, isLoading, isError, error: loadError } = useQuery({
    queryKey: ["order", id],
    queryFn: async () => {
      const { data, response } = await api.GET("/api/v1/orders/{id}", {
        params: { path: { id } },
      });
      if (!response.ok || !data) throw new Error(`Load failed (${response.status})`);
      return data as unknown as OrderView & { rawSource: Record<string, unknown> | null };
    },
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["order", id] });

  const categories = useQuery({
    queryKey: ["categories"],
    queryFn: async () => {
      const { data, response } = await api.GET("/api/v1/categories");
      if (!response.ok || !data) return [] as Array<{ id: string; name: string }>;
      return data as unknown as Array<{ id: string; name: string }>;
    },
  });

  const shippingRegions = useQuery({
    queryKey: ["shipping-regions"],
    queryFn: async () => {
      const { data, response } = await api.GET("/api/v1/shipping-regions");
      if (!response.ok || !data) return [] as Array<{ id: string; name: string }>;
      return data as unknown as Array<{ id: string; name: string }>;
    },
  });

  const saveAssignment = async () => {
    setCopyBusy(true);
    await api.PATCH("/api/v1/orders/{id}/assignment", {
      params: { path: { id } },
      body: {
        shippingRegionId: editShippingRegionId || null,
        categoryId: editCategoryId || null,
      } as never,
    });
    setCopyBusy(false);
    setEditingAssignment(false);
    refresh();
  };

  if (isLoading) return <p className="text-sm text-slate-400">{t("common.loading")}</p>;
  if (isError) return <p className="text-sm text-red-600">{(loadError as Error).message}</p>;
  if (!order) return null;

  const copyOrder = async () => {
    setCopyBusy(true);
    setActionError(null);
    const { data, response } = await api.POST("/api/v1/orders/{id}/copy", {
      params: { path: { id } },
    });
    setCopyBusy(false);
    if (!response.ok || !data) {
      setActionError(`Copy failed (${response.status}).`);
      return;
    }
    navigate(`/orders/${(data as { id: string }).id}`);
  };

  const cancelOrder = async () => {
    if (!window.confirm(t("orders.cancelConfirm", { number: order.displayNumber }))) {
      return;
    }
    setCancelBusy(true);
    setActionError(null);
    const { response } = await api.POST("/api/v1/orders/{id}/cancel", {
      params: { path: { id } },
      body: {} as never,
    });
    setCancelBusy(false);
    if (!response.ok) {
      setActionError(t("orders.cancelFailed", { status: response.status }));
      return;
    }
    await refresh();
  };

  const reportProblem = async () => {
    setProblemBusy(true);
    setProblemError(null);
    const { data, response } = await api.POST("/api/v1/shipping-work/{orderId}/problem", {
      params: { path: { orderId: id } },
      body: { type: problemType, content: problemContent.trim() } as never,
    });
    setProblemBusy(false);
    if (!response.ok) {
      const detail = (data as unknown as { message?: string })?.message;
      setProblemError(detail ?? t("work.problemFailed"));
      return;
    }
    setProblemOpen(false);
    setProblemContent("");
    await refresh();
  };

  const toggleArchive = async () => {
    setActionError(null);
    const path = order.archivedAt
      ? "/api/v1/orders/{id}/restore"
      : "/api/v1/orders/{id}/archive";
    const { response } = await api.POST(path, { params: { path: { id } } });
    if (!response.ok) {
      setActionError(`${order.archivedAt ? "Restore" : "Archive"} failed (${response.status}).`);
      return;
    }
    await refresh();
  };

  const customer = (order.customerSnapshot ?? {}) as Record<string, string>;
  const isCancelled = Boolean(
    order.cancelledAt ||
      (order.statusRaw as { cancelledAt?: unknown } | null)?.cancelledAt,
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => navigate("/orders")}
          className="rounded-lg border border-ink/20 bg-white px-2.5 py-1 text-sm text-slate-600 transition-colors hover:bg-pill"
          aria-label={t("common.back")}
        >
          ← {t("common.back")}
        </button>
        <PageHeader
          title={order.displayNumber}
          description={`${order.source === "manual"
            ? t("orders.sourceManual")
            : `${t("orders.sourceExternal")} (${order.platform ?? "?"})`
            }`}
        />
        <OrderStatusBadges
          statusRaw={order.statusRaw}
          cancelledAt={order.cancelledAt}
        />
        <StageBadge stage={order.stage} />
      </div>
      {actionError ? (
        <p className="text-sm text-red-600" role="alert">{actionError}</p>
      ) : null}
      {isCancelled ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {t("orders.cancelledNotice")}
          {order.cancelledAt
            ? ` · ${new Date(order.cancelledAt).toLocaleString()}`
            : ""}
          {order.cancelledReason ? ` · ${order.cancelledReason}` : ""}
        </p>
      ) : null}

      <div className="flex overflow-hidden rounded-xl border border-ink/15 text-sm">
        {([
          ["current", t("orders.currentView")],
          ["original", t("orders.originalView")],
          ["history", t("orders.historyView")],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setView(key)}
            className={`px-3.5 py-1.5 transition-colors ${
              view === key
                ? "bg-ink font-semibold text-white"
                : "bg-white text-slate-600 hover:bg-pill hover:text-ink"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {view === "current" ? (
        <div className="space-y-5">
          {/* At-a-glance summary band: the who/how much layer */}
          <section className="pop-shadow rounded-xl border border-ink/10 bg-ink px-5 py-4 text-white">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <dl className="grid flex-1 grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-4">
              <div>
                <dt className="text-xs uppercase tracking-wide text-white/50">{t("orders.customerName")}</dt>
                <dd className="truncate font-medium">{customer.name ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-white/50">{t("orders.summaryLines")}</dt>
                <dd className="font-mono">{order._count?.lines ?? order.lines?.length ?? 0}</dd>
              </div>
              <div>
                <dt className="flex items-center gap-1 text-xs uppercase tracking-wide text-white/50">
                  {t("orders.shippingRegionLabel")}
                  {canRevise ? (
                    <button
                      type="button"
                      onClick={() => {
                        setEditShippingRegionId(order.shippingRegion?.id ?? "");
                        setEditCategoryId(order.category?.id ?? "");
                        setEditingAssignment((v) => !v);
                      }}
                      className="text-white/40 hover:text-white"
                      aria-label="Edit assignment"
                    >
                      ✎
                    </button>
                  ) : null}
                </dt>
                <dd>{order.shippingRegion?.name ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-white/50">{t("orders.categoryCol")}</dt>
                <dd>{order.category?.name ?? "—"}</dd>
              </div>
              {editingAssignment ? (
                <div className="col-span-2 flex flex-wrap items-center gap-3 md:col-span-4">
                  <select
                    value={editShippingRegionId}
                    onChange={(e) => setEditShippingRegionId(e.target.value)}
                    className="rounded-lg border border-white/25 bg-white/10 px-2 py-1 text-sm text-white"
                  >
                    <option value="" className="text-ink">—</option>
                    {(shippingRegions.data ?? []).map((region) => (
                      <option key={region.id} value={region.id} className="text-ink">
                        {region.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={editCategoryId}
                    onChange={(e) => setEditCategoryId(e.target.value)}
                    className="rounded-lg border border-white/25 bg-white/10 px-2 py-1 text-sm text-white"
                  >
                    <option value="" className="text-ink">—</option>
                    {(categories.data ?? []).map((cat) => (
                      <option key={cat.id} value={cat.id} className="text-ink">
                        {cat.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={copyBusy}
                    onClick={() => void saveAssignment()}
                    className="rounded-lg bg-brand px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    {t("common.save")}
                  </button>
                </div>
              ) : null}
              <div>
                <dt className="text-xs uppercase tracking-wide text-white/50">{t("orders.created")}</dt>
                <dd className="font-mono text-xs">{new Date(order.createdAt).toLocaleString()}</dd>
              </div>
              </dl>
              <div className="flex shrink-0 items-center gap-2">
                {canCreateManual ? (
                  <button
                    type="button"
                    disabled={copyBusy}
                    onClick={() => void copyOrder()}
                    className="rounded-lg border border-white/25 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-white/10 disabled:opacity-50"
                  >
                    {copyBusy ? t("orders.copying") : t("orders.copyAction")}
                  </button>
                ) : null}
                {canRevise ? (
                  <button
                    type="button"
                    onClick={() => setReviseOpen(true)}
                    className="rounded-lg border border-white/25 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-white/10"
                  >
                    {t("orders.reviseAction")}
                  </button>
                ) : null}
                {order.archivedAt ? (
                  canRestore ? (
                    <button
                      type="button"
                      onClick={toggleArchive}
                      className="rounded-lg border border-white/25 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-white/10"
                    >
                      {t("orders.restoreAction")}
                    </button>
                  ) : null
                ) : canArchive ? (
                  <button
                    type="button"
                    onClick={toggleArchive}
                    className="rounded-lg border border-white/25 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-white/10"
                  >
                    {t("orders.archiveAction")}
                  </button>
                ) : null}
                {canCancel && !isCancelled ? (
                  <button
                    type="button"
                    disabled={cancelBusy}
                    onClick={() => void cancelOrder()}
                    className="rounded-lg border border-white/25 px-3 py-1.5 text-sm font-medium text-red-200 transition-colors hover:bg-red-400/20 disabled:opacity-50"
                  >
                    {cancelBusy ? t("orders.cancelling") : t("orders.cancelAction")}
                  </button>
                ) : null}
                {order.archivedAt && canDelete ? (
                  <button
                    type="button"
                    onClick={() => setDeleteOpen(true)}
                    className="rounded-lg border border-white/25 px-3 py-1.5 text-sm font-medium text-red-200 transition-colors hover:bg-red-400/20"
                  >
                    {t("orders.deleteAction")}
                  </button>
                ) : null}
              </div>
            </div>
          </section>

          {/* Two-column layer: main flow left, reference info right */}
          <div className="grid items-start gap-5 lg:grid-cols-3">
            <div className="space-y-5 lg:col-span-2">
              <Card title={t("orders.orderLines")}>
                <ul className="divide-y divide-ink/5">
                  {(order.lines ?? []).map((line) => (
                    <li key={line.id} className="flex items-start gap-3 py-2 text-sm">
                      <div className="min-w-0 space-y-2"><span className="font-medium text-ink">{line.title ?? "—"}</span><LineImagePreviews line={line} name={line.title ?? line.itemVariant?.name ?? ""} /></div>
                      <span className="font-mono text-[13px] text-slate-500">× {line.quantity}</span>
                      {line.itemVariant ? (
                        <span className="ml-auto font-mono text-xs text-slate-400">
                          {line.itemVariant.itemCode}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </Card>

              <ShipmentSection
                platformBlocked={platformShippingBlocked(order.statusRaw)}
                platformFulfillments={readPlatformFulfillments(order.rawSource)}
              />
              {permissions.has("customers:read-basic") ? (
                <RelatedOrdersSection order={order} />
              ) : null}
              {permissions.has("attachments:view-metadata") ? (
                <AttachmentsSection ownerType="order" ownerId={order.id} />
              ) : null}
            </div>

            <div className="space-y-5">
              <Card title={t("orders.customerSection")}>
                <dl className="space-y-2 text-sm">
                  {([
                    ["name", t("orders.customerName")],
                    ["phone", t("orders.phone")],
                    ["email", t("orders.email")],
                    ["addressLine1", t("orders.address")],
                    ["city", t("orders.city")],
                    ["postalCode", t("orders.postalCode")],
                    ["country", t("orders.country")],
                  ] as const).map(([key, label]) => (
                    <div key={key} className="flex items-baseline gap-2">
                      <dt className="w-20 shrink-0 text-xs text-slate-400">{label}</dt>
                      <dd className="min-w-0 break-words">{customer[key] ?? "—"}</dd>
                    </div>
                  ))}
                </dl>
              </Card>

              <Card title={t("orders.deliveryAndNotes")}>
                <div className="space-y-2 text-sm">
                  <p>
                    <span className="text-xs text-slate-400">{t("orders.deliveryMethod")}</span>
                    <br />
                    {order.deliveryMethod ?? "—"}
                  </p>
                  <p>
                    <span className="text-xs text-slate-400">{t("orders.buyerNote")}</span>
                    <br />
                    {order.buyerNote ?? "—"}
                  </p>
                </div>
              </Card>

              <Card title={t("orders.workflowHistory")}>
                {(order.stageEvents ?? []).length === 0 ? (
                  <p className="text-sm text-slate-400">{t("orders.workflowEmpty")}</p>
                ) : (
                  <ol className="space-y-2 text-sm">
                    {(order.stageEvents ?? [])
                      .slice()
                      .reverse()
                      .map((event) => {
                        const stageLabel = (stage: string) =>
                          t(`stages.${stage}`, stage);
                        let title: string;
                        if (!event.fromStage) {
                          title =
                            event.action === "imported"
                              ? t("work.eventImported")
                              : t("work.eventCreated");
                        } else if (event.action === "tail_saved") {
                          title = t("work.eventTailSaved");
                        } else if (event.fromStage === event.toStage) {
                          title = t(`work.action.${event.action}`, event.action);
                        } else {
                          title = `${stageLabel(event.fromStage)} → ${stageLabel(event.toStage)}`;
                        }
                        return (
                          <li key={event.id} className="rounded border border-ink/10 bg-white p-2">
                            <div className="flex flex-wrap justify-between gap-2 text-xs text-slate-400">
                              <span>{title}</span>
                              <span>{new Date(event.createdAt).toLocaleString()}</span>
                            </div>
                            <p className="mt-1 text-xs text-slate-500">
                              {event.actorName ??
                                (event.actorId === "system"
                                  ? t("work.system")
                                  : event.actorId)}
                            </p>
                          </li>
                        );
                      })}
                  </ol>
                )}
              </Card>

              <Card title={t("problem.title")}>
                {(order.problemItems ?? []).length === 0 ? (
                  <p className="text-sm text-slate-400">{t("problem.empty")}</p>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {(order.problemItems ?? []).map((item) => (
                      <li key={item.id} className="rounded border border-ink/10 bg-white p-2">
                        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                          <Badge tone="danger">{t(`problem.types.${item.type}`, item.type)}</Badge>
                          <Badge tone="neutral">
                            {item.status === "open"
                              ? t("problem.statusOpen")
                              : item.status === "resolved_restart"
                                ? t("problem.statusResolvedRestart")
                                : item.status === "resolved_copied"
                                  ? t("problem.statusResolvedCopied")
                                  : t("problem.statusCancelled")}
                          </Badge>
                          <span className="ml-auto">{new Date(item.reportedAt).toLocaleString()}</span>
                        </div>
                        <p className="mt-1 whitespace-pre-wrap text-slate-700">{item.content}</p>
                        <p className="mt-1 text-xs text-slate-400">
                          {t("problem.reportedBy")}: {item.reportedByName ?? "—"}
                          {item.resolutionNote ? ` · ${item.resolutionNote}` : ""}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
                {canReportProblem &&
                order.stage !== "cancelled" &&
                !(order.problemItems ?? []).some((item) => item.status === "open") ? (
                  <button
                    type="button"
                    onClick={() => {
                      setProblemOpen(true);
                      setProblemError(null);
                    }}
                    className={`${buttonClasses.danger} mt-2`}
                  >
                    {t("problem.mark")}
                  </button>
                ) : null}
              </Card>

              <Card title={t("orders.notesTitle")}>
                {(order.notes ?? []).length === 0 ? (
                  <p className="text-sm text-slate-400">{t("orders.noNotes")}</p>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {(order.notes ?? []).map((note) => {
                      const parsed = parseNoteBody(note.body);
                      const label =
                        parsed.kind === "review"
                          ? t("orders.noteKindReview")
                          : parsed.kind === "copy"
                            ? t("orders.noteKindCopy")
                            : parsed.kind === "problem"
                              ? t("orders.noteKindProblem")
                              : parsed.kind === "packing"
                                ? t("orders.noteKindPacking")
                                : parsed.kind === "ordering"
                                  ? t("orders.noteKindOrdering")
                                  : parsed.kind === "inspection"
                                    ? t("orders.noteKindInspection")
                                    : parsed.kind === "tail"
                                      ? t("orders.noteKindTail")
                                      : t("orders.noteKindGeneric");
                      const content =
                        parsed.kind === "copy"
                          ? t("orders.noteCopyBody", { number: parsed.sourceNumber })
                          : parsed.body;
                      return (
                        <li key={note.id} className="rounded border border-ink/10 bg-white p-2">
                          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-xs text-slate-400">
                            <span className="flex min-w-0 items-center gap-1.5">
                              <span className="shrink-0 whitespace-nowrap rounded bg-pill px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
                                {label}
                              </span>
                              <span className="truncate">
                                {note.createdByUser?.name ?? t("orders.unknownAuthor")}
                              </span>
                            </span>
                            <span className="shrink-0 whitespace-nowrap">
                              {new Date(note.createdAt).toLocaleString()}
                            </span>
                          </div>
                          <p className="mt-1 whitespace-pre-wrap break-words">{content}</p>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Card>
            </div>
          </div>
        </div>
      ) : view === "original" ? (
        <div>
          <p className="text-sm text-slate-500">{t("orders.originalViewIntro")}</p>
          <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-slate-900 p-3 text-xs text-slate-100">
            {JSON.stringify(order.rawSource ?? {}, null, 2)}
          </pre>
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          <Card title={t("orders.internalRevisions")}>
            {(order.revisions ?? []).length === 0 ? (
              <p className="text-slate-400">{t("orders.noRevisions")}</p>
            ) : (
              (order.revisions ?? []).map((revision) => (
                <div key={revision.id} className="rounded border border-slate-200 bg-white p-3">
                  <div className="flex justify-between text-xs text-slate-400">
                    <span>{new Date(revision.createdAt).toLocaleString()}</span>
                    <span>by {revision.userId.slice(0, 12)}</span>
                  </div>
                  <p className="mt-1 font-medium">{t("orders.reason", { reason: revision.reason })}</p>
                  <details className="mt-1">
                    <summary className="cursor-pointer text-slate-500">{t("orders.beforeAfter")}</summary>
                    <pre className="mt-1 overflow-auto rounded bg-slate-900 p-2 text-xs text-slate-100">
                      {JSON.stringify({ before: revision.before, after: revision.after }, null, 2)}
                    </pre>
                  </details>
                </div>
              ))
            )}
          </Card>
        </div>
      )}

      {reviseOpen ? (
        <ReviseModal orderId={id} onClose={() => setReviseOpen(false)} onSaved={refresh} />
      ) : null}
      {problemOpen ? (
        <Modal title={t("problem.mark")} onClose={() => setProblemOpen(false)}>
          <div className="space-y-3 text-sm">
            <label className="block text-xs text-slate-500">
              {t("problem.title")}
              <select
                value={problemType}
                onChange={(event) => setProblemType(event.target.value)}
                className="mt-1 w-full rounded-lg border border-ink/20 px-2 py-1.5"
              >
                <option value="pending_pickup">{t("problem.types.pending_pickup")}</option>
                <option value="returning">{t("problem.types.returning")}</option>
                <option value="address">{t("problem.types.address")}</option>
                <option value="damaged">{t("problem.types.damaged")}</option>
                <option value="missing">{t("problem.types.missing")}</option>
                <option value="other">{t("problem.types.other")}</option>
              </select>
            </label>
            <label className="block text-xs text-slate-500">
              {t("problem.contentPlaceholder")}
              <textarea
                value={problemContent}
                onChange={(event) => setProblemContent(event.target.value)}
                rows={3}
                className="mt-1 w-full rounded-lg border border-ink/20 px-2 py-1.5"
              />
            </label>
            {problemError ? <p className="text-sm text-red-600" role="alert">{problemError}</p> : null}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setProblemOpen(false)} className={buttonClasses.secondary}>
                {t("common.cancel")}
              </button>
              <button
                type="button"
                disabled={problemBusy || !problemContent.trim()}
                onClick={() => void reportProblem()}
                className={buttonClasses.danger}
              >
                {t("problem.report")}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      {deleteOpen ? (
        <DeleteModal orderId={id} onClose={() => setDeleteOpen(false)} onDeleted={() => {
          window.location.href = "/orders";
        }} />
      ) : null}
    </div>
  );
}

/** Internal revision dialog (replaces the native prompt flow). */
function ReviseModal({
  orderId,
  onClose,
  onSaved,
}: {
  orderId: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");
  const [buyerNote, setBuyerNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!reason.trim()) return;
    setBusy(true);
    setError(null);
    const { response } = await api.PATCH("/api/v1/orders/{id}", {
      params: { path: { id: orderId } },
      body: {
        reason: reason.trim(),
        ...(buyerNote.trim() ? { buyerNote: buyerNote.trim() } : {}),
      },
    });
    setBusy(false);
    if (!response.ok) {
      setError(t("orders.revisionFailed", { status: response.status }));
      return;
    }
    await onSaved();
    onClose();
  };

  return (
    <Modal title={t("orders.reviseModalTitle")} onClose={onClose}>
      <div className="space-y-4 text-sm">
        <label className="block">
          <span className="text-slate-500">{t("orders.revisionReasonPrompt")}</span>
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className="mt-1 w-full rounded-lg border border-ink/20 px-2.5 py-1.5"
            autoFocus
          />
        </label>
        <label className="block">
          <span className="text-slate-500">{t("orders.newBuyerNotePrompt")}</span>
          <input
            value={buyerNote}
            onChange={(event) => setBuyerNote(event.target.value)}
            className="mt-1 w-full rounded-lg border border-ink/20 px-2.5 py-1.5"
          />
        </label>
        {error ? <p className="text-red-600" role="alert">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={buttonClasses.secondary}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || !reason.trim()}
            className={buttonClasses.primary}
          >
            {t("orders.reviseSubmit")}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Permanent-delete confirmation with required reason. */
function DeleteModal({
  orderId,
  onClose,
  onDeleted,
}: {
  orderId: string;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!reason.trim()) return;
    setBusy(true);
    setError(null);
    // The reason travels in the request body; the generated client types
    // this DELETE without a body, so the init is cast deliberately.
    const { response } = await api.DELETE("/api/v1/orders/{id}", {
      params: { path: { id: orderId } },
      body: { reason: reason.trim() },
    } as never);
    setBusy(false);
    if (!response.ok) {
      setError(t("orders.deleteFailed", { status: response.status }));
      return;
    }
    onDeleted();
  };

  return (
    <Modal title={t("orders.deleteModalTitle")} onClose={onClose}>
      <div className="space-y-4 text-sm">
        <p className="rounded bg-red-50 px-3 py-2 text-red-700">
          {t("orders.deleteWarning")}
        </p>
        <label className="block">
          <span className="text-slate-500">{t("orders.deleteReasonPrompt")}</span>
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className="mt-1 w-full rounded-lg border border-ink/20 px-2.5 py-1.5"
            autoFocus
          />
        </label>
        {error ? <p className="text-red-600" role="alert">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={buttonClasses.secondary}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || !reason.trim()}
            className="rounded bg-red-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-600 disabled:opacity-50"
          >
            {t("orders.deleteSubmit")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
