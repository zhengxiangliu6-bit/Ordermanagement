import type { ReactNode } from "react";
import { useRouteLoaderData } from "react-router";
import type { rootLoader } from "../layouts/root-loader";
import { AccessDeniedPage } from "./access-denied";

/**
 * Gate for permission-scoped pages: renders the page only when the
 * signed-in principal holds the required permission key, otherwise shows
 * the access-denied view with an account switch action.
 */
export function RequirePermission({
  permission,
  children,
}: {
  permission: string;
  children: ReactNode;
}) {
  const data = useRouteLoaderData<typeof rootLoader>("root");
  const allowed = !!data?.user.permissions.includes(permission);
  if (!allowed) {
    return <AccessDeniedPage requiredPermission={permission} />;
  }
  return <>{children}</>;
}
