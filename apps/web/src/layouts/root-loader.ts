import { redirect } from "react-router";
import { expandPermissions } from "@om/shared";
import { api } from "../api-client/client";
import type { AuthUser } from "../api-client/types";

/**
 * Session gate for the application shell: resolve /auth/me or bounce to the
 * login page. The returned user is consumed by RootLayout via
 * useRouteLoaderData("root"). The wildcard (locked admin role) is expanded
 * into the concrete permission list for the Set-based nav lookups.
 */
export async function rootLoader(): Promise<{ user: AuthUser } | Response> {
  const { data, response } = await api.GET("/api/v1/auth/me");
  // A user with a forced password change may only visit the change page.
  // /auth/me itself stays reachable (200), so the flag drives the redirect.
  if (response.status === 403 || (data as { mustChangePassword?: boolean } | undefined)?.mustChangePassword) {
    throw redirect("/change-password");
  }
  if (!response.ok || !data) {
    throw redirect("/login");
  }
  return { user: { ...data, permissions: expandPermissions(data.permissions) } };
}
