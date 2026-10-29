import { useTranslation } from "react-i18next";
import { PERMISSION_SCOPES, SCOPE_ACTIONS } from "@om/shared";

/**
 * Grouped `scope:action` permission checkboxes for role authoring. One
 * section per scope with a scope-level "select all" toggle.
 */
export function PermissionMatrix({
  value,
  onChange,
}: {
  value: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const { t } = useTranslation();

  const toggle = (key: string) => {
    const next = new Set(value);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange(next);
  };

  const toggleScope = (scope: string, actions: readonly string[]) => {
    const keys = actions.map((action) => `${scope}:${action}`);
    const allOn = keys.every((key) => value.has(key));
    const next = new Set(value);
    for (const key of keys) {
      if (allOn) next.delete(key);
      else next.add(key);
    }
    onChange(next);
  };

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {PERMISSION_SCOPES.map((scope) => {
        const actions = SCOPE_ACTIONS[scope];
        const keys = actions.map((action) => `${scope}:${action}`);
        const allOn = keys.every((key) => value.has(key));
        const someOn = keys.some((key) => value.has(key));
        return (
          <fieldset key={scope} className="rounded-lg border border-ink/10 p-3">
            <label className="flex items-center gap-2 text-sm font-medium text-ink">
              <input
                type="checkbox"
                checked={allOn}
                ref={(el) => {
                  if (el) el.indeterminate = someOn && !allOn;
                }}
                onChange={() => toggleScope(scope, actions)}
              />
              {t(`permScopes.${scope}`, scope)}
            </label>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              {actions.map((action) => {
                const key = `${scope}:${action}`;
                return (
                  <label key={key} className="flex items-center gap-1.5 text-xs text-slate-600">
                    <input
                      type="checkbox"
                      checked={value.has(key)}
                      onChange={() => toggle(key)}
                    />
                    {t(`permActions.${action}`, action)}
                  </label>
                );
              })}
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}
