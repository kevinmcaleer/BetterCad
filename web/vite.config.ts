import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `base: "./"` lets the same build run at the root, on GitHub Pages under /BetterCad/, or as a static preview.
// Cross-origin isolation lets the kernel (#4) use SharedArrayBuffer and WASM threads. FastAPI sets the same headers in production.
const isolation = { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" };

export default defineConfig({
  base: process.env.BASE ?? "./",
  plugins: [react()],
  server: {
    port: 5173,
    headers: isolation,
    proxy: { "/api": { target: process.env.API_URL ?? "http://127.0.0.1:8000", changeOrigin: true } },
  },
  preview: { port: 4173, headers: isolation },
  // WASM binaries are loaded as files, never pre-bundled.
  optimizeDeps: { exclude: ["@bettercad/kernel", "@bettercad/sketch"] },
  assetsInclude: ["**/*.wasm"],
  build: { outDir: "dist", sourcemap: true },
});
