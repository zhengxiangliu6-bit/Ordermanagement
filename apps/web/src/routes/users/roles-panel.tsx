import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useRouteLoaderData } from "react-router";
import { Modal } from "../../components/modal";
import { Card, Badge, EmptyState, buttonClasses } from "../../components/ui";
import { api } from "../../api-client/client";
import type { rootLoader } from "../../layouts/root-loader";
import { PermissionMatrix } from "./permission-matrix";

export interface RoleRow {
  id: string;
  key: string;
  name: string;
  permissions: string[];
  userCount: number;
  locked: boolean;
}

const TEMPLATE_KEYS = new Set(["supervisor", "packer", "placer", "inspector"]);
const BUILTIN_KEYS = new Set(["admin", "staff"]);

function roleType(key: string): "builtin" | "template" | "custom" {
  if (BUILTIN_KEYS.has(key)) return "builtin";
  if (TEMPLATE_KEYS.has(key)) return "template";
  return "custom";
}

/**
 * Role management (M7 R7): list / create / edit / delete custom roles.
 * The administrator role is locked (wildcard permissions) and cannot be
 * edited or deleted here.
 */
export function RolesPanel() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const data = useRouteLoaderData<typeof rootLoader>("root");
  const canManage = new Set(data?.user.permissions ?? []).has("users:manage");
  const [editing, setEditing] = useState<RoleRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formPerms, setFormPerms] = useState<Set<string>>(new Set());

  const roles = useQuery({
    queryKey: ["roles"],
    queryFn: async () => {
      const { data, response } = await api.GET("/api/v1/users/roles");
      if (!response.ok || !data) throw new Error(`List failed (${response.status})`);
      return data as unknown as RoleRow[];
    },
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["roles"] });

  const startCreate = () => {
    setCreating(true);
    setEditing(null);
    setFormName("");
    setFormPerms(new Set());
    setError(null);
  };

  const startEdit = (role: RoleRow) => {
    setEditing(role);
    setCreating(false);
    setFormName(role.name);
    setFormPerms(new Set(role.permissions));
    setError(null);
  };

  const closeForm = () => {
    setCreating(false);
    setEditing(null);
    setError(null);
  };

  const save = async () => {
    setError(null);
    const name = formName.trim();
    if (!name) {
      setError(t("roles.nameRequired"));
      return;
    }
    const body = { name, permissions: [...formPerms] };
    const { data, response } = editing
      ? await api.PATCH("/api/v1/users/roles/{id}", {
          params: { path: { id: editing.id } },
          body: body as never,
        })
      : await api.POST("/api/v1/users/roles", { body: body as never });
    if (!response.ok) {
      const detail = (data as unknown as { message?: string })?.message;
      setError(detail ?? t("roles.saveFailed", { status: response.status }));
      return;
    }
    closeForm();
    await refresh();
  };

  const remove = async (role: RoleRow) => {
    if (!window.confirm(t("roles.deleteConfirm", { name: role.name }))) return;
    const { data, response } = await api.DELETE("/api/v1/users/roles/{id}", {
      params: { path: { id: role.id } },
    });
    if (!response.ok) {
      const detail = (data as unknown as { message?: string })?.message;
      window.alert(detail ?? t("roles.deleteFailed", { status: response.status }));
      return;
    }
    await refresh();
  };

  const showForm = creating || editing !== null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl leading-tight text-ink">{t("roles.pageTitle")}</h1>
          <p className="mt-1 text-sm text-slate-500">{t("roles.intro")}</p>
        </div>
        {canManage ? (
          <button
            type="button"
            onClick={showForm ? closeForm : startCreate}
            className={showForm ? buttonClasses.secondary : buttonClasses.primary}
          >
            {showForm ? t("common.cancel") : t("roles.newRole")}
          </button>
        ) : null}
      </div>

      {roles.isLoading ? (
        <Card><p className="text-sm text-slate-400">{t("common.loading")}</p></Card>
      ) : roles.isError ? (
        <p className="text-sm text-red-600" role="alert">{(roles.error as Error).message}</p>
      ) : roles.data && roles.data.length > 0 ? (
        <Card className="overflow-hidden">
          <div className="-m-4 overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-ink/10 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="px-4 py-2.5 font-semibold">{t("roles.name")}</th>
                  <th className="px-3 py-2.5 font-semibold">{t("roles.type")}</th>
                  <th className="px-3 py-2.5 font-semibold">{t("roles.permCount")}</th>
                  <th className="px-3 py-2.5 font-semibold">{t("roles.userCount")}</th>
                  <th className="px-3 py-2.5 font-semibold"></th>
                </tr>
              </thead>
              <tbody>
                {roles.data.map((role) => (
                  <tr key={role.id} className="border-b border-ink/5 transition-colors last:border-0 hover:bg-pill">
                    <td className="px-4 py-2.5 font-medium text-ink">
                      {role.name}
                      <span className="ml-2 font-mono text-xs text-slate-400">{role.key}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      {role.locked ? (
                        <Badge tone="info">{t("roles.typeBuiltin")}</Badge>
                      ) : roleType(role.key) === "builtin" ? (
                        <Badge tone="neutral">{t("roles.typeBuiltin")}</Badge>
                      ) : roleType(role.key) === "template" ? (
                        <Badge tone="success">{t("roles.typeTemplate")}</Badge>
                      ) : (
                        <Badge tone="neutral">{t("roles.typeCustom")}</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs">
                      {role.locked ? t("roles.allPermissions") : role.permissions.length}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs">{role.userCount}</td>
                    <td className="px-3 py-2.5 text-right">
                      {role.locked ? (
                        <span className="text-xs text-slate-400">{t("roles.lockedHint")}</span>
                      ) : canManage ? (
                        <span className="flex justify-end gap-1">
                          <button type="button" onClick={() => startEdit(role)} className={buttonClasses.ghost}>
                            {t("common.edit")}
                          </button>
                          <button type="button" onClick={() => void remove(role)} className={buttonClasses.danger}>
                            {t("common.delete")}
                          </button>
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <EmptyState message={t("roles.empty")} />
      )}

      {showForm ? (
        <Modal
          title={editing ? t("roles.editRole", { name: editing.name }) : t("roles.newRole")}
          onClose={closeForm}
        >
          <div className="space-y-3">
            <div>
              <label htmlFor="role-name" className="block text-xs font-medium text-slate-500">
                {t("roles.name")}
              </label>
              <input
                id="role-name"
                value={formName}
                onChange={(event) => setFormName(event.target.value)}
                className="mt-1 w-full rounded-lg border border-ink/20 bg-white px-2 py-1.5"
              />
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">{t("roles.permissions")}</p>
              <p className="mt-0.5 text-xs text-slate-400">{t("roles.permissionsHint")}</p>
              <div className="mt-2">
                <PermissionMatrix value={formPerms} onChange={setFormPerms} />
              </div>
            </div>
            {error ? (
              <p className="text-sm text-red-600" role="alert">{error}</p>
            ) : null}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={closeForm} className={buttonClasses.secondary}>
                {t("common.cancel")}
              </button>
              <button type="button" onClick={() => void save()} className={buttonClasses.primary}>
                {t("common.save")}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
