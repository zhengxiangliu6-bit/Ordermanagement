import { useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { loginAction } from "./login-action";

export default function LoginPage() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-screen items-center justify-center bg-ink px-4">
      <div className="w-full max-w-sm pop-shadow rounded-xl bg-white p-8">
        <h1 className="font-display text-2xl text-ink">
          ATTAKY <span className="text-brand">OM</span>
        </h1>
        <p className="mt-1 text-sm text-slate-500">{t("auth.signInToContinue")}</p>
        <LoginForm />
      </div>
    </div>
  );
}

function LoginForm() {
  const fetcher = useFetcher<typeof loginAction>();
  const { t } = useTranslation();
  const submitting = fetcher.state !== "idle";
  const errorText =
    fetcher.data && "errorKey" in fetcher.data
      ? t(fetcher.data.errorKey)
      : null;

  return (
    <fetcher.Form method="post" className="mt-6 space-y-4">
      <div>
        <label
          htmlFor="email"
          className="block text-sm font-medium text-slate-700"
        >
          {t("auth.email")}
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          className="mt-1 w-full rounded-lg border border-ink/20 bg-white px-3 py-2 text-sm focus:border-ink/50 focus:outline-none"
        />
      </div>
      <div>
        <label
          htmlFor="password"
          className="block text-sm font-medium text-slate-700"
        >
          {t("auth.password")}
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          minLength={8}
          className="mt-1 w-full rounded-lg border border-ink/20 bg-white px-3 py-2 text-sm focus:border-ink/50 focus:outline-none"
        />
      </div>
      {errorText ? (
        <p className="text-sm text-red-600" role="alert">
          {errorText}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
      >
        {submitting ? t("auth.signingIn") : t("auth.signIn")}
      </button>
    </fetcher.Form>
  );
}
