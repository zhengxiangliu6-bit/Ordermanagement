import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useParams, useRouteLoaderData } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../../api-client/client";
import { Modal } from "../../components/modal";
import { Card, buttonClasses } from "../../components/ui";
import type { rootLoader } from "../../layouts/root-loader";

// Response shapes for the M4b shipment entry flow (openapi types are loose
// with union payloads, so the dialog works from these local views).
interface CarrierCandidate {
  id: string;
  key: string;
  name: string;
  preview: {
    normalizedNumber: string;
    attakyTrackingNumber: string | null;
    attakyTrackingUrl: string | null;
    carrierTrackingUrl: string | null;
  } | null;
}

interface OutboundPlan {
  policyMode: string;
  remoteSyncStatus: string;
  plannedSendAt: string | null;
  externalTimezone: string;
  customerNotification: "choice" | "mandated" | "none";
}

interface ShipmentRow {
  id: string;
  carrierId: string | null;
  carrier: { key: string; name: string } | null;
  originalTrackingNumber: string | null;
  attakyTrackingNumber: string | null;
  attakyTrackingUrl: string | null;
  publicTrackingMode: string | null;
  localStatus: string;
  remoteSyncStatus: string;
  nextSendAt: string | null;
  policyMode: string | null;
  ruleVersion: number | null;
  enteredAt: string;
  platformResults: {
    attempts?: number;
    ops?: Array<{ op: string; ok: boolean; errorType?: string }>;
  } | null;
}

type RecognitionResult =
  | { kind: "single"; carrier: CarrierCandidate }
  | { kind: "ambiguous"; candidates: CarrierCandidate[] }
  | { kind: "none"; carriers: CarrierCandidate[] };

const POLICY_LABEL_KEYS: Record<string, string> = {
  immediate: "shipments.policyImmediate",
  scheduled: "shipments.policyScheduled",
  review_then_immediate: "shipments.policyReviewThenImmediate",
  review_then_scheduled: "shipments.policyReviewThenScheduled",
  not_applicable: "shipments.policyNotApplicable",
};

const STATUS_LABEL_KEYS: Record<string, string> = {
  pending_review: "shipments.statusPendingReview",
  scheduled: "shipments.statusScheduled",
  sending: "shipments.statusSending",
  synced: "shipments.statusSynced",
  partially_synced: "shipments.statusPartiallySynced",
  failed: "shipments.statusFailed",
  not_supported: "shipments.statusNotSupported",
  manual_action_required: "shipments.statusManualAction",
  rejected: "shipments.statusRejected",
  not_applicable: "shipments.statusNotApplicable",
};

const STATUS_BADGE_CLASSES: Record<string, string> = {
  synced: "bg-emerald-100 text-emerald-800",
  partially_synced: "bg-amber-100 text-amber-800",
  manual_action_required: "bg-red-100 text-red-700",
  not_supported: "bg-slate-200 text-slate-700",
  rejected: "bg-red-100 text-red-700",
};

function formatInZone(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat(undefined, {
    ...(timeZone ? { timeZone } : {}),
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

/** Order-detail shipment block: existing shipment card or the entry dialog. */
export function ShipmentSection({
  platformBlocked = false,
  platformFulfillments = [],
}: {
  platformBlocked?: boolean;
  platformFulfillments?: Array<{
    externalId: string;
    status: string | null;
    createdAt: string | null;
    tracking: Array<{ number: string | null; company: string | null; url: string | null }>;
  }>;
}) {
  const { id = "" } = useParams();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const root = useRouteLoaderData<typeof rootLoader>("root");
  const canEnter = !!root?.user.permissions.includes("shipping:enter");
  const canSeeSource = !!root?.user.permissions.includes("carrier-source:read");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [reviseOpen, setReviseOpen] = useState(false);

  const shipments = useQuery({
    queryKey: ["order-shipments", id],
    queryFn: async () => {
      const { data, response } = await api.GET("/api/v1/orders/{orderId}/shipments", {
        params: { path: { orderId: id } },
      });
      if (!response.ok || !data) throw new Error(`Load failed (${response.status})`);
      return data as unknown as ShipmentRow[];
    },
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["order-shipments", id] });
    void queryClient.invalidateQueries({ queryKey: ["order", id] });
  };

  const shipment: ShipmentRow | undefined = shipments.data?.[0];

  return (
    <Card
      title={t("shipments.sectionTitle")}
      actions={
        <>
          {shipment && canEnter && !platformBlocked ? (
            <button type="button" onClick={() => setReviseOpen(true)} className={buttonClasses.ghost}>
              {t("shipments.reviseButton")}
            </button>
          ) : null}
          {!shipment && canEnter && !platformBlocked ? (
            <button type="button" onClick={() => setDialogOpen(true)} className={buttonClasses.secondary}>
              {t("shipments.enterButton")}
            </button>
          ) : null}
          {platformBlocked ? (
            <span className="text-xs text-slate-400">{t("shipments.platformBlockedNote")}</span>
          ) : null}
        </>
      }
    >
      {shipments.isLoading ? (
        <p className="text-sm text-slate-400">{t("common.loading")}</p>
      ) : shipment ? (
        <div className="rounded border border-slate-100 bg-slate-50 p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded px-1.5 py-0.5 text-xs ${
                STATUS_BADGE_CLASSES[shipment.remoteSyncStatus] ??
                "bg-slate-100 text-slate-700"
              }`}
            >
              {t(STATUS_LABEL_KEYS[shipment.remoteSyncStatus] ?? "shipments.statusScheduled")}
            </span>
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">
              {t("shipments.localStatusDispatched")}
            </span>
            {shipment.publicTrackingMode === "attaky" ? (
              <span className="rounded bg-sky-100 px-1.5 py-0.5 text-xs text-sky-800">
                {t("shipments.modeAttaky")}
              </span>
            ) : (
              <span className="rounded bg-sky-100 px-1.5 py-0.5 text-xs text-sky-800">
                {t("shipments.modeCarrier")}
              </span>
            )}
          </div>
          <dl className="mt-2 grid grid-cols-[12rem_1fr] gap-x-3 gap-y-1">
            <dt className="text-slate-500">{t("shipments.attakyNumber")}</dt>
            <dd className="font-mono text-xs">{shipment.attakyTrackingNumber ?? "—"}</dd>
            {shipment.attakyTrackingUrl ? (
              <>
                <dt className="text-slate-500">{t("shipments.attakyUrl")}</dt>
                <dd>
                  <a
                    className="text-sky-700 underline"
                    href={shipment.attakyTrackingUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {shipment.attakyTrackingUrl}
                  </a>
                </dd>
              </>
            ) : null}
            {canSeeSource ? (
              <>
                <dt className="text-slate-500">{t("shipments.carrierName")}</dt>
                <dd>{shipment.carrier?.name ?? "—"}</dd>
                <dt className="text-slate-500">{t("shipments.originalNumber")}</dt>
                <dd className="font-mono text-xs">{shipment.originalTrackingNumber ?? "—"}</dd>
              </>
            ) : null}
            <dt className="text-slate-500">{t("shipments.policyLabel")}</dt>
            <dd>
              {t(POLICY_LABEL_KEYS[shipment.policyMode ?? ""] ?? "shipments.policyImmediate")}
            </dd>
            {shipment.nextSendAt ? (
              <>
                <dt className="text-slate-500">{t("shipments.nextSendLabel")}</dt>
                <dd>
                  {formatInZone(shipment.nextSendAt)}
                  <span className="ml-1 text-xs text-slate-400">
                    {t("shipments.userTzNote")}
                  </span>
                </dd>
              </>
            ) : null}
            {shipment.remoteSyncStatus === "pending_review" ? (
              <>
                <dt className="text-slate-500">{t("shipments.reviewLabel")}</dt>
                <dd>
                  <Link
                    className="text-sky-700 underline"
                    to="/review?type=shipment"
                  >
                    {t("shipments.reviewQueueLink")}
                  </Link>
                </dd>
              </>
            ) : null}
            <dt className="text-slate-500">{t("shipments.ruleVersion")}</dt>
            <dd>{shipment.ruleVersion ?? "—"}</dd>
            {shipment.platformResults?.attempts ? (
              <>
                <dt className="text-slate-500">{t("shipments.attempts")}</dt>
                <dd>{shipment.platformResults.attempts}</dd>
              </>
            ) : null}
            {shipment.platformResults?.ops?.length ? (
              <>
                <dt className="text-slate-500">{t("shipments.platformOps")}</dt>
                <dd className="font-mono text-xs">
                  {shipment.platformResults.ops
                    .map((op) => `${op.ok ? "✓" : "✗"} ${op.op}`)
                    .join(" · ")}
                </dd>
              </>
            ) : null}
          </dl>
        </div>
      ) : (
        <p className="text-sm text-slate-400">{t("shipments.noShipment")}</p>
      )}

      {platformFulfillments.length > 0 ? (
        <div className="mt-2 rounded border border-slate-100 bg-slate-50 p-3">
          <p className="text-xs font-medium text-slate-500">
            {t("shipments.platformFulfillmentsTitle")}
          </p>
          <ul className="mt-1 space-y-1">
            {platformFulfillments.map((fulfillment) => (
              <li key={fulfillment.externalId} className="text-xs text-slate-600">
                <span className="text-slate-400">
                  {fulfillment.createdAt
                    ? new Date(fulfillment.createdAt).toLocaleString()
                    : "—"}
                  {" · "}
                  {fulfillment.status ?? "—"}
                </span>
                {fulfillment.tracking.map((item, index) => (
                  <span key={index} className="ml-2 font-mono">
                    {item.number ?? "—"}
                    {item.company ? ` (${item.company})` : ""}
                    {item.url ? (
                      <a
                        className="ml-1 text-sky-700 underline"
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        ↗
                      </a>
                    ) : null}
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {shipment ? <ShipmentTracking orderId={id} shipmentId={shipment.id} /> : null}

      {dialogOpen ? (
        <ShipmentEntryDialog orderId={id} onClose={() => setDialogOpen(false)} onSaved={refresh} />
      ) : null}
      {reviseOpen && shipment ? (
        <ShipmentReviseDialog
          orderId={id}
          shipment={shipment}
          onClose={() => setReviseOpen(false)}
          onSaved={refresh}
        />
      ) : null}
    </Card>
  );
}

/** Guided entry (§12.3): recognize → choose → preview → save. */
function ShipmentEntryDialog({
  orderId,
  onClose,
  onSaved,
}: {
  orderId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [trackingNumber, setTrackingNumber] = useState("");
  const [recognized, setRecognized] = useState<RecognitionResult | null>(null);
  const [chosenCarrierId, setChosenCarrierId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recognize = async () => {
    const value = trackingNumber.trim();
    if (!value) return;
    setBusy(true);
    setError(null);
    setRecognized(null);
    setChosenCarrierId(null);
    const { data, response } = await api.POST(
      "/api/v1/orders/{orderId}/shipments/recognize",
      { params: { path: { orderId } }, body: { trackingNumber: value } },
    );
    setBusy(false);
    if (!response.ok || !data) {
      setError(t("shipments.recognizeFailed", { status: response.status }));
      return;
    }
    const result = data as unknown as RecognitionResult;
    setRecognized(result);
    if (result?.kind === "single") setChosenCarrierId(result.carrier.id);
  };

  const preview = useQuery({
    queryKey: ["shipment-preview", orderId, trackingNumber, chosenCarrierId],
    enabled: !!chosenCarrierId && !!trackingNumber.trim(),
    retry: false,
    queryFn: async () => {
      const { data, response } = await api.POST(
        "/api/v1/orders/{orderId}/shipments/preview",
        {
          params: { path: { orderId } },
          body: { trackingNumber: trackingNumber.trim(), carrierId: chosenCarrierId! },
        },
      );
      if (!response.ok || !data) throw new Error(`${response.status}`);
      return data as unknown as { carrier: CarrierCandidate; plan: OutboundPlan };
    },
  });

  const plan = preview.data?.plan;

  const save = async () => {
    if (!chosenCarrierId) return;
    setBusy(true);
    setError(null);
    const { data, response } = await api.POST("/api/v1/orders/{orderId}/shipments", {
      params: { path: { orderId } },
      body: { trackingNumber: trackingNumber.trim(), carrierId: chosenCarrierId },
    });
    setBusy(false);
    if (!response.ok) {
      const detail = (data as { message?: string } | undefined)?.message;
      setError(detail ?? t("shipments.enterFailed", { status: response.status }));
      return;
    }
    onSaved();
    onClose();
  };

  const notificationText = useMemo(() => {
    if (!plan) return "";
    if (plan.customerNotification === "mandated") return t("shipments.notificationMandated");
    if (plan.customerNotification === "choice") return t("shipments.notificationChoice");
    return t("shipments.notificationNone");
  }, [plan, t]);

  return (
    <Modal title={t("shipments.dialogTitle")} onClose={onClose}>
      <div className="space-y-4 text-sm">
        <div className="flex gap-2">
          <input
            value={trackingNumber}
            onChange={(event) => setTrackingNumber(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void recognize();
            }}
            placeholder={t("shipments.trackingPlaceholder")}
            className="flex-1 rounded border border-slate-300 px-2.5 py-1.5 font-mono"
            autoFocus
          />
          <button
            type="button"
            onClick={() => void recognize()}
            disabled={busy || !trackingNumber.trim()}
            className="rounded border border-slate-300 px-3 py-1.5 hover:bg-slate-100 disabled:opacity-50"
          >
            {t("shipments.recognize")}
          </button>
        </div>

        {recognized?.kind === "single" ? (
          <p className="rounded bg-emerald-50 px-3 py-2 text-emerald-900">
            {t("shipments.recognizedAs")}: <strong>{recognized.carrier.name}</strong>
          </p>
        ) : null}

        {recognized?.kind === "ambiguous" ? (
          <div>
            <p className="font-medium">{t("shipments.ambiguousPrompt")}</p>
            <div className="mt-1 space-y-1">
              {recognized.candidates.map((candidate) => (
                <label
                  key={candidate.id}
                  className="flex cursor-pointer items-center gap-2 rounded border border-slate-200 px-2.5 py-1.5"
                >
                  <input
                    type="radio"
                    name="carrier-choice"
                    checked={chosenCarrierId === candidate.id}
                    onChange={() => setChosenCarrierId(candidate.id)}
                  />
                  <span>{candidate.name}</span>
                  {candidate.preview?.attakyTrackingNumber ? (
                    <span className="ml-auto font-mono text-xs text-slate-500">
                      {candidate.preview.attakyTrackingNumber}
                    </span>
                  ) : null}
                </label>
              ))}
            </div>
          </div>
        ) : null}

        {recognized?.kind === "none" ? (
          <div>
            <p className="font-medium">{t("shipments.noMatchPrompt")}</p>
            <select
              value={chosenCarrierId ?? ""}
              onChange={(event) => setChosenCarrierId(event.target.value || null)}
              className="mt-1 w-full rounded border border-slate-300 px-2.5 py-1.5"
            >
              <option value="">{t("shipments.chooseCarrier")}</option>
              {recognized.carriers.map((carrier) => (
                <option key={carrier.id} value={carrier.id}>
                  {carrier.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {preview.data ? (
          <div className="rounded border border-slate-200 bg-slate-50 p-3">
            <p className="font-medium">{t("shipments.previewTitle")}</p>
            <dl className="mt-1 grid grid-cols-[9rem_1fr] gap-x-3 gap-y-1">
              <dt className="text-slate-500">{t("shipments.attakyNumber")}</dt>
              <dd className="font-mono text-xs">
                {preview.data.carrier.preview?.attakyTrackingNumber ?? "—"}
              </dd>
              {preview.data.carrier.preview?.attakyTrackingUrl ? (
                <>
                  <dt className="text-slate-500">{t("shipments.attakyUrl")}</dt>
                  <dd className="break-all text-xs">
                    {preview.data.carrier.preview.attakyTrackingUrl}
                  </dd>
                </>
              ) : null}
              <dt className="text-slate-500">{t("shipments.policyLabel")}</dt>
              <dd>{t(POLICY_LABEL_KEYS[plan?.policyMode ?? ""] ?? "shipments.policyImmediate")}</dd>
              {plan?.plannedSendAt ? (
                <>
                  <dt className="text-slate-500">{t("shipments.plannedSend")}</dt>
                  <dd>
                    {formatInZone(plan.plannedSendAt, plan.externalTimezone)}
                    <span className="ml-1 text-xs text-slate-400">
                      {t("shipments.externalTzNote", { tz: plan.externalTimezone })}
                    </span>
                    <br />
                    <span className="text-xs text-slate-500">
                      {formatInZone(plan.plannedSendAt, undefined)}
                      <span className="ml-1 text-slate-400">{t("shipments.userTzNote")}</span>
                    </span>
                  </dd>
                </>
              ) : null}
              <dt className="text-slate-500">{t("shipments.notification")}</dt>
              <dd>{notificationText}</dd>
            </dl>
          </div>
        ) : null}

        {preview.isError ? (
          <p className="text-red-600" role="alert">
            {t("shipments.previewFailed")}
          </p>
        ) : null}
        {error ? (
          <p className="text-red-600" role="alert">
            {error}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-slate-300 px-3 py-1.5 hover:bg-slate-100"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy || !chosenCarrierId || !preview.data}
            className="rounded bg-slate-800 px-3 py-1.5 text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {t("shipments.save")}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Tracking data (§12.6): provider snapshot timeline, URL fallback. */
function ShipmentTracking({ orderId, shipmentId }: { orderId: string; shipmentId: string }) {
  const { t } = useTranslation();
  const tracking = useQuery({
    queryKey: ["shipment-tracking", shipmentId],
    queryFn: async () => {
      const { data, response } = await api.GET(
        "/api/v1/orders/{orderId}/shipments/{shipmentId}/tracking",
        { params: { path: { orderId, shipmentId } } },
      );
      if (!response.ok || !data) throw new Error(`${response.status}`);
      return data as unknown as
        | {
            kind: "provider";
            snapshot: {
              providerKey: string;
              currentStatus: string;
              lastUpdate: string | null;
              events: Array<{ at: string; label: string }>;
              link: string | null;
            };
          }
        | { kind: "fallback"; url: string | null };
    },
    refetchInterval: 60_000,
  });

  if (tracking.isLoading) return null;
  if (tracking.isError || !tracking.data) return null;

  if (tracking.data.kind === "fallback") {
    return tracking.data.url ? (
      <p className="mt-2 text-sm">
        <a
          className="text-sky-700 underline"
          href={tracking.data.url}
          target="_blank"
          rel="noreferrer"
        >
          {t("shipments.trackingFallbackLink")}
        </a>
      </p>
    ) : null;
  }

  const { snapshot } = tracking.data;
  const eventLabels: Record<string, string> = {
    recorded: t("shipments.eventRecorded"),
    dispatched: t("shipments.localStatusDispatched"),
    in_transit: t("shipments.eventInTransit"),
  };
  return (
    <div className="mt-3 rounded border border-slate-100 bg-slate-50 p-2 text-sm">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-slate-500">
          {t("shipments.trackingTitle")}
        </span>
        <span className="rounded bg-white px-1.5 py-0.5 text-xs text-slate-700">
          {eventLabels[snapshot.currentStatus] ?? snapshot.currentStatus}
        </span>
        {snapshot.link ? (
          <a
            className="ml-auto text-xs text-sky-700 underline"
            href={snapshot.link}
            target="_blank"
            rel="noreferrer"
          >
            {t("shipments.trackingOpenLink")}
          </a>
        ) : null}
      </div>
      <ul className="mt-1 space-y-0.5">
        {snapshot.events.map((event, index) => (
          <li key={`${event.at}-${index}`} className="text-xs text-slate-600">
            <span className="text-slate-400">
              {new Date(event.at).toLocaleString()} ·{" "}
            </span>
            {eventLabels[event.label] ?? event.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Correction dialog (§12.12): required reason, optional new number/carrier. */
function ShipmentReviseDialog({
  orderId,
  shipment,
  onClose,
  onSaved,
}: {
  orderId: string;
  shipment: ShipmentRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");
  const [trackingNumber, setTrackingNumber] = useState(shipment.originalTrackingNumber ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!reason.trim()) return;
    setBusy(true);
    setError(null);
    const { data, response } = await api.POST(
      "/api/v1/orders/{orderId}/shipments/{shipmentId}/revisions",
      {
        params: { path: { orderId, shipmentId: shipment.id } },
        body: {
          reason: reason.trim(),
          trackingNumber: trackingNumber.trim() || undefined,
        },
      },
    );
    setBusy(false);
    if (!response.ok) {
      const detail = (data as { message?: string } | undefined)?.message;
      setError(detail ?? t("shipments.enterFailed", { status: response.status }));
      return;
    }
    onSaved();
    onClose();
  };

  return (
    <Modal title={t("shipments.reviseDialogTitle")} onClose={onClose}>
      <div className="space-y-4 text-sm">
        <label className="block">
          <span className="text-slate-500">{t("shipments.reviseReason")}</span>
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className="mt-1 w-full rounded border border-slate-300 px-2.5 py-1.5"
            autoFocus
          />
        </label>
        <label className="block">
          <span className="text-slate-500">{t("shipments.trackingPlaceholder")}</span>
          <input
            value={trackingNumber}
            onChange={(event) => setTrackingNumber(event.target.value)}
            className="mt-1 w-full rounded border border-slate-300 px-2.5 py-1.5 font-mono"
          />
        </label>
        {error ? (
          <p className="text-red-600" role="alert">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-slate-300 px-3 py-1.5 hover:bg-slate-100"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy || !reason.trim()}
            className="rounded bg-slate-800 px-3 py-1.5 text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {t("shipments.reviseSave")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
