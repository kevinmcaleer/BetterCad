#!/usr/bin/env node
/**
 * Bundle budget (#97): the scripts index.html loads before first paint must stay under the shell budget in
 * budgets.json (KB gzipped), and a release build must carry no dev-only code. Prints a table of every chunk, adds it
 * to the GitHub job summary when there is one, and exits 1 over budget. Run after `npm run build` (without VITE_GALLERY).
 */
import { appendFileSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const BUDGET_KB = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../budgets.json"), "utf8")).bundle.shell;
// Strings only dev or gallery builds contain. A release build that has one shipped a guard that didn't hold.
const DEV_ONLY = ["__bcView", "Gallery-", "react-dom.development", "Download the React DevTools"];

const dist = process.argv[2] ?? "dist";
const html = readFileSync(join(dist, "index.html"), "utf8");
const initial = new Set([...html.matchAll(/(?:src|href)="\.?\/?(assets\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]));

const kb = (n) => (n / 1024).toFixed(1);
const rows = readdirSync(join(dist, "assets"))
  .filter((f) => /\.(js|css|wasm)$/.test(f))
  .map((f) => {
    const path = `assets/${f}`;
    const bytes = readFileSync(join(dist, path));
    return {
      path,
      raw: statSync(join(dist, path)).size,
      gz: gzipSync(bytes, { level: 9 }).length,
      initial: initial.has(path),
      text: f.endsWith(".js") ? bytes.toString() : "",
    };
  })
  .sort((a, b) => Number(b.initial) - Number(a.initial) || b.gz - a.gz);

const firstPaint = rows.filter((r) => r.initial && r.path.endsWith(".js")).reduce((n, r) => n + r.gz, 0);
const leaks = rows.flatMap((r) => DEV_ONLY.filter((s) => r.text.includes(s)).map((s) => `${r.path} contains "${s}"`));

const table = [
  "| File | Size | Gzipped | Loads |",
  "| --- | ---: | ---: | --- |",
  ...rows.map((r) => `| ${r.path} | ${kb(r.raw)} KB | ${kb(r.gz)} KB | ${r.initial ? "first paint" : "later"} |`),
].join("\n");
const verdict = `First-paint JavaScript: **${kb(firstPaint)} KB** gzipped of a ${BUDGET_KB} KB budget.`;
const report = `## Bundle size\n\n${verdict}\n\n${table}\n${leaks.length ? `\nDev-only code in the build:\n${leaks.map((l) => `- ${l}`).join("\n")}\n` : ""}`;

console.log(report);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report + "\n");
if (firstPaint / 1024 > BUDGET_KB || leaks.length) process.exit(1);
