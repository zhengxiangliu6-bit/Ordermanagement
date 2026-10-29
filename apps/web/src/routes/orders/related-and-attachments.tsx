import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Card } from "../../components/ui";
import { useRouteLoaderData } from "react-router";
import type { rootLoader } from "../../layouts/root-loader";
import { api } from "../../api-client/client";
import type {
  AttachmentView,
  OrderView,
  RelatedResponse,
  SuggestedOrder,
} from "../../types/order";

function customerName(snapshot: Record<string, unknown> | null): string {
  return String(snapshot?.name ?? snapshot?.email ?? "—");
}

/** Related orders (§17): manual links + normalized-field suggestions. */
export function RelatedOrdersSection({ order }: { order: OrderView }) {
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const root = useRouteLoaderData<typeof rootLoader>("root");
  const permissions = new Set(root?.user.permissions ?? []);
  const canLink = permissions.has("customers:link");
  const [error, setError] = useState<string | null>(null);

  const related = useQuery({
    queryKey: ["order-related", order.id],
    queryFn: async () => {
      const { data, response } = await api.GET("/api/v1/orders/{id}/related", {
        params: { path: { id: order.id } },
      });
      if (!response.ok || !data) throw new Error(`Load failed (${response.status})`);
      return data as unknown as RelatedResponse;
    },
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["order-related", order.id] });

  const link = async (relatedOrderId: string) => {
    setError(null);
    const { response } = await api.POST("/api/v1/orders/{id}/links", {
      params: { path: { id: order.id } },
      body: { relatedOrderId },
    });
    if (!response.ok) {
      setError(`Linking failed (${response.status}).`);
      return;
    }
    await refresh();
  };

  const unlink = async (linkId: string) => {
    setError(null);
    const { response } = await api.DELETE("/api/v1/orders/{id}/links/{linkId}", {
      params: { path: { id: order.id, linkId } },
    });
    if (!response.ok) {
      setError(`Unlinking failed (${response.status}).`);
      return;
    }
    await refresh();
  };

  return (
    <Card title={t("orders.relatedOrders")}>
      {error ? <p className="mt-1 text-sm text-red-600" role="alert">{error}</p> : null}
      {related.isLoading ? (
        <p className="mt-2 text-sm text-slate-400">{t("common.loading")}</p>
      ) : (
        <>
          <div className="mt-3">
            <span className="text-sm font-medium text-slate-700">{t("orders.manuallyLinked")}</span>
            <ul className="mt-1 space-y-1">
              {(related.data?.manual ?? []).map((entry) => (
                <li key={entry.linkId} className="flex items-center justify-between rounded border border-slate-200 bg-white px-3 py-1.5 text-sm">
                  <span>
                    <span className="font-mono text-xs">{entry.displayNumber}</span> ·{" "}
                    {customerName(entry.customerSnapshot)}
                  </span>
                  {canLink ? (
                    <button type="button" onClick={() => unlink(entry.linkId)} className="text-slate-500 hover:text-red-600">
                      {t("orders.unlink")}
                    </button>
                  ) : null}
                </li>
              ))}
              {(related.data?.manual ?? []).length === 0 ? (
                <li className="text-sm text-slate-400">{t("orders.noneLinkedYet")}</li>
              ) : null}
            </ul>
          </div>
          <SuggestionList
            label={t("orders.strongSuggestions")}
            orders={related.data?.suggestions.strong ?? []}
            onLink={link}
            canLink={canLink}
          />
          <SuggestionList
            label={t("orders.weakSuggestions")}
            orders={related.data?.suggestions.weak ?? []}
            onLink={link}
            canLink={canLink}
          />
        </>
      )}
    </Card>
  );
}

function SuggestionList({
  label,
  orders,
  onLink,
  canLink,
}: {
  label: string;
  orders: SuggestedOrder[];
  onLink: (orderId: string) => Promise<void>;
  canLink: boolean;
}) {
  const { t } = useTranslation();
  if (orders.length === 0) return null;
  return (
    <div className="mt-3">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <ul className="mt-1 space-y-1">
        {orders.map((suggestion) => (
          <li key={suggestion.orderId} className="flex items-center justify-between rounded border border-slate-200 bg-white px-3 py-1.5 text-sm">
            <span>
              <span className="font-mono text-xs">{suggestion.displayNumber}</span> ·{" "}
              {customerName(suggestion.customerSnapshot)} ·{" "}
              <span className="text-slate-400">
                {new Date(suggestion.createdAt).toLocaleDateString()}
              </span>
            </span>
            {canLink ? (
              <button type="button" onClick={() => void onLink(suggestion.orderId)} className="text-slate-600 hover:text-slate-900">
                {t("orders.link")}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Attachments for any attachment-capable owner (§16.4). */
export function AttachmentsSection({
  ownerType,
  ownerId,
}: {
  ownerType: string;
  ownerId: string;
}) {
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const root = useRouteLoaderData<typeof rootLoader>("root");
  const permissions = new Set(root?.user.permissions ?? []);
  const canUpload = permissions.has("attachments:upload");
  const canDelete = permissions.has("attachments:delete");
  const canOpen = permissions.has("attachments:open");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const attachments = useQuery({
    queryKey: ["attachments", ownerType, ownerId],
    queryFn: async () => {
      const { data, response } = await api.GET("/api/v1/attachments", {
        params: { query: { ownerType, ownerId } },
      });
      if (!response.ok || !data) throw new Error(`List failed (${response.status})`);
      return data as unknown as AttachmentView[];
    },
  });

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["attachments", ownerType, ownerId] });

  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    const formData = new FormData();
    formData.append("ownerType", ownerType);
    formData.append("ownerId", ownerId);
    formData.append("file", file);
    const { response } = await api.POST("/api/v1/attachments", {
      body: formData as never,
    });
    setBusy(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (!response.ok) {
      setError(`Upload failed (${response.status}).`);
      return;
    }
    await refresh();
  };

  const remove = async (attachmentId: string) => {
    if (!window.confirm(t("orders.deleteAttachmentConfirm"))) return;
    setBusy(true);
    const { response } = await api.DELETE("/api/v1/attachments/{id}", {
      params: { path: { id: attachmentId } },
    });
    setBusy(false);
    if (!response.ok) {
      setError(`Delete failed (${response.status}).`);
      return;
    }
    await refresh();
  };

  return (
    <Card title={t("orders.attachments")}>
      {canUpload ? (
        <div className="mt-2">
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
            }}
            disabled={busy}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => fileInputRef.current?.click()}
            className="rounded-lg border border-ink/20 bg-white px-2.5 py-1 text-sm font-medium hover:bg-pill disabled:opacity-40"
          >
            {busy ? t("orders.uploading") : t("orders.uploadAttachment")}
          </button>
        </div>
      ) : null}
      {error ? <p className="mt-1 text-sm text-red-600" role="alert">{error}</p> : null}
      <ul className="mt-3 space-y-1">
        {(attachments.data ?? []).map((attachment) => (
          <li key={attachment.id} className="flex items-center justify-between rounded border border-slate-200 bg-white px-3 py-1.5 text-sm">
            {canOpen ? (
              <a
                href={`/api/v1/attachments/${attachment.id}/download`}
                className="text-slate-700 hover:underline"
              >
                {attachment.filename}
              </a>
            ) : (
              <span className="text-slate-700">{attachment.filename}</span>
            )}
            <span className="flex items-center gap-3 text-xs text-slate-400">
              {attachment.sizeBytes ?? "?"} bytes ·{" "}
              {new Date(attachment.createdAt).toLocaleString()}
              {canDelete ? (
                <button type="button" disabled={busy} onClick={() => remove(attachment.id)} className="hover:text-red-600 disabled:opacity-40">
                  {t("common.delete")}
                </button>
              ) : null}
            </span>
          </li>
        ))}
        {attachments.data && attachments.data.length === 0 ? (
          <li className="text-sm text-slate-400">{t("orders.noAttachments")}</li>
        ) : null}
      </ul>
    </Card>
  );
}
