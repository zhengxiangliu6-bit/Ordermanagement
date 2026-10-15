import { useRouteError } from "react-router";
import { useTranslation } from "react-i18next";

/**
 * Route-level error boundary: keeps failures inside the app shell with an
 * actionable fallback instead of the framework's plain error page.
 */
export function RouteErrorBoundary() {
  const error = useRouteError();
  const { t } = useTranslation();
  const message =
    error instanceof Error ? error.message : "An unexpected error occurred.";
  return (
    <div className="p-6">
      <h1 className="text-lg font-semibold text-red-700">{t("errorBoundary.title")}</h1>
      <p className="mt-2 text-sm text-slate-600">{message}</p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="mt-4 rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100"
      >
        {t("errorBoundary.reload")}
      </button>
    </div>
  );
}
