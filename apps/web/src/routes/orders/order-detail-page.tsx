import { useState } from "react";
import { useParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../../api-client/client";
import type { OrderView } from "../../types/order";
import {
  AttachmentsSection,
  RelatedOrdersSection,
} from "./related-and-attachments";
import { ShipmentSection } from "./shipment-section";
import { Modal } from "../../components/modal";
import { PageHeader, Card, buttonClasses } from "../../components/ui";

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
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const [view, setView] = useState<"current" | "original" | "history">("current");
  const [actionError, setActionError] = useState<string | null>(null);
  const [reviseOpen, setReviseOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

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

  if (isLoading) return <p className="text-sm text-slate-400">{t("common.loading")}</p>;
  if (isError) return <p className="text-sm text-red-600">{(loadError as Error).message}</p>;
  if (!order) return null;

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

  return (
    <div className="space-y-5">
      <PageHeader
        title={order.displayNumber}
        description={`${order.source === "manual"
          ? t("orders.sourceManual")
          : `${t("orders.sourceExternal")} (${order.platform ?? "?"})`
          } · ${new Date(order.createdAt).toLocaleString()}`}
        actions={
          <>
            <button type="button" onClick={() => setReviseOpen(true)} className={buttonClasses.secondary}>
              {t("orders.reviseAction")}
            </button>
            <button type="button" onClick={toggleArchive} className={buttonClasses.secondary}>
              {order.archivedAt ? t("orders.restoreAction") : t("orders.archiveAction")}
            </button>
            {order.archivedAt ? (
              <button type="button" onClick={() => setDeleteOpen(true)} className={buttonClasses.danger}>
                {t("orders.deleteAction")}
              </button>
            ) : null}
          </>
        }
      />
      {actionError ? (
        <p className="text-sm text-red-600" role="alert">{actionError}</p>
      ) : null}

      <div className="flex gap-1 border-b border-slate-200 text-sm">
        {([
          ["current", t("orders.currentView")],
          ["original", t("orders.originalView")],
          ["history", t("orders.historyView")],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setView(key)}
            className={`rounded-t px-3 py-1.5 ${
              view === key
                ? "border-x border-t border-slate-200 bg-white font-medium"
                : "text-slate-500 hover:text-slate-800"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {view === "current" ? (
        <div className="space-y-5">
          <Card title={t("orders.customerSection")}>
            <dl className="grid grid-cols-[10rem_1fr] gap-x-3 gap-y-1 text-sm">
              {["name", "phone", "email", "addressLine1", "city", "postalCode", "country"].map((key) => (
                <div key={key} className="contents">
                  <dt className="text-slate-500 capitalize">{key.replace(/([A-Z])/g, " $1")}</dt>
                  <dd>{customer[key] ?? "—"}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card title={t("orders.orderLines")}>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-500">
                    <th className="px-3 py-2 font-medium">{t("orders.lineTitle")}</th>
                    <th className="px-3 py-2 font-medium">{t("orders.lines")}</th>
                    <th className="px-3 py-2 font-medium">{t("items.itemCode")}</th>
                    <th className="px-3 py-2 font-medium">{t("orders.versionPinned", { date: "" })}</th>
                  </tr>
                </thead>
                <tbody>
                  {(order.lines ?? []).map((line) => (
                    <tr key={line.id} className="border-b border-slate-100">
                      <td className="px-3 py-2">{line.title ?? "—"}</td>
                      <td className="px-3 py-2">{line.quantity}</td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {line.itemVariant?.itemCode ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-500">
                        {line.itemContentVersion
                          ? `item ✓ ${new Date(line.itemContentVersion.effectiveAt).toLocaleDateString()}`
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title={t("orders.deliveryAndNotes")}>
            <div className="space-y-1 text-sm">
              <p>{t("orders.deliveryMethodLabel", { value: order.deliveryMethod ?? "—" })}</p>
              <p>{t("orders.buyerNoteLabel", { value: order.buyerNote ?? "—" })}</p>
            </div>
          </Card>

          <ShipmentSection
            platformBlocked={platformShippingBlocked(order.statusRaw)}
            platformFulfillments={readPlatformFulfillments(order.rawSource)}
          />
          <RelatedOrdersSection order={order} />
          <AttachmentsSection ownerType="order" ownerId={order.id} />
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
            className="mt-1 w-full rounded border border-slate-300 px-2.5 py-1.5"
            autoFocus
          />
        </label>
        <label className="block">
          <span className="text-slate-500">{t("orders.newBuyerNotePrompt")}</span>
          <input
            value={buyerNote}
            onChange={(event) => setBuyerNote(event.target.value)}
            className="mt-1 w-full rounded border border-slate-300 px-2.5 py-1.5"
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
            className="mt-1 w-full rounded border border-slate-300 px-2.5 py-1.5"
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
