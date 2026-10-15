import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/coverage/**",
      "apps/web/src/api-client/schema.d.ts",
    ],
  },
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ["**/*.{ts,tsx}"],
  })),
  {
    // Architecture boundary (ADR-002): the Relay Worker is a transport and
    // platform-adapter boundary and must never import private Order
    // Management application code.
    files: ["apps/relay-worker/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@om/api", "@om/api/**", "@om/shared", "@om/shared/**"],
              message:
                "Relay Worker must not import private Order Management application code; shared source is limited to @om/relay-contract.",
            },
          ],
        },
      ],
    },
  },
);
