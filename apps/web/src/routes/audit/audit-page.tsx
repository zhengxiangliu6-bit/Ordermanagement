import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../../api-client/client";
import { Badge, buttonClasses, type BadgeTone } from "../../components/ui";

interface AuditEventView {
  id: string;
  actorType: string;
  actorId: string | null;
  action: string;
  objectType: string;
  objectId: string | null;
  before: unknown;
  after: unknown;
  metadata: unknown;
  createdAt: string;
}

interface AuditListResponse {
  events: AuditEventView[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

interface UserOption {
  id: string;
  name: string;
  email: string;
}

export default function AuditPage() {
  const { t } = useTranslation();
  const users = useQuery({
    queryKey: ["audit-user-names"],
    retry: false,
    queryFn: async () => {
      const { data, response } = await api.GET("/api/v1/users", {
        params: { query: {} },
      });
      if (!response.ok || !data) return [] as UserOption[];
      return ((data as { users?: unknown[] }).users ?? (data as unknown)) as UserOption[];
    },
  });
  const userNameById = new Map(
    (users.data ?? []).map((user) => [user.id, user.name || user.email]),
  );
  const [objectType, setObjectType] = useState("");
  const [action, setAction] = useState("");
  const [actorId, setActorId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["audit", { objectType, action, actorId, dateFrom, dateTo, page }],
    queryFn: async () => {
      const { data, response } = await api.GET("/api/v1/audit", {
        params: {
          query: {
            objectType: objectType || undefined,
            action: action || undefined,
            actorId: actorId || undefined,
            dateFrom: dateFrom ? new Date(dateFrom).toISOString() : undefined,
            dateTo: dateTo ? new Date(`${dateTo}T23:59:59.999Z`).toISOString() : undefined,
            page,
            pageSize: 20,
          },
        },
      });
      if (!response.ok || !data) throw new Error(`List failed (${response.status})`);
      return data as AuditListResponse;
    },
  });

  return (
    <div>
      <h1 className="font-display text-2xl leading-tight text-ink">{t("audit.title")}</h1>
      <p className="mt-1 text-sm text-slate-500">
        {t("audit.intro")}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
        <select
          value={objectType}
          onChange={(event) => {
            setObjectType(event.target.value);
            setPage(1);
          }}
          className="rounded-lg border border-ink/20 bg-white px-2 py-1.5"
        >
          <option value="">{t("audit.allObjectTypes")}</option>
          {["Item", "ItemVariant", "Listing", "ListingVariant", "Order", "OrderLine", "Note", "User", "Store", "Carrier", "Shipment", "ReviewRecord"].map((type) => (
            <option key={type} value={type}>{type}</option>
          ))}
        </select>
        <input
          value={action}
          onChange={(event) => {
            setAction(event.target.value);
            setPage(1);
          }}
          placeholder={t("audit.action")}
          className="w-52 rounded-lg border border-ink/20 px-2 py-1"
        />
        <input
          value={actorId}
          onChange={(event) => {
            setActorId(event.target.value);
            setPage(1);
          }}
          placeholder={t("audit.actorId")}
          className="w-52 rounded-lg border border-ink/20 px-2 py-1"
        />
        <span className="text-slate-500">{t("audit.from")}</span>
        <input
          type="date"
          value={dateFrom}
          onChange={(event) => {
            setDateFrom(event.target.value);
            setPage(1);
          }}
          className="rounded-lg border border-ink/20 bg-white px-2 py-1.5"
        />
        <span className="text-slate-500">{t("audit.to")}</span>
        <input
          type="date"
          value={dateTo}
          onChange={(event) => {
            setDateTo(event.target.value);
            setPage(1);
          }}
          className="rounded-lg border border-ink/20 bg-white px-2 py-1.5"
        />
      </div>

      <div className="mt-3 overflow-hidden rounded-xl border border-ink/10 pop-shadow-sm">
      <table className="w-full border-collapse bg-white text-sm">
        <thead>
          <tr className="border-b border-ink/10 text-left text-xs uppercase tracking-wide text-slate-400">
            <th className="px-4 py-2.5 font-semibold">{t("audit.time")}</th>
            <th className="px-4 py-2.5 font-semibold">{t("audit.actor")}</th>
            <th className="px-4 py-2.5 font-semibold">{t("audit.action")}</th>
            <th className="px-4 py-2.5 font-semibold">{t("audit.object")}</th>
            <th className="px-4 py-2.5 font-semibold"></th>
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            <tr><td colSpan={5} className="px-3 py-6 text-slate-400">{t("common.loading")}</td></tr>
          ) : isError ? (
            <tr><td colSpan={5} className="px-3 py-6 text-red-600">{(error as Error).message}</td></tr>
          ) : data && data.events.length > 0 ? (
            data.events.map((event) => (
              <AuditRow
                key={event.id}
                event={event}
                expanded={expandedId === event.id}
                actorName={
                  event.actorId ? userNameById.get(event.actorId) : undefined
                }
                t={t}
                onToggle={() =>
                  setExpandedId((current) => (current === event.id ? null : event.id))
                }
              />
            ))
          ) : (
            <tr><td colSpan={5} className="px-3 py-6 text-slate-400">{t("audit.noAuditEntriesFound")}</td></tr>
          )}
        </tbody>
      </table>

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
            {t("common.page", { page: data.page, pageCount: data.pageCount, total: data.total })}
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
    </div>
  );
}

/** Domain grouping for badge tones; unknown actions render neutral. */
function actionTone(action: string): BadgeTone {
  if (action.startsWith("review.")) return "brand";
  if (action.startsWith("order.")) return "info";
  if (action.startsWith("item") || action.startsWith("mapping.")) return "success";
  if (action.startsWith("shipment.")) return "warning";
  if (action.startsWith("user.")) return "danger";
  return "neutral";
}

function objectLabel(t: (key: string) => string, objectType: string): string {
  const key = `auditObjects.${objectType}`;
  const label = t(key);
  return label === key ? objectType : label;
}

interface DiffEntry {
  path: string;
  kind: "changed" | "added" | "removed";
  before?: unknown;
  after?: unknown;
}

/** Deep-compares two JSON values and records only what actually changed. */
function deepDiff(a: unknown, b: unknown, path: string, out: DiffEntry[]): void {
  const isPlainObject = (v: unknown) =>
    v !== null && typeof v === "object" && !Array.isArray(v);
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = new Set([
      ...Object.keys(a as Record<string, unknown>),
      ...Object.keys(b as Record<string, unknown>),
    ]);
    for (const key of keys) {
      deepDiff(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key],
        path ? `${path}.${key}` : key,
        out,
      );
    }
    return;
  }
  if (JSON.stringify(a) === JSON.stringify(b)) return;
  if (a === undefined) out.push({ path, kind: "added", after: b });
  else if (b === undefined) out.push({ path, kind: "removed", before: a });
  else out.push({ path, kind: "changed", before: a, after: b });
}

const fmtDiffValue = (value: unknown): string =>
  typeof value === "object" && value !== null
    ? JSON.stringify(value)
    : String(value);

function DiffSection({ before, after, label }: { before: unknown; after: unknown; label: string }) {
  if (before === null && after === null) return null;
  if (before === null || before === undefined) return null;
  if (after === null || after === undefined) return null;
  const entries: DiffEntry[] = [];
  deepDiff(before, after, "", entries);
  if (entries.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <ul className="mt-1 space-y-0.5 text-xs">
        {entries.map((entry) => (
          <li key={entry.path} className="flex flex-wrap items-baseline gap-1.5">
            <span className="font-mono text-slate-600">{entry.path}</span>
            {entry.kind === "changed" ? (
              <>
                <span className="whitespace-nowrap rounded bg-brand/10 px-1 font-mono text-brand line-through">
                  {fmtDiffValue(entry.before)}
                </span>
                <span className="text-slate-400">→</span>
                <span className="whitespace-nowrap rounded bg-play-green/20 px-1 font-mono text-emerald-700">
                  {fmtDiffValue(entry.after)}
                </span>
              </>
            ) : entry.kind === "added" ? (
              <span className="whitespace-nowrap rounded bg-play-green/20 px-1 font-mono text-emerald-700">
                + {fmtDiffValue(entry.after)}
              </span>
            ) : (
              <span className="whitespace-nowrap rounded bg-brand/10 px-1 font-mono text-brand">
                − {fmtDiffValue(entry.before)}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One-level key/value rendering of a JSON detail block. */
function DetailBlock({
  title,
  value,
}: {
  title: string;
  value: unknown;
}) {
  if (value === null || value === undefined) return null;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</p>
      <dl className="mt-1 grid grid-cols-[10rem_1fr] gap-x-3 gap-y-0.5 text-xs">
        {entries.map(([key, val]) => (
          <div key={key} className="col-span-2 grid grid-cols-[10rem_1fr] gap-x-3">
            <dt className="break-all text-slate-500">{key}</dt>
            <dd className="break-all font-mono text-slate-700">
              {typeof val === "object" && val !== null
                ? JSON.stringify(val)
                : String(val)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function AuditRow({
  event,
  expanded,
  onToggle,
  actorName,
  t,
}: {
  event: AuditEventView;
  expanded: boolean;
  onToggle: () => void;
  actorName?: string;
  t: (key: string) => string;
}) {
  const hasDetail =
    event.before !== null || event.after !== null || event.metadata !== null;
  const actionLabel = t(`auditActions.${event.action}`);
  return (
    <>
      <tr
        className="cursor-pointer border-b border-ink/5 transition-colors last:border-0 hover:bg-pill"
        onClick={onToggle}
      >
        <td className="px-4 py-2.5 text-slate-500">
          {new Date(event.createdAt).toLocaleString()}
        </td>
        <td className="px-3 py-2.5">
          {event.actorType === "system" ? (
            <span className="text-slate-400">{t("audit.actorSystem")}</span>
          ) : (
            (actorName ?? event.actorId?.slice(0, 8) ?? "—")
          )}
        </td>
        <td className="px-3 py-2.5">
          <Badge tone={actionTone(event.action)}>
            {actionLabel === `auditActions.${event.action}` ? event.action : actionLabel}
          </Badge>
        </td>
        <td className="px-3 py-2.5">
          {objectLabel(t, event.objectType)}
          {event.objectId ? (
            <span className="ml-1 font-mono text-xs text-slate-400">
              {event.objectId.slice(0, 8)}
            </span>
          ) : null}
        </td>
        <td className="px-3 py-2.5 text-right text-slate-400">
          {hasDetail ? (expanded ? "▲" : "▼") : ""}
        </td>
      </tr>
      {expanded ? (
        <tr className="border-b border-ink/5 bg-pill">
          <td colSpan={5} className="px-6 py-3">
            <div className="space-y-3">
              <DiffSection before={event.before} after={event.after} label={t("audit.changes")} />
              <DetailBlock title={t("audit.detailMeta")} value={event.metadata} />
              <details>
                <summary className="cursor-pointer text-xs text-slate-400">
                  {t("audit.fullBeforeAfter")}
                </summary>
                <div className="mt-2 space-y-3">
                  <DetailBlock title={t("audit.detailAfter")} value={event.after} />
                  <DetailBlock title={t("audit.detailBefore")} value={event.before} />
                </div>
              </details>
            </div>
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-slate-400">
                {t("audit.rawData")}
              </summary>
              <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-ink p-3 text-xs text-slate-100">
                {JSON.stringify(
                  {
                    actorId: event.actorId,
                    before: event.before,
                    after: event.after,
                    metadata: event.metadata,
                  },
                  null,
                  2,
                )}
              </pre>
            </details>
          </td>
        </tr>
      ) : null}
    </>
  );
}
