import { defineConfig } from "vitest/config";
import swc from "unplugin-swc";

export default defineConfig({
  // SWC emits TypeScript decorator metadata (design:paramtypes etc.),
  // which Nest dependency injection requires at runtime. Vite's default
  // esbuild transform does not emit it, so it is required for e2e tests.
  plugins: [swc.vite({ module: { type: "es6" } })],
  test: {
    environment: "node",
    include: ["src/**/*.spec.ts", "test/**/*.spec.ts"],
  },
});
