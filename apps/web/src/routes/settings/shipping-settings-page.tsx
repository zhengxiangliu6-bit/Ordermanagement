import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouteLoaderData } from "react-router";
import { useTranslation } from "react-i18next";
import { api } from "../../api-client/client";
import type { rootLoader } from "../../layouts/root-loader";

interface ShippingSettings {
  externalTimezone: string;
  initialSyncPolicy: string;
  revisionSyncPolicy: string;
  ownSiteTrackingUrlTemplate: string | null;
  schedule: {
    fixedTime?: string | null;
    windowStart?: string | null;
    windowEnd?: string | null;
    daysOfWeek?: number[] | null;
    workdaysOnly?: boolean;
  };
}

interface StoreRow {
  id: string;
  displayName: string;
  shippingPolicyOverride: { initial?: string; revision?: string } | null;
  settings: {
    dataSource?: string;
    trackingJump?: { mode?: string; customUrlTemplate?: string | null };
  } | null;
}

const TRACKING_JUMP_MODES = [
  { value: "inherit", labelKey: "shipments.jumpModeInherit" },
  { value: "custom", labelKey: "shipments.jumpModeCustom" },
  { value: "carrier", labelKey: "shipments.jumpModeCarrier" },
] as const;

const POLICY_OPTIONS = [
  { value: "immediate", labelKey: "shipments.policyImmediate" },
  { value: "scheduled", labelKey: "shipments.policyScheduled" },
  {
    value: "review_then_immediate",
    labelKey: "shipments.policyReviewThenImmediate",
  },
  {
    value: "review_then_scheduled",
    labelKey: "shipments.policyReviewThenScheduled",
  },
] as const;

const WEEKDAY_KEYS = [
  "weekdays.sun",
  "weekdays.mon",
  "weekdays.tue",
  "weekdays.wed",
  "weekdays.thu",
  "weekdays.fri",
  "weekdays.sat",
];

/**
 * Outbound shipment policy settings (§12.7/§12.8): global defaults, the one
 * External Timezone, the schedule window, and per-Store overrides.
 */
export default function ShippingSettingsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const root = useRouteLoaderData<typeof rootLoader>("root");
  const canManage =
    !!root?.user.permissions.includes("shipping:manage-settings") ||
    !!root?.user.permissions.includes("*");
  const [error, setError] = useState<string | null>(null);

  const settings = useQuery({
    queryKey: ["shipping-settings"],
    queryFn: async () => {
      const { data, response } = await api.GET("/api/v1/shipping-settings");
      if (!response.ok || !data) throw new Error(`${response.status}`);
      return data as unknown as ShippingSettings;
    },
  });

  const stores = useQuery({
    queryKey: ["stores"],
    queryFn: async () => {
      const { data, response } = await api.GET("/api/v1/stores");
      if (!response.ok || !data) return [] as StoreRow[];
      return data as unknown as StoreRow[];
    },
  });

  const [draft, setDraft] = useState<ShippingSettings | null>(null);
  useEffect(() => {
    if (settings.data && !draft) setDraft(settings.data);
  }, [settings.data, draft]);

  const save = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const { response } = await api.PATCH("/api/v1/shipping-settings", {
        body: payload as never,
      });
      if (!response.ok) throw new Error(`${response.status}`);
    },
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["shipping-settings"] });
    },
    onError: (e: Error) => setError(t("shipments.settingsSaveFailed", { status: e.message })),
  });

  const saveStoreOverride = useMutation({
    mutationFn: async (input: { storeId: string; override: Record<string, string> | null }) => {
      const { response } = await api.PATCH("/api/v1/stores/{id}", {
        params: { path: { id: input.storeId } },
        body: { shippingPolicyOverride: input.override } as never,
      });
      if (!response.ok) throw new Error(`${response.status}`);
    },
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["stores"] });
    },
    onError: (e: Error) => setError(t("shipments.settingsSaveFailed", { status: e.message })),
  });

  // settings is replaced wholesale on PATCH: always spread the store's
  // existing settings (e.g. the relay dataSource marker) before writing
  // the tracking-jump slice.
  const saveTrackingJump = useMutation({
    mutationFn: async (input: {
      storeId: string;
      settings: Record<string, unknown>;
      trackingJump: Record<string, unknown> | null;
    }) => {
      const { response } = await api.PATCH("/api/v1/stores/{id}", {
        params: { path: { id: input.storeId } },
        body: {
          settings: {
            ...input.settings,
            trackingJump: input.trackingJump,
          },
        } as never,
      });
      if (!response.ok) throw new Error(`${response.status}`);
    },
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["stores"] });
    },
    onError: (e: Error) =>
      setError(t("shipments.trackingJumpSaveFailed", { status: e.message })),
  });

  const changeTrackingJumpMode = (store: StoreRow, mode: string) => {
    const trackingJump =
      mode === "custom"
        ? {
            mode,
            customUrlTemplate:
              store.settings?.trackingJump?.customUrlTemplate ?? "https://track.example.com/{number}",
          }
        : { mode };
    saveTrackingJump.mutate({
      storeId: store.id,
      settings: store.settings ?? {},
      trackingJump,
    });
  };

  const changeTrackingJumpTemplate = (store: StoreRow, template: string) => {
    const trimmed = template.trim();
    if (!trimmed.includes("{number}")) return; // {number} placeholder required
    saveTrackingJump.mutate({
      storeId: store.id,
      settings: store.settings ?? {},
      trackingJump: { mode: "custom", customUrlTemplate: trimmed },
    });
  };

  if (!draft) {
    return <p className="text-sm text-slate-400">{t("common.loading")}</p>;
  }

  const patchSchedule = (patch: Partial<ShippingSettings["schedule"]>) => {
    setDraft({
      ...draft,
      schedule: { ...draft.schedule, ...patch },
    });
  };

  const toggleWeekday = (day: number) => {
    const current = draft.schedule.daysOfWeek ?? [];
    const next = current.includes(day)
      ? current.filter((d) => d !== day)
      : [...current, day].sort();
    patchSchedule({ daysOfWeek: next.length === 0 ? null : next });
  };

  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-semibold">{t("shipments.settingsTitle")}</h1>
      {error ? (
        <p className="mt-2 text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}

      <section className="mt-4 rounded border border-slate-200 bg-white p-4">
        <h2 className="text-base font-semibold">
          {t("shipments.settingsGlobalTitle")}
        </h2>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <label className="text-sm">
            <span className="text-slate-500">{t("shipments.policyInitial")}</span>
            <select
              value={draft.initialSyncPolicy}
              disabled={!canManage}
              onChange={(e) => setDraft({ ...draft, initialSyncPolicy: e.target.value })}
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 disabled:bg-slate-100"
            >
              {POLICY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {t(option.labelKey)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="text-slate-500">{t("shipments.policyRevision")}</span>
            <select
              value={draft.revisionSyncPolicy}
              disabled={!canManage}
              onChange={(e) => setDraft({ ...draft, revisionSyncPolicy: e.target.value })}
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 disabled:bg-slate-100"
            >
              {POLICY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {t(option.labelKey)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="text-slate-500">{t("shipments.timezoneLabel")}</span>
            <input
              value={draft.externalTimezone}
              disabled={!canManage}
              onChange={(e) => setDraft({ ...draft, externalTimezone: e.target.value })}
              placeholder="Asia/Shanghai"
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 font-mono text-xs disabled:bg-slate-100"
            />
          </label>
          <label className="text-sm">
            <span className="text-slate-500">{t("shipments.ownSiteTemplateLabel")}</span>
            <input
              value={draft.ownSiteTrackingUrlTemplate ?? ""}
              disabled={!canManage}
              onChange={(e) =>
                setDraft({ ...draft, ownSiteTrackingUrlTemplate: e.target.value || null })
              }
              placeholder="https://track.attaky.com/{number}"
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 font-mono text-xs disabled:bg-slate-100"
            />
            <span className="mt-0.5 block text-xs text-slate-400">
              {t("shipments.ownSiteTemplateHint")}
            </span>
          </label>
        </div>

        <h3 className="mt-4 text-sm font-semibold">{t("shipments.scheduleTitle")}</h3>
        <div className="mt-2 grid gap-3 md:grid-cols-3">
          <label className="text-sm">
            <span className="text-slate-500">{t("shipments.fixedTime")}</span>
            <input
              value={draft.schedule.fixedTime ?? ""}
              disabled={!canManage}
              onChange={(e) =>
                patchSchedule({ fixedTime: e.target.value || null })
              }
              placeholder="17:30"
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 font-mono text-xs disabled:bg-slate-100"
            />
          </label>
          <label className="text-sm">
            <span className="text-slate-500">{t("shipments.windowStart")}</span>
            <input
              value={draft.schedule.windowStart ?? ""}
              disabled={!canManage}
              onChange={(e) => patchSchedule({ windowStart: e.target.value || null })}
              placeholder="09:00"
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 font-mono text-xs disabled:bg-slate-100"
            />
          </label>
          <label className="text-sm">
            <span className="text-slate-500">{t("shipments.windowEnd")}</span>
            <input
              value={draft.schedule.windowEnd ?? ""}
              disabled={!canManage}
              onChange={(e) => patchSchedule({ windowEnd: e.target.value || null })}
              placeholder="18:00"
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 font-mono text-xs disabled:bg-slate-100"
            />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={draft.schedule.workdaysOnly ?? false}
              disabled={!canManage}
              onChange={(e) => patchSchedule({ workdaysOnly: e.target.checked })}
            />
            {t("shipments.workdaysOnly")}
          </label>
          {WEEKDAY_KEYS.map((key, day) => (
            <label key={key} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={(draft.schedule.daysOfWeek ?? []).includes(day)}
                disabled={!canManage}
                onChange={() => toggleWeekday(day)}
              />
              {t(key)}
            </label>
          ))}
        </div>

        {canManage ? (
          <button
            type="button"
              onClick={() =>
                save.mutate({
                  initialSyncPolicy: draft.initialSyncPolicy,
                  revisionSyncPolicy: draft.revisionSyncPolicy,
                  externalTimezone: draft.externalTimezone,
                  ownSiteTrackingUrlTemplate:
                    draft.ownSiteTrackingUrlTemplate?.trim() || null,
                  schedule: draft.schedule,
                })
              }
            className="mt-4 rounded bg-slate-800 px-3 py-1.5 text-sm text-white hover:bg-slate-700"
          >
            {t("shipments.settingsSave")}
          </button>
        ) : null}
      </section>

      <section className="mt-4 rounded border border-slate-200 bg-white p-4">
        <h2 className="text-base font-semibold">
          {t("shipments.storeOverridesTitle")}
        </h2>
        <p className="mt-1 text-xs text-slate-400">
          {t("shipments.storeOverridesHint")}
        </p>
        <div className="mt-3 space-y-2">
          {(stores.data ?? []).map((store) => {
            const jump = store.settings?.trackingJump;
            const jumpMode = jump?.mode ?? "attaky";
            return (
            <div
              key={store.id}
              className="rounded border border-slate-100 px-3 py-2 text-sm"
            >
              <div className="grid items-center gap-2 md:grid-cols-[1fr_auto_auto]">
                <span className="break-words font-medium">{store.displayName}</span>
                {(["initial", "revision"] as const).map((kind) => (
                  <select
                    key={kind}
                    disabled={!canManage}
                    value={store.shippingPolicyOverride?.[kind] ?? ""}
                    onChange={(e) =>
                      saveStoreOverride.mutate({
                        storeId: store.id,
                        override:
                          e.target.value === ""
                            ? null
                            : {
                                ...(store.shippingPolicyOverride ?? {}),
                                [kind]: e.target.value,
                            },
                      })
                    }
                    className="rounded border border-slate-300 px-2 py-1 text-xs disabled:bg-slate-100"
                  >
                    <option value="">
                      {t(kind === "initial" ? "shipments.policyInitial" : "shipments.policyRevision")}
                      : {t("shipments.useGlobal")}
                    </option>
                    {POLICY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {t(option.labelKey)}
                      </option>
                    ))}
                  </select>
                ))}
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <span className="text-xs text-slate-400">
                  {t("shipments.trackingJumpLabel")}
                </span>
                <select
                  disabled={!canManage}
                  value={jumpMode}
                  onChange={(e) => changeTrackingJumpMode(store, e.target.value)}
                  className="rounded border border-slate-300 px-2 py-1 text-xs disabled:bg-slate-100"
                  aria-label={t("shipments.trackingJumpLabel")}
                >
                  {TRACKING_JUMP_MODES.map((option) => (
                    <option key={option.value} value={option.value}>
                      {t(option.labelKey)}
                    </option>
                  ))}
                </select>
                {jumpMode === "custom" ? (
                  <input
                    type="text"
                    defaultValue={jump?.customUrlTemplate ?? ""}
                    disabled={!canManage}
                    onBlur={(e) => changeTrackingJumpTemplate(store, e.target.value)}
                    placeholder="https://track.example.com/{number}"
                    className="max-w-full flex-1 rounded border border-slate-300 px-2 py-1 font-mono text-xs disabled:bg-slate-100 sm:w-96"
                    aria-label={t("shipments.trackingJumpTemplateLabel")}
                  />
                ) : null}
              </div>
            </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
