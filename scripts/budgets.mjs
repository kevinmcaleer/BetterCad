#!/usr/bin/env node
/**
 * Checks the build and the benchmarks against budgets.json (#108). Prints a Markdown table, adds it to the GitHub job
 * summary, writes it to budgets-report.md for the pull request comment, and exits 1 on any breach. Each measurement
 * is optional, so it runs locally on just a build:
 *
 *   node scripts/budgets.mjs [--dist web/dist] [--kernel k.json] [--viewport v.json] [--lighthouse lh.json]
 */
import { appendFileSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

const args = process.argv.slice(2);
const arg = (name, fallback) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback);
const budgets = JSON.parse(readFileSync("budgets.json", "utf8"));
const dist = arg("dist", "web/dist");
const rows = [];
const add = (area, what, now, limit, unit, ok) => rows.push({ area, what, now, limit, unit, ok });
const kb = (n) => n / 1024;
const mb = (n) => n / 1024 / 1024;
const fix = (n, d = 1) => (n === null || n === undefined ? "–" : Number(n).toFixed(d));

// Bundle: chunks by what loads them.
if (existsSync(join(dist, "index.html"))) {
  const html = readFileSync(join(dist, "index.html"), "utf8");
  const first = new Set([...html.matchAll(/(?:src|href)="\.?\/?(assets\/[^"]+\.js)"/g)].map((m) => m[1]));
  const js = readdirSync(join(dist, "assets"))
    .filter((f) => f.endsWith(".js") && !f.startsWith("Gallery-"))
    .map((f) => ({ f, gz: gzipSync(readFileSync(join(dist, "assets", f)), { level: 9 }).length, first: first.has(`assets/${f}`) }));
  const sum = (pick) => js.filter(pick).reduce((a, x) => a + x.gz, 0);
  const b = budgets.bundle;
  const check = (what, bytes, limit) => add("Bundle", what, kb(bytes), limit, "KB gz", kb(bytes) <= limit);
  check(
    "Shell (first paint)",
    sum((x) => x.first),
    b.shell,
  );
  check(
    "Pages",
    sum((x) => x.f.startsWith("lazy-")),
    b.pages,
  );
  check(
    "Kernel client",
    sum((x) => x.f.startsWith("browser-")),
    b.kernelClient,
  );
  check(
    "All JavaScript",
    sum(() => true),
    b.totalJs,
  );

  const wasm = (prefix) => readdirSync(join(dist, "assets")).find((f) => f.startsWith(prefix) && f.endsWith(".wasm"));
  const occt = wasm("replicad_single-");
  if (occt) {
    const data = readFileSync(join(dist, "assets", occt));
    const br = existsSync(join(dist, "assets", `${occt}.br`))
      ? statSync(join(dist, "assets", `${occt}.br`)).size
      : brotliCompressSync(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } }).length;
    const w = budgets.wasm.occt;
    add("WASM", `OpenCascade (target ${w.target.raw} MB)`, mb(data.length), w.raw, "MB", mb(data.length) <= w.raw);
    add("WASM", `OpenCascade, Brotli (target ${w.target.brotli} MB)`, mb(br), w.brotli, "MB", mb(br) <= w.brotli);
  }
  const gcs = wasm("planegcs-");
  if (gcs) {
    const size = statSync(join(dist, "assets", gcs)).size;
    add("WASM", "planegcs", mb(size), budgets.wasm.planegcs.raw, "MB", mb(size) <= budgets.wasm.planegcs.raw);
  }
}

// Benchmarks: a median may be up to the tolerance over its baseline.
for (const [area, file, budget] of [
  ["Kernel", arg("kernel"), budgets.kernel],
  ["Viewport", arg("viewport"), budgets.viewport],
]) {
  if (!file || !existsSync(file)) continue;
  const got = JSON.parse(readFileSync(file, "utf8"));
  for (const [what, base] of Object.entries(budget.baseline)) {
    const now = got[what];
    const limit = base * (1 + budget.tolerance);
    add(area, what, now, limit, "ms", now !== undefined && now <= limit);
  }
}

// Lighthouse: the performance score and whether it can be installed.
const lhFile = arg("lighthouse");
if (lhFile && existsSync(lhFile)) {
  const lh = JSON.parse(readFileSync(lhFile, "utf8"));
  const perf = lh.categories.performance?.score ?? 0;
  add(
    "Lighthouse",
    `Performance (target ${budgets.lighthouse.target})`,
    perf,
    budgets.lighthouse.performance,
    "score, at least",
    perf >= budgets.lighthouse.performance,
  );
  const installable = lh.audits["installable-manifest"]?.score === 1;
  add("Lighthouse", "Installable as an app", installable ? 1 : 0, 1, "yes", installable || !budgets.lighthouse.installable);
}

const failed = rows.filter((r) => !r.ok);
const table = [
  "| | Area | Measure | Now | Budget | |",
  "| --- | --- | --- | ---: | ---: | --- |",
  ...rows.map(
    (r) =>
      `| ${r.ok ? "✓" : "✗"} | ${r.area} | ${r.what} | ${fix(r.now, r.unit.startsWith("score") || r.unit === "yes" ? 2 : 1)} | ${fix(r.limit, r.unit.startsWith("score") ? 2 : 1)} | ${r.unit} |`,
  ),
].join("\n");
const report = `<!-- budgets -->\n## Performance budgets\n\n${failed.length ? `**${failed.length} over budget.**` : "Everything is within budget."} Budgets live in \`budgets.json\`; raise one only with a reason in the PR.\n\n${table}\n`;
console.log(report);
writeFileSync("budgets-report.md", report);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report + "\n");
if (failed.length) process.exit(1);
