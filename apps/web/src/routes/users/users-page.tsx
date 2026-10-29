import { useState } from "react";
import { useTranslation } from "react-i18next";
import { UsersPanel } from "./users-panel";
import { RolesPanel } from "./roles-panel";

/**
 * Users & roles administration (M7 R7): the users tab manages accounts and
 * their role assignments; the roles tab manages the roles themselves.
 */
export default function UsersPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"users" | "roles">("users");

  return (
    <div>
      <div className="mb-4 flex gap-1 border-b border-ink/10" role="tablist">
        {(["users", "roles"] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm transition-colors ${
              tab === value
                ? "border-brand font-medium text-ink"
                : "border-transparent text-slate-500 hover:text-ink"
            }`}
          >
            {t(value === "users" ? "users.tabUsers" : "users.tabRoles")}
          </button>
        ))}
      </div>
      {tab === "users" ? <UsersPanel /> : <RolesPanel />}
    </div>
  );
}
