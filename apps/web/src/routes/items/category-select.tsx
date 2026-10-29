import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../../api-client/client";

export function CategorySelect({
  id,
  defaultValue = "",
}: {
  id: string;
  defaultValue?: string | null;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState(defaultValue ?? "");
  const categories = useQuery({
    queryKey: ["categories"],
    queryFn: async () => {
      const { data, response } = await api.GET("/api/v1/categories");
      if (!response.ok) throw new Error(t("common.loadFailed"));
      return Array.isArray(data)
        ? (data as Array<{ id: string; name: string; enabled: boolean }>)
        : [];
    },
  });
  return (
    <div>
      <input type="hidden" name="categoryId" value={value} />
      <select
        id={id}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        disabled={categories.isLoading || categories.isError}
        className="w-full rounded-lg border border-ink/20 bg-white px-2 py-1.5"
      >
        <option value="">—</option>
        {(categories.data ?? [])
          .filter((c) => c.enabled || c.id === defaultValue)
          .map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
      </select>
      {categories.isError ? (
        <p role="alert" className="text-xs text-red-600">
          {t("common.loadFailed")}
        </p>
      ) : null}
    </div>
  );
}
