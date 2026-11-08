import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { brotliCompressSync, constants as zlib, gzipSync } from "node:zlib";
import type { Plugin } from "vite";

/**
 * Writes a .br and a .gz beside each large asset so the server sends them without compressing per request (#97). The
 * 23 MB kernel WASM is 7.2 MB gzipped and 5.7 MB with Brotli. Files over 1 MB use Brotli quality 9: quality 11 takes
 * a minute on the WASM for 0.6 MB more.
 */
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
        if (bytes.length <= 10_000) continue;
        writeFileSync(join(dir, `${f}.gz`), gzipSync(bytes, { level: 9 }));
        const quality = bytes.length > 1_000_000 ? 9 : 11;
        const br = brotliCompressSync(bytes, { params: { [zlib.BROTLI_PARAM_QUALITY]: quality, [zlib.BROTLI_PARAM_SIZE_HINT]: bytes.length } });
        writeFileSync(join(dir, `${f}.br`), br);
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
        // The sample models (#99) open offline too.
        const samples = existsSync(join(outDir, "samples"))
          ? readdirSync(join(outDir, "samples"))
              .sort()
              .map((f) => `samples/${f}`)
          : [];
        const files = [
          "index.html",
          ...["favicon.svg", "manifest.webmanifest", "icon-192.png", "icon-512.png", "icon-maskable-512.png"].filter((f) => existsSync(join(outDir, f))),
          ...assets,
          ...samples,
        ];
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

// The FastAPI server behind /api. Dev always proxies to it; a preview only when API_URL names one, so the e2e
// preview (no server) answers /api itself, like a static host, and the app goes offline without a refused connection.
const api = process.env.API_URL ?? "http://127.0.0.1:8000";
const apiProxy = {
  "/api": { target: api, changeOrigin: true },
  "/view/": { target: api, changeOrigin: true },
};

export default defineConfig({
  base: process.env.BASE ?? "./",
  // wasm() lets packages import .wasm modules directly. Top-level await needs no plugin: the build targets ES2022,
  // which every browser that can run OCCT supports natively (vite-plugin-top-level-await added 78 kB for nothing).
  plugins: [react(), wasm(), precompress(), serviceWorker()],
  worker: { format: "es", plugins: () => [wasm()] },
  server: {
    port: 5173,
    headers: isolation,
    proxy: apiProxy,
  },
  preview: { port: 4173, headers: isolation, proxy: process.env.API_URL ? apiProxy : {} },
  // WASM binaries are loaded as files, never pre-bundled.
  optimizeDeps: { exclude: ["@bettercad/kernel", "@bettercad/sketch"] },
  build: { outDir: "dist", sourcemap: true, target: "es2022" },
});
