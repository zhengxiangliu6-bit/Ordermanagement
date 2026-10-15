import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../../api-client/client";

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

export default function AuditPage() {
  const { t } = useTranslation();
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
      <h1 className="text-xl font-semibold">{t("audit.title")}</h1>
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
          className="rounded border border-slate-300 px-2 py-1"
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
          className="w-52 rounded border border-slate-300 px-2 py-1"
        />
        <input
          value={actorId}
          onChange={(event) => {
            setActorId(event.target.value);
            setPage(1);
          }}
          placeholder={t("audit.actorId")}
          className="w-52 rounded border border-slate-300 px-2 py-1"
        />
        <span className="text-slate-500">{t("audit.from")}</span>
        <input
          type="date"
          value={dateFrom}
          onChange={(event) => {
            setDateFrom(event.target.value);
            setPage(1);
          }}
          className="rounded border border-slate-300 px-2 py-1"
        />
        <span className="text-slate-500">{t("audit.to")}</span>
        <input
          type="date"
          value={dateTo}
          onChange={(event) => {
            setDateTo(event.target.value);
            setPage(1);
          }}
          className="rounded border border-slate-300 px-2 py-1"
        />
      </div>

      <table className="mt-3 w-full border-collapse bg-white text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-slate-500">
            <th className="px-3 py-2 font-medium">{t("audit.time")}</th>
            <th className="px-3 py-2 font-medium">{t("audit.actor")}</th>
            <th className="px-3 py-2 font-medium">{t("audit.action")}</th>
            <th className="px-3 py-2 font-medium">{t("audit.object")}</th>
            <th className="px-3 py-2 font-medium"></th>
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

function AuditRow({
  event,
  expanded,
  onToggle,
}: {
  event: AuditEventView;
  expanded: boolean;
  onToggle: () => void;
}) {
  const hasDetail =
    event.before !== null || event.after !== null || event.metadata !== null;
  return (
    <>
      <tr
        className="cursor-pointer border-b border-slate-100 hover:bg-slate-50"
        onClick={onToggle}
      >
        <td className="px-3 py-2 text-slate-500">
          {new Date(event.createdAt).toLocaleString()}
        </td>
        <td className="px-3 py-2">
          {event.actorType === "system"
            ? "system"
            : (event.actorId?.slice(0, 12) ?? "—")}
        </td>
        <td className="px-3 py-2 font-mono text-xs">{event.action}</td>
        <td className="px-3 py-2">
          {event.objectType}
          {event.objectId ? (
            <span className="text-slate-400"> · {event.objectId.slice(0, 8)}</span>
          ) : null}
        </td>
        <td className="px-3 py-2 text-right text-slate-400">
          {hasDetail ? (expanded ? "▲" : "▼") : ""}
        </td>
      </tr>
      {expanded ? (
        <tr className="border-b border-slate-100 bg-slate-50">
          <td colSpan={5} className="px-6 py-3">
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-slate-900 p-3 text-xs text-slate-100">
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
          </td>
        </tr>
      ) : null}
    </>
  );
}
