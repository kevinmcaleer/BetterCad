#!/usr/bin/env node
/**
 * A Vitest JSON report as Markdown for a GitHub job summary (#106): failures first, then every case with its time,
 * slowest first, so slow cases are visible. Usage: node scripts/test-report.mjs report.json "Title" [extra.md]
 */
import { existsSync, readFileSync } from "node:fs";
import { relative } from "node:path";

const [file, title = "Tests", extra] = process.argv.slice(2);
if (!file || !existsSync(file)) {
  console.log(`### ${title}\n\nNo report was written: the run stopped before the tests finished.`);
  process.exit(0);
}
const report = JSON.parse(readFileSync(file, "utf8"));
const cases = report.testResults.flatMap((f) =>
  f.assertionResults.map((a) => ({
    file: relative(process.cwd(), f.name),
    name: a.fullName,
    status: a.status,
    ms: a.duration ?? 0,
    why: a.failureMessages?.[0],
  })),
);
const failed = cases.filter((c) => c.status === "failed");
const ran = cases.filter((c) => c.status === "passed" || c.status === "failed");
const total = ran.reduce((a, c) => a + c.ms, 0);
const cell = (s) => String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
const out = [
  `### ${title}`,
  "",
  `${ran.length - failed.length} passed, ${failed.length} failed, ${cases.length - ran.length} skipped, ${(total / 1000).toFixed(1)} s in tests.`,
];
if (failed.length) {
  out.push("", "#### Failed", "", "| Case | Why |", "| --- | --- |");
  for (const c of failed) out.push(`| ${cell(c.name)} | ${cell((c.why ?? "").split("\n")[0].slice(0, 200))} |`);
}
if (extra && existsSync(extra)) out.push("", "#### What moved", readFileSync(extra, "utf8"));
out.push("", "<details><summary>Time per case, slowest first</summary>", "", "| Case | File | ms |", "| --- | --- | ---: |");
for (const c of [...ran].sort((a, b) => b.ms - a.ms)) out.push(`| ${cell(c.name)} | ${cell(c.file)} | ${Math.round(c.ms)} |`);
out.push("", "</details>");
console.log(out.join("\n"));
