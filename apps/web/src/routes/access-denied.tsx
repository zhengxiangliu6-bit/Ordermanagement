import { useNavigate, useRouteLoaderData } from "react-router";
import { useTranslation } from "react-i18next";
import { api } from "../api-client/client";
import type { rootLoader } from "../layouts/root-loader";

/**
 * Rendered when the signed-in account lacks the permission a page needs.
 * The backend remains the authorization boundary; this is UX only.
 */
export function AccessDeniedPage({ requiredPermission }: { requiredPermission: string }) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const data = useRouteLoaderData<typeof rootLoader>("root");

  const switchAccount = async () => {
    await api.POST("/api/v1/auth/logout");
    navigate("/login", { replace: true });
  };

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-2xl">
          🚫
        </div>
        <h1 className="mt-4 text-lg font-semibold">{t("accessDenied.title")}</h1>
        <p className="mt-2 text-sm text-slate-600">
          {t("accessDenied.body")}
          {data?.user.displayName ? (
            <>
              {" "}
              (<span className="font-medium">{data.user.displayName}</span>)
            </>
          ) : null}
        </p>
        <p className="mt-1 font-mono text-xs text-slate-400">
          {t("accessDenied.required", { permission: requiredPermission })}
        </p>
        <div className="mt-6 flex justify-center gap-3 text-sm">
          <button
            type="button"
            onClick={() => navigate("/")}
            className="rounded border border-slate-300 px-3 py-1.5 hover:bg-slate-100"
          >
            {t("accessDenied.backToDashboard")}
          </button>
          <button
            type="button"
            onClick={switchAccount}
            className="rounded bg-slate-900 px-3 py-1.5 font-medium text-white hover:bg-slate-800"
          >
            {t("accessDenied.switchAccount")}
          </button>
        </div>
      </div>
    </div>
  );
}
