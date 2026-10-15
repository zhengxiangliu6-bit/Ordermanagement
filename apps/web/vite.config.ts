import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => {
  // loadEnv also reads .env.local so the dev proxy target survives restarts
  // without a per-command environment variable.
  const env = loadEnv(mode, process.cwd(), "");
  const proxyTarget = env.VITE_API_PROXY_TARGET ?? "http://localhost:3000";

  // host: true binds 0.0.0.0 so phones/tablets on the LAN can reach the dev
  // server; /api is proxied to the local API so session cookies stay same-origin.
  return defineConfig({
    plugins: [react(), tailwindcss()],
    server: {
      host: true,
      port: 5173,
      proxy: {
        "/api": {
          target: proxyTarget,
          changeOrigin: false,
        },
      },
    },
  });
});
