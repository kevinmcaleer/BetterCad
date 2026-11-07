import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import type { Plugin } from "vite";

/** Writes a .gz beside each large asset (the 23 MB kernel WASM is 7 MB gzipped) so the server sends it without zipping per request. */
function precompress(): Plugin {
  let outDir = "dist";
  return {
    name: "bettercad-precompress",
    apply: "build",
    configResolved: (c) => void (outDir = c.build.outDir),
    closeBundle() {
      const dir = join(outDir, "assets");
      for (const f of readdirSync(dir)) {
        if (!/\.(wasm|js|css)$/.test(f)) continue;
        const bytes = readFileSync(join(dir, f));
        if (bytes.length > 10_000) writeFileSync(join(dir, `${f}.gz`), gzipSync(bytes, { level: 9 }));
      }
    },
  };
}

/**
 * Writes dist/sw.js (#94) from src/pwa/sw.js with the files to precache: index.html, the favicon and manifest, and
 * every hashed script, style and WASM file (not source maps or .gz copies). The version is a hash of that list, so
 * a build that changes nothing keeps the cache.
 */
function serviceWorker(): Plugin {
  let outDir = "dist";
  return {
    name: "bettercad-service-worker",
    apply: "build",
    configResolved: (c) => void (outDir = c.build.outDir),
    closeBundle: {
      order: "post",
      handler() {
        const assets = readdirSync(join(outDir, "assets"))
          .filter((f) => /\.(js|css|wasm|svg|png|woff2)$/.test(f))
          .sort()
          .map((f) => `assets/${f}`);
        const files = ["index.html", ...["favicon.svg", "manifest.webmanifest"].filter((f) => existsSync(join(outDir, f))), ...assets];
        const version = createHash("sha256")
          .update(files.join("\n"))
          .update(readFileSync(join(outDir, "index.html")))
          .digest("hex")
          .slice(0, 12);
        const template = readFileSync(new URL("./src/pwa/sw.js", import.meta.url), "utf8");
        writeFileSync(
          join(outDir, "sw.js"),
          template.replace('"__VERSION__"', JSON.stringify(version)).replace("= __PRECACHE__;", `= ${JSON.stringify(files)};`),
        );
      },
    },
  };
}

// `base: "./"` lets the same build run at the root, on GitHub Pages under /BetterCad/, or as a static preview.
// Cross-origin isolation lets the kernel (#4) use SharedArrayBuffer and WASM threads. FastAPI sets the same headers in production.
const isolation = { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" };

export default defineConfig({
  base: process.env.BASE ?? "./",
  // wasm() lets packages import .wasm modules directly. Top-level await needs no plugin: the build targets ES2022,
  // which every browser that can run OCCT supports natively (vite-plugin-top-level-await added 78 kB for nothing).
  plugins: [react(), wasm(), precompress(), serviceWorker()],
  worker: { format: "es", plugins: () => [wasm()] },
  server: {
    port: 5173,
    headers: isolation,
    proxy: {
      "/api": { target: process.env.API_URL ?? "http://127.0.0.1:8000", changeOrigin: true },
      "/view/": { target: process.env.API_URL ?? "http://127.0.0.1:8000", changeOrigin: true },
    },
  },
  preview: { port: 4173, headers: isolation },
  // WASM binaries are loaded as files, never pre-bundled.
  optimizeDeps: { exclude: ["@bettercad/kernel", "@bettercad/sketch"] },
  build: { outDir: "dist", sourcemap: true, target: "es2022" },
});
