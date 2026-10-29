import type { ReactNode } from "react";
import { useRouteLoaderData } from "react-router";
import type { rootLoader } from "../layouts/root-loader";
import { AccessDeniedPage } from "./access-denied";

/**
 * Gate for permission-scoped pages: renders the page only when the
 * signed-in principal holds the required permission key, otherwise shows
 * the access-denied view with an account switch action. Pass either a
 * single `permission` or an `anyOf` list (at least one must be granted).
 */
export function RequirePermission({
  permission,
  anyOf,
  children,
}: {
  permission?: string;
  anyOf?: string[];
  children: ReactNode;
}) {
  const data = useRouteLoaderData<typeof rootLoader>("root");
  const granted = data?.user.permissions ?? [];
  const allowed = permission
    ? granted.includes(permission)
    : anyOf
      ? anyOf.some((key) => granted.includes(key))
      : true;
  if (!allowed) {
    return (
      <AccessDeniedPage requiredPermission={permission ?? anyOf?.join(" / ") ?? ""} />
    );
  }
  return <>{children}</>;
}
