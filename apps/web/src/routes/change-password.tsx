import { useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { api } from "../api-client/client";

/**
 * Forced password change after an administrator-issued one-time password.
 * The session is restricted to this page (and /me, logout) until the change
 * completes.
 */
export default function ChangePasswordPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (form: HTMLFormElement) => {
    const formData = new FormData(form);
    const currentPassword = String(formData.get("currentPassword") ?? "");
    const newPassword = String(formData.get("newPassword") ?? "");
    const confirm = String(formData.get("confirm") ?? "");

    if (newPassword !== confirm) {
      setError(t("changePassword.mismatch"));
      return;
    }
    setBusy(true);
    setError(null);
    const { response } = await api.POST("/api/v1/users/me/change-password", {
      body: { currentPassword, newPassword },
    });
    setBusy(false);
    if (!response.ok) {
      setError(
        response.status === 401
          ? t("changePassword.currentIncorrect")
          : t("changePassword.failed", { status: response.status }),
      );
      return;
    }
    navigate("/", { replace: true });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-lg font-semibold">{t("changePassword.title")}</h1>
        <p className="mt-1 text-sm text-slate-500">{t("changePassword.intro")}</p>
        <form
          className="mt-6 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit(event.currentTarget);
          }}
        >
          <div>
            <label htmlFor="current" className="block text-sm font-medium text-slate-700">
              {t("changePassword.currentPassword")}
            </label>
            <input
              id="current"
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              required
              minLength={8}
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="new" className="block text-sm font-medium text-slate-700">
              {t("changePassword.newPassword")}
            </label>
            <input
              id="new"
              name="newPassword"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="confirm" className="block text-sm font-medium text-slate-700">
              {t("changePassword.confirmPassword")}
            </label>
            <input
              id="confirm"
              name="confirm"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
            />
          </div>
          {error ? (
            <p className="text-sm text-red-600" role="alert">
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {busy ? t("changePassword.saving") : t("changePassword.saveAndContinue")}
          </button>
        </form>
      </div>
    </div>
  );
}
