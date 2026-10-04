import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { lib: { entry: resolve("electron/main.ts") } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { lib: { entry: resolve("electron/preload.ts") } },
  },
  renderer: {
    root: ".",
    plugins: [
      react(),
      {
        name: "dev-react-csp",
        apply: "serve",
        transformIndexHtml: (html) =>
          html.replace(
            "script-src 'self'",
            "script-src 'self' 'unsafe-inline'",
          ),
      },
    ],
    build: { rollupOptions: { input: resolve("index.html") } },
  },
});
