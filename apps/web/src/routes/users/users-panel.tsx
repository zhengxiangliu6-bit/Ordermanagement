import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useRouteLoaderData } from "react-router";
import { Modal } from "../../components/modal";
import { api } from "../../api-client/client";
import { buttonClasses } from "../../components/ui";
import type { rootLoader } from "../../layouts/root-loader";
import type { RoleRow } from "./roles-panel";

interface UserView {
  id: string;
  email: string;
  displayName: string;
  isActive: boolean;
  mustChangePassword: boolean;
  roleKeys: string[];
  roleNames: string[];
}

/** Account list with role assignment, activation, and password resets. */
export function UsersPanel() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const data = useRouteLoaderData<typeof rootLoader>("root");
  const permissions = new Set(data?.user.permissions ?? []);
  const canCreate = permissions.has("users:create");
  const canManage = permissions.has("users:manage");
  const canDelete = permissions.has("users:delete");
  const [creating, setCreating] = useState(false);
  const [issuedPassword, setIssuedPassword] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"" | "active" | "disabled" | "must-change">("");
  const [roleKey, setRoleKey] = useState("");
  const [editingRoles, setEditingRoles] = useState<UserView | null>(null);
  const [editRoleKeys, setEditRoleKeys] = useState<Set<string>>(new Set());
  const [editRolesError, setEditRolesError] = useState<string | null>(null);

  const users = useQuery({
    queryKey: ["users", { status, roleKey }],
    queryFn: async () => {
      const { data, response } = await api.GET("/api/v1/users", {
        params: { query: { status: status || undefined, roleKey: roleKey || undefined } },
      });
      if (!response.ok || !data) throw new Error(`List failed (${response.status})`);
      return data as unknown as UserView[];
    },
  });

  const roles = useQuery({
    queryKey: ["roles"],
    queryFn: async () => {
      const { data, response } = await api.GET("/api/v1/users/roles");
      if (!response.ok || !data) throw new Error(`Roles failed (${response.status})`);
      return data as unknown as RoleRow[];
    },
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["users"] });

  const createUser = async (form: HTMLFormElement) => {
    const formData = new FormData(form);
    setError(null);
    const selectedRoleKeys = roles.data
      ?.filter((role) => formData.get(`role-${role.key}`) === "on")
      .map((role) => role.key);
    const { data, response } = await api.POST("/api/v1/users", {
      body: {
        email: String(formData.get("email") ?? "").trim(),
        name: String(formData.get("name") ?? "").trim(),
        roleKeys: selectedRoleKeys && selectedRoleKeys.length > 0 ? selectedRoleKeys : ["staff"],
      },
    });
    if (!response.ok || !data) {
      setError(t("users.createUserFailed", { status: response.status }));
      return;
    }
    setCreating(false);
    await refresh();
    // The one-time temporary password is shown exactly once.
    setIssuedPassword((data as { temporaryPassword: string }).temporaryPassword);
  };

  const setActive = async (userId: string, isActive: boolean) => {
    setError(null);
    const { response } = await api.POST("/api/v1/users/{id}/set-active", {
      params: { path: { id: userId } },
      body: { isActive },
    });
    if (!response.ok) {
      setError(
        t("users.actionFailed", {
          action: isActive ? t("users.enable") : t("users.disable"),
          status: response.status,
        }),
      );
      return;
    }
    await refresh();
  };

  const resetPassword = async (userId: string) => {
    if (!window.confirm(t("users.resetConfirm"))) return;
    setError(null);
    const { data, response } = await api.POST("/api/v1/users/{id}/reset-password", {
      params: { path: { id: userId } },
    });
    if (!response.ok || !data) {
      setError(t("users.actionFailed", { action: t("users.resetPassword"), status: response.status }));
      return;
    }
    setIssuedPassword((data as { temporaryPassword: string }).temporaryPassword);
  };

  const deleteUser = async (user: UserView) => {
    if (!window.confirm(t("users.deleteConfirm", { name: user.displayName }))) return;
    setError(null);
    const { response } = await api.DELETE("/api/v1/users/{id}", {
      params: { path: { id: user.id } },
    });
    if (!response.ok) {
      setError(
        response.status === 409
          ? t("users.deleteBlocked")
          : t("users.deleteFailed", { status: response.status }),
      );
      return;
    }
    await refresh();
  };

  const startEditRoles = (user: UserView) => {
    setEditingRoles(user);
    setEditRoleKeys(new Set(user.roleKeys));
    setEditRolesError(null);
  };

  const toggleEditRole = (key: string) => {
    setEditRoleKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const saveRoles = async () => {
    if (!editingRoles) return;
    setEditRolesError(null);
    const { data, response } = await api.POST("/api/v1/users/{id}/roles", {
      params: { path: { id: editingRoles.id } },
      body: { roleKeys: [...editRoleKeys] },
    });
    if (!response.ok) {
      const detail = (data as unknown as { message?: string })?.message;
      setEditRolesError(detail ?? t("users.rolesSaveFailed", { status: response.status }));
      return;
    }
    setEditingRoles(null);
    await refresh();
  };

  const roleLabel = (user: UserView, index: number) =>
    user.roleNames[index] || t(`roles.${user.roleKeys[index]}`, user.roleKeys[index]);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl leading-tight text-ink">{t("users.title")}</h1>
        {canCreate ? (
          <button
            type="button"
            onClick={() => setCreating((value) => !value)}
            className={buttonClasses.primary}
          >
            {creating ? t("common.cancel") : t("users.newUser")}
          </button>
        ) : null}
      </div>
      <p className="mt-1 text-sm text-slate-500">
        {t("users.newUserIntro")}
      </p>

      {issuedPassword ? (
        <div className="mt-4 rounded border border-amber-300 bg-amber-50 p-4 text-sm">
          <p className="font-medium text-amber-900">{t("users.oneTimePasswordTitle")}</p>
          <p className="mt-1 font-mono text-base">{issuedPassword}</p>
          <p className="mt-1 text-amber-800">{t("users.oneTimePasswordCopy")}</p>
          <button
            type="button"
            onClick={() => setIssuedPassword(null)}
            className="mt-2 rounded border border-amber-400 px-2.5 py-1 hover:bg-amber-100"
          >
            {t("users.iHaveSavedIt")}
          </button>
        </div>
      ) : null}

      {creating ? (
        <Modal title={t("users.newUser")} onClose={() => setCreating(false)}>
        <form
          className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-2 text-sm"
          onSubmit={(event) => {
            event.preventDefault();
            void createUser(event.currentTarget);
          }}
        >
          <label htmlFor="user-email" className="self-center font-medium">{t("users.email")}</label>
          <input id="user-email" name="email" type="email" required className="rounded-lg border border-ink/20 bg-white px-2 py-1.5" />
          <label htmlFor="user-name" className="self-center font-medium">{t("users.name")}</label>
          <input id="user-name" name="name" required className="rounded-lg border border-ink/20 bg-white px-2 py-1.5" />
          <span className="self-center font-medium">{t("users.roles")}</span>
          <div className="flex flex-col gap-1">
            {(roles.data ?? []).map((role) => (
              <label key={role.key} className="flex items-center gap-2">
                <input type="checkbox" name={`role-${role.key}`} defaultChecked={role.key === "staff"} />
                {role.name}{" "}
                <span className="text-slate-400">({role.key})</span>
              </label>
            ))}
          </div>
          {error ? <div /> : <p className="text-sm text-red-600" role="alert">{error}</p>}
          <div />
          <button type="submit" className="justify-self-start rounded bg-slate-700 px-3 py-1.5 text-white hover:bg-slate-600">
            {t("users.createUser")}
          </button>
        </form>
        </Modal>
      ) : null}

      {error && !creating ? (
        <p className="mt-3 text-sm text-red-600" role="alert">{error}</p>
      ) : null}

      <div className="mt-4 flex items-center gap-4 text-sm">
        <select
          value={status}
          onChange={(event) =>
            setStatus(event.target.value as "" | "active" | "disabled" | "must-change")
          }
          className="rounded-lg border border-ink/20 bg-white px-2 py-1.5"
        >
          <option value="">{t("users.allStatuses")}</option>
          <option value="active">{t("users.statusActive")}</option>
          <option value="must-change">{t("users.statusMustChange")}</option>
          <option value="disabled">{t("users.statusDisabled")}</option>
        </select>
        <select
          value={roleKey}
          onChange={(event) => setRoleKey(event.target.value)}
          className="rounded-lg border border-ink/20 bg-white px-2 py-1.5"
        >
          <option value="">{t("users.allRoles")}</option>
          {(roles.data ?? []).map((role) => (
            <option key={role.key} value={role.key}>{role.name}</option>
          ))}
        </select>
      </div>

      <div className="mt-3 overflow-x-auto rounded-xl border border-ink/10 pop-shadow-sm">
      <table className="w-full border-collapse bg-white text-sm">
        <thead>
          <tr className="border-b border-ink/10 text-left text-xs uppercase tracking-wide text-slate-400">
            <th className="px-4 py-2.5 font-semibold">{t("users.name")}</th>
            <th className="px-4 py-2.5 font-semibold">{t("users.email")}</th>
            <th className="px-4 py-2.5 font-semibold">{t("users.roles")}</th>
            <th className="px-4 py-2.5 font-semibold">{t("users.allStatuses")}</th>
            <th className="px-4 py-2.5 font-semibold"></th>
          </tr>
        </thead>
        <tbody>
          {users.isLoading ? (
            <tr><td colSpan={5} className="px-3 py-6 text-slate-400">{t("common.loading")}</td></tr>
          ) : users.isError ? (
            <tr><td colSpan={5} className="px-3 py-6 text-red-600">{(users.error as Error).message}</td></tr>
          ) : users.data && users.data.length > 0 ? (
            users.data.map((user) => (
              <tr key={user.id} className="border-b border-slate-100">
                <td className="px-4 py-2.5 font-semibold">{user.displayName}</td>
                <td className="px-3 py-2 text-slate-500">{user.email}</td>
                <td className="px-3 py-2">
                  {user.roleKeys.map((key, index) => roleLabel(user, index)).join("、") || "—"}
                </td>
                <td className="px-3 py-2">
                  {!user.isActive ? (
                    <span className="text-red-700">{t("users.statusDisabled")}</span>
                  ) : user.mustChangePassword ? (
                    <span className="text-amber-700">{t("users.statusMustChange")}</span>
                  ) : (
                    <span className="text-emerald-700">{t("users.statusActive")}</span>
                  )}
                </td>
                <td className="px-4 py-2 text-right">
                  <span className="flex justify-end gap-3">
                    {canManage ? (
                      <>
                        <button
                          type="button"
                          onClick={() => startEditRoles(user)}
                          className="text-slate-500 hover:text-slate-800"
                        >
                          {t("users.editRoles")}
                        </button>
                        <button
                          type="button"
                          onClick={() => resetPassword(user.id)}
                          className="text-slate-500 hover:text-slate-800"
                        >
                          {t("users.resetPassword")}
                        </button>
                        {user.isActive ? (
                          <button
                            type="button"
                            onClick={() => setActive(user.id, false)}
                            className="text-red-600 hover:text-red-800"
                          >
                            {t("users.disable")}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setActive(user.id, true)}
                            className="text-slate-500 hover:text-slate-800"
                          >
                            {t("users.enable")}
                          </button>
                        )}
                      </>
                    ) : null}
                    {canDelete && user.id !== data?.user.id ? (
                      <button
                        type="button"
                        onClick={() => void deleteUser(user)}
                        className="text-red-600 hover:text-red-800"
                      >
                        {t("users.delete")}
                      </button>
                    ) : null}
                  </span>
                </td>
              </tr>
            ))
          ) : (
            <tr><td colSpan={5} className="px-3 py-6 text-slate-400">{t("users.noUsersFound")}</td></tr>
          )}
        </tbody>
      </table>
      </div>

      {editingRoles ? (
        <Modal
          title={t("users.editRolesTitle", { name: editingRoles.displayName })}
          onClose={() => setEditingRoles(null)}
        >
          <div className="space-y-3">
            <div className="flex flex-col gap-1">
              {(roles.data ?? []).map((role) => (
                <label key={role.key} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={editRoleKeys.has(role.key)}
                    onChange={() => toggleEditRole(role.key)}
                  />
                  {role.name}
                  <span className="text-slate-400">({role.key})</span>
                </label>
              ))}
            </div>
            {editRolesError ? (
              <p className="text-sm text-red-600" role="alert">{editRolesError}</p>
            ) : null}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingRoles(null)}
                className={buttonClasses.secondary}
              >
                {t("common.cancel")}
              </button>
              <button type="button" onClick={() => void saveRoles()} className={buttonClasses.primary}>
                {t("common.save")}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
