import { redirect } from "react-router";
import { api } from "../api-client/client";

export async function loginAction({ request }: { request: Request }) {
  const form = await request.formData();
  const email = String(form.get("email") ?? "");
  const password = String(form.get("password") ?? "");

  const { data, response } = await api.POST("/api/v1/auth/login", {
    body: { email, password },
  });
  if (!response.ok || !data) {
    // Translation happens in the component; the action only reports the kind.
    return {
      errorKey:
        response.status === 401
          ? "auth.invalidCredentials"
          : "auth.signInFailed",
    };
  }
  return redirect("/");
}
