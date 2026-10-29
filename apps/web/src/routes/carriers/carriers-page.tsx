import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../../api-client/client";
import { buttonClasses } from "../../components/ui";
import { Modal } from "../../components/modal";

interface CarrierView {
  id: string;
  key: string;
  name: string;
  enabled: boolean;
  recognition: {
    regexes: string[];
    normalization?: { stripSpaces?: boolean; uppercase?: boolean };
  };
  trackingUrlTemplate: string | null;
  crossBorder: boolean;
  orderUrlTemplate: string | null;
  attakyTransform: {
    rules: Array<{ pattern: string; replacement: string }>;
    version: number;
  } | null;
}

interface PreviewResult {
  kind: "single" | "ambiguous" | "none";
  preview?: {
    carrierKey: string;
    normalizedNumber: string;
    attakyTrackingNumber: string | null;
    attakyTrackingUrl: string | null;
    carrierTrackingUrl: string | null;
  };
  storeLinks?: Array<{ storeId: string; displayName: string; mode: string; link: string | null }>;
  carrierKeys?: string[];
}

/** Simple-mode form: plain-language fields, regex is generated for the user. */
const EMPTY_SIMPLE = {
  key: "",
  name: "",
  enabled: true,
  prefix: "",
  digitCount: 13,
  stripSpaces: true,
  uppercase: true,
  urlTemplate: "",
  crossBorder: false,
  orderUrl: "",
  attakyPrefix: "ATK-",
  takeFirst: 3,
  takeLast: 4,
  version: 1,
  sample: "",
};

type SimpleForm = typeof EMPTY_SIMPLE;

export function buildRecognitionRegex(prefix: string, digitCount: number): string {
  const p = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return `^${p}\\d{${digitCount}}$`;
}

export function buildTransform(
  prefix: string,
  takeFirst: number,
  takeLast: number,
  digitCount: number,
): { pattern: string; replacement: string } | null {
  if (!prefix.trim()) return null;
  // Keeping more digits than the number has would make the pattern
  // unmatchable — reject instead of generating a silent no-op transform.
  if (takeFirst + takeLast > digitCount) return null;
  // Optional letter prefix (e.g. "SF"), then keep-first digits, a skipped
  // middle, and keep-last digits; the replacement references the kept groups.
  const first = takeFirst > 0 ? `(\\d{${takeFirst}})` : "";
  const last = takeLast > 0 ? `(\\d{${takeLast}})` : "";
  const kept = [first, last].filter(Boolean);
  const refs = kept.map((_, index) => `$${index + 1}`).join("");
  // The skipped middle is any run of digits between the kept groups.
  return {
    pattern: `^(?:[A-Za-z]+)?${first}\\d*${last}$`,
    replacement: `${prefix}${refs}`,
  };
}

function toSimple(carrier: CarrierView): SimpleForm {
  const regex = carrier.recognition.regexes[0] ?? "";
  const prefixMatch = regex.match(/\^([A-Za-z]+)\\d\{/);
  const digitsMatch = regex.match(/\\d\{(\d+)\}\$/);
  const transform = carrier.attakyTransform?.rules[0];
  // Parse simple "(\\d{X})... (\\d{Y})$" shapes back into take-first/last.
  let takeFirst = 0;
  let takeLast = 0;
  let attakyPrefix = "";
  if (transform) {
    const g1 = transform.pattern.match(/\(\\d\{(\d+)\}\)/);
    const g2 = transform.pattern.match(/\(\\d\{(\d+)\}\)\$/);
    takeFirst = g1 ? Number(g1[1]) : 0;
    takeLast = g2 ? Number(g2[1]) : 0;
    attakyPrefix = transform.replacement.replace(/\$\d/g, "");
  }
  return {
    key: carrier.key,
    name: carrier.name,
    enabled: carrier.enabled,
    prefix: prefixMatch ? prefixMatch[1] : "",
    digitCount: digitsMatch ? Number(digitsMatch[1]) : 13,
    stripSpaces: carrier.recognition.normalization?.stripSpaces ?? false,
    uppercase: carrier.recognition.normalization?.uppercase ?? false,
    urlTemplate: carrier.trackingUrlTemplate ?? "",
    crossBorder: carrier.crossBorder ?? false,
    orderUrl: carrier.orderUrlTemplate ?? "",
    attakyPrefix: attakyPrefix || "ATK-",
    takeFirst,
    takeLast,
    version: (carrier.attakyTransform?.version ?? 0) + 1,
    sample: "",
  };
}

function toPayload(form: SimpleForm) {
  const transform = buildTransform(
    form.attakyPrefix,
    form.takeFirst,
    form.takeLast,
    form.digitCount,
  );
  return {
    key: form.key.trim(),
    name: form.name.trim(),
    enabled: form.enabled,
    recognition: {
      regexes: [buildRecognitionRegex(form.prefix.trim(), form.digitCount)],
      normalization: { stripSpaces: form.stripSpaces, uppercase: form.uppercase },
    },
    trackingUrlTemplate: form.urlTemplate.trim() || null,
    crossBorder: form.crossBorder,
    orderUrlTemplate: form.orderUrl.trim() || null,
    attakyTransform: transform
      ? { rules: [transform], version: Math.max(1, form.version) }
      : null,
  };
}

export default function CarriersPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<SimpleForm>(EMPTY_SIMPLE);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [previewInput, setPreviewInput] = useState("");
  const [previewResult, setPreviewResult] = useState<PreviewResult | null>(null);
  const [collisionSamples, setCollisionSamples] = useState("");
  const [collisionResult, setCollisionResult] = useState<string | null>(null);

  const carriers = useQuery({
    queryKey: ["carriers"],
    queryFn: async () => {
      const { data, response } = await api.GET("/api/v1/carriers");
      if (!response.ok || !data) return [] as CarrierView[];
      return data as unknown as CarrierView[];
    },
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["carriers"] });

  const save = useMutation({
    mutationFn: async () => {
      const payload = toPayload(form);
      if (editingId) {
        const { response } = await api.PATCH("/api/v1/carriers/{id}", {
          params: { path: { id: editingId } },
          body: payload as never,
        });
        if (!response.ok) {
          const body = (await response.json()) as { message?: string };
          throw new Error(body.message ?? `Save failed (${response.status}).`);
        }
        return;
      }
      const { response } = await api.POST("/api/v1/carriers", {
        body: payload as never,
      });
      if (!response.ok) {
        const body = (await response.json()) as { message?: string };
        throw new Error(body.message ?? `Create failed (${response.status}).`);
      }
    },
    onSuccess: async () => {
      setError(null);
      setNotice(editingId ? t("carriers.saved") : t("carriers.created"));
      setForm(EMPTY_SIMPLE);
      setEditingId(null);
      setDialogOpen(false);
      await refresh();
    },
    onError: (e: Error) => {
      setNotice(null);
      setError(e.message);
    },
  });

  const runPreview = async () => {
    setError(null);
    const { data, response } = await api.POST("/api/v1/carriers/preview", {
      body: { trackingNumber: previewInput },
    });
    if (!response.ok || !data) {
      setError(t("carriers.previewFailed", { status: response.status }));
      return;
    }
    setPreviewResult(data as unknown as PreviewResult);
  };

  const runCollisions = async (carrierId: string) => {
    const samples = collisionSamples
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    if (samples.length === 0) {
      setCollisionResult(t("carriers.collisionNeedSamples"));
      return;
    }
    const { data, response } = await api.POST(
      "/api/v1/carriers/{id}/collisions",
      { params: { path: { id: carrierId } }, body: { samples } },
    );
    if (!response.ok || !data) {
      setCollisionResult(t("carriers.collisionFailed", { status: response.status }));
      return;
    }
    const collisions = data as Array<{ a: string; b: string; attakyNumber: string }>;
    setCollisionResult(
      collisions.length === 0
        ? t("carriers.collisionClean")
        : collisions.map((c) => t("carriers.collisionRow", c)).join("\n"),
    );
  };

  const set = <K extends keyof SimpleForm>(key: K, value: SimpleForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const closeDialog = () => {
    setDialogOpen(false);
    setEditingId(null);
    setForm(EMPTY_SIMPLE);
  };

  // Keeping more digits than the number has would silently disable the
  // transform; surface it and block saving instead (plain-language rule).
  const keepDigitsInvalid =
    form.attakyPrefix.trim().length > 0 &&
    form.takeFirst + form.takeLast > form.digitCount;

  /** Live preview inside the dialog: simulate recognition + transform locally. */
  const livePreview = useMemo(() => {
    if (!form.sample.trim() || !form.prefix.trim()) return null;
    let normalized = form.sample.trim();
    if (form.stripSpaces) normalized = normalized.replace(/\s+/g, "");
    if (form.uppercase) normalized = normalized.toUpperCase();
    const regex = new RegExp(buildRecognitionRegex(form.prefix, form.digitCount));
    if (!regex.test(normalized)) return { matched: false, normalized };
    const transform = buildTransform(
      form.attakyPrefix,
      form.takeFirst,
      form.takeLast,
      form.digitCount,
    );
    const attaky = transform ? normalized.replace(new RegExp(transform.pattern), transform.replacement) : null;
    return { matched: true, normalized, attaky };
  }, [form]);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl leading-tight text-ink">{t("carriers.title")}</h1>
        <button
          type="button"
          onClick={() => {
            setEditingId(null);
            setForm(EMPTY_SIMPLE);
            setError(null);
            setNotice(null);
            setDialogOpen(true);
          }}
          className={buttonClasses.primary}
        >
          {t("carriers.newButton")}
        </button>
      </div>

      {error ? (
        <p className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="mt-3 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {notice}
        </p>
      ) : null}

      {/* Recognition test */}
      <section className="mt-4 rounded border border-slate-200 bg-white p-4">
        {/* Recognition smoke test: paste a raw number, see carrier + public result. */}
        <h2 className="text-sm font-semibold text-slate-700">{t("carriers.previewTitle")}</h2>
        <div className="mt-2 flex gap-2">
          <input
            value={previewInput}
            onChange={(e) => setPreviewInput(e.target.value)}
            placeholder="SF1234567890123"
            className="w-72 rounded-lg border border-ink/20 px-2 py-1 text-sm"
          />
          <button
            type="button"
            disabled={!previewInput.trim()}
            onClick={() => void runPreview()}
            className={buttonClasses.primary}
          >
            {t("carriers.previewRun")}
          </button>
        </div>
        {previewResult ? (
          <div className="mt-2 text-sm">
            {previewResult.kind === "single" && previewResult.preview ? (
              <dl className="grid grid-cols-[10rem_1fr] gap-x-2 gap-y-0.5 text-xs text-slate-600">
                <dt className="font-medium">{t("carriers.matchedCarrier")}</dt>
                <dd>{previewResult.preview.carrierKey}</dd>
                <dt className="font-medium">{t("carriers.normalized")}</dt>
                <dd className="font-mono">{previewResult.preview.normalizedNumber}</dd>
                <dt className="font-medium">{t("carriers.attakyNumber")}</dt>
                <dd className="font-mono">{previewResult.preview.attakyTrackingNumber ?? "—"}</dd>
                <dt className="font-medium">{t("carriers.carrierUrl")}</dt>
                <dd className="truncate font-mono">{previewResult.preview.carrierTrackingUrl ?? "—"}</dd>
                <dt className="font-medium">{t("carriers.perStoreLinks")}</dt>
                <dd className="w-full">
                  {(previewResult.storeLinks ?? []).length === 0 ? (
                    <span className="text-slate-400">{t("carriers.perStoreNoStores")}</span>
                  ) : (
                    <table className="w-full border-collapse">
                      <tbody>
                        {(previewResult.storeLinks ?? []).map(
                          (store: { storeId: string; displayName: string; mode: string; link: string | null }) => (
                            <tr key={store.storeId} className="border-b border-slate-100 last:border-0">
                              <td className="py-0.5 pr-2 font-medium">{store.displayName}</td>
                              <td className="py-0.5 pr-2 text-slate-500">
                                {previewResult.preview?.attakyTrackingNumber == null
                                  ? t("carriers.modeOfficial")
                                  : t(
                                      store.mode === "custom"
                                        ? "shipments.jumpModeCustom"
                                        : store.mode === "carrier"
                                          ? "shipments.jumpModeCarrier"
                                          : "shipments.jumpModeInherit",
                                    )}
                              </td>
                              <td className="py-0.5 font-mono">{store.link ?? "—"}</td>
                            </tr>
                          ),
                        )}
                      </tbody>
                    </table>
                  )}
                </dd>
              </dl>
            ) : previewResult.kind === "ambiguous" ? (
              <p className="text-xs text-amber-700">
                {t("carriers.ambiguous", { carriers: previewResult.carrierKeys?.join(", ") ?? "" })}
              </p>
            ) : (
              <p className="text-xs text-slate-500">{t("carriers.noMatch")}</p>
            )}
          </div>
        ) : null}
      </section>

      {/* Carrier list */}
      <section className="mt-4 rounded border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-700">{t("carriers.listTitle")}</h2>
        <table className="mt-2 w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
              <th className="py-1.5 pr-2 font-medium">{t("carriers.name")}</th>
              <th className="py-1.5 pr-2 font-medium">{t("carriers.key")}</th>
              <th className="py-1.5 pr-2 font-medium">{t("carriers.enabled")}</th>
              <th className="py-1.5 pr-2 font-medium">{t("carriers.ruleSummary")}</th>
              <th className="py-1.5 font-medium" />
            </tr>
          </thead>
          <tbody>
            {(carriers.data ?? []).map((carrier) => (
              <tr key={carrier.id} className="border-b border-slate-100">
                <td className="py-1.5 pr-2">{carrier.name}</td>
                <td className="py-1.5 pr-2 font-mono text-xs">{carrier.key}</td>
                <td className="py-1.5 pr-2">{carrier.enabled ? t("common.yes") : t("common.no")}</td>
                <td className="py-1.5 pr-2 text-xs text-slate-600">
                  {summarizeRule(carrier)}
                </td>
                <td className="py-1.5 text-right">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(carrier.id);
                      setForm(toSimple(carrier));
                      setError(null);
                      setNotice(null);
                      setDialogOpen(true);
                    }}
                    className="rounded-lg border border-ink/20 px-2 py-0.5 text-xs hover:bg-pill"
                  >
                    {t("common.edit")}
                  </button>
                </td>
              </tr>
            ))}
            {carriers.data && carriers.data.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-4 text-sm text-slate-400">
                  {t("carriers.noneYet")}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>

        {/* Collision tester */}
        <div className="mt-3 rounded-xl border border-dashed border-ink/20 bg-pill p-3">
          {/* Collision test: distinct originals must not map to one public number. */}
          <div className="text-xs font-medium text-slate-600">{t("carriers.collisionTitle")}</div>
          <textarea
            value={collisionSamples}
            onChange={(e) => setCollisionSamples(e.target.value)}
            rows={3}
            placeholder={"SF1112223334444\nSF1119998887777"}
            className="mt-2 w-full rounded-lg border border-ink/20 px-2 py-1 font-mono text-xs"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            {(carriers.data ?? []).map((carrier) => (
              <button
                key={carrier.id}
                type="button"
                onClick={() => void runCollisions(carrier.id)}
                className="rounded-lg border border-ink/20 bg-white px-2 py-0.5 text-xs hover:bg-pill"
              >
                {t("carriers.collisionRunFor", { name: carrier.name })}
              </button>
            ))}
          </div>
          {collisionResult ? (
            <pre className="mt-2 whitespace-pre-wrap rounded bg-white p-2 text-xs text-slate-700">
              {collisionResult}
            </pre>
          ) : null}
        </div>
      </section>

      {/* Create / edit dialog */}
      {dialogOpen ? (
        <Modal
          title={editingId ? t("carriers.editTitle") : t("carriers.createTitle")}
          onClose={closeDialog}
        >
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-xs text-slate-600">
              {t("carriers.name")}
              <input
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="SF Express"
                className="mt-1 w-full rounded-lg border border-ink/20 bg-white px-2 py-1.5 text-sm"
              />
            </label>
            <label className="text-xs text-slate-600">
              {t("carriers.key")}
              <input
                value={form.key}
                onChange={(e) => set("key", e.target.value)}
                placeholder="sf-express"
                className="mt-1 w-full rounded-lg border border-ink/20 bg-white px-2 py-1.5 text-sm"
              />
            </label>

            <fieldset className="rounded-xl border border-ink/10 bg-white p-3 md:col-span-2 pop-shadow-sm">
              {/* Plain-language rule: prefix + digit count generates the regex. */}
              <legend className="px-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {t("carriers.recognitionTitle")}
              </legend>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-600">
                <label>
                  {t("carriers.prefix")}
                  <input
                    value={form.prefix}
                    onChange={(e) => set("prefix", e.target.value.toUpperCase())}
                    placeholder="SF"
                    className="ml-1 w-24 rounded-lg border border-ink/20 bg-white px-2 py-1.5 font-mono"
                  />
                </label>
                <label>
                  {t("carriers.digitCount")}
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={form.digitCount}
                    onChange={(e) => set("digitCount", Number(e.target.value))}
                    className="ml-1 w-20 rounded-lg border border-ink/20 bg-white px-2 py-1.5"
                  />
                </label>
                <label className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={form.stripSpaces}
                    onChange={(e) => set("stripSpaces", e.target.checked)}
                  />
                  {t("carriers.stripSpaces")}
                </label>
                <label className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={form.uppercase}
                    onChange={(e) => set("uppercase", e.target.checked)}
                  />
                  {t("carriers.uppercase")}
                </label>
              </div>
              <p className="mt-2 rounded-lg bg-pill px-2.5 py-1.5 text-xs text-slate-500">
                {t("carriers.recognitionPreview", {
                  prefix: form.prefix || "?",
                  count: form.digitCount,
                })}
              </p>
            </fieldset>

            <fieldset className="rounded-xl border border-ink/10 bg-white p-3 md:col-span-2 pop-shadow-sm">
              {/* Public number: prefix + keep-first/last digit runs; live sample preview below. */}
              <legend className="px-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {t("carriers.transformTitle")}
              </legend>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-600">
                <label>
                  {t("carriers.attakyPrefix")}
                  <input
                    value={form.attakyPrefix}
                    onChange={(e) => set("attakyPrefix", e.target.value)}
                    className="ml-1 w-28 rounded-lg border border-ink/20 px-2 py-1 font-mono"
                  />
                </label>
                <label>
                  {t("carriers.takeFirst")}
                  <input
                    type="number"
                    min={0}
                    max={15}
                    value={form.takeFirst}
                    onChange={(e) => set("takeFirst", Number(e.target.value))}
                    className="ml-1 w-16 rounded-lg border border-ink/20 bg-white px-2 py-1.5"
                  />
                </label>
                <label>
                  {t("carriers.takeLast")}
                  <input
                    type="number"
                    min={0}
                    max={15}
                    value={form.takeLast}
                    onChange={(e) => set("takeLast", Number(e.target.value))}
                    className="ml-1 w-16 rounded-lg border border-ink/20 bg-white px-2 py-1.5"
                  />
                </label>
                {keepDigitsInvalid ? (
                  <p className="text-xs text-red-600" role="alert">
                    {t("carriers.keepDigitsInvalid", { count: form.digitCount })}
                  </p>
                ) : null}
              </div>
              <label className="mt-3 block text-xs text-slate-600">
                {t("carriers.sample")}
                <input
                  value={form.sample}
                  onChange={(e) => set("sample", e.target.value)}
                  placeholder="SF1234567890123"
                  className="mt-1 w-72 rounded-lg border border-ink/20 bg-white px-2 py-1.5 font-mono text-xs"
                />
              </label>
              {livePreview ? (
                <div className="mt-2 rounded-lg bg-pill px-2.5 py-2 text-xs">
                  {livePreview.matched ? (
                    <p className="text-slate-700">
                      {t("carriers.liveMatched", {
                        normalized: livePreview.normalized,
                        attaky: livePreview.attaky ?? "—",
                      })}
                    </p>
                  ) : (
                    <p className="text-amber-700">
                      {t("carriers.liveNotMatched", { normalized: livePreview.normalized })}
                    </p>
                  )}
                </div>
              ) : null}
            </fieldset>

            <label className="text-xs text-slate-600 md:col-span-2">
              {t("carriers.urlTemplate")}
              <input
                value={form.urlTemplate}
                onChange={(e) => set("urlTemplate", e.target.value)}
                placeholder="https://www.sf-express.com/track/{number}"
                className="mt-1 w-full rounded-lg border border-ink/20 px-2 py-1 font-mono text-xs"
              />
            </label>
            <label className="text-xs text-slate-600 md:col-span-2">
              {t("carriers.orderUrl")}
              <input
                value={form.orderUrl}
                onChange={(e) => set("orderUrl", e.target.value)}
                placeholder="https://carrier.example.com/order"
                className="mt-1 w-full rounded-lg border border-ink/20 px-2 py-1 font-mono text-xs"
              />
            </label>
            <label className="flex items-center gap-1 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={form.crossBorder}
                onChange={(e) => set("crossBorder", e.target.checked)}
              />
              {t("carriers.crossBorder")}
            </label>
            <label className="flex items-center gap-1 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(e) => set("enabled", e.target.checked)}
              />
              {t("carriers.enabled")}
            </label>
          </div>

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              disabled={
                !form.key.trim() ||
                !form.name.trim() ||
                !form.prefix.trim() ||
                keepDigitsInvalid ||
                save.isPending
              }
              onClick={() => save.mutate()}
              className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {editingId ? t("carriers.save") : t("carriers.create")}
            </button>
            <button
              type="button"
              onClick={closeDialog}
              className="rounded-lg border border-ink/20 px-3 py-1.5 text-sm hover:bg-pill"
            >
              {t("common.cancel")}
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

/** Human summary of an existing carrier's recognition rule. */
function summarizeRule(carrier: CarrierView): string {
  const regex = carrier.recognition.regexes[0] ?? "";
  const prefix = regex.match(/\^([A-Za-z]+)\\d/)?.[1];
  const digits = regex.match(/\\d\{(\d+)\}/)?.[1];
  if (prefix && digits) return `${prefix} + ${digits} digits`;
  return regex || "—";
}
