#!/usr/bin/env node
// Regenerates the "Every runtime dependency" table in THIRD_PARTY_LICENSES.md (#111): the npm packages the app ships
// (package-lock.json, not dev) and the Python packages the server runs (uv export --no-dev). `--check` fails if the
// file is out of date, so CI catches a new dependency nobody listed.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILE = join(ROOT, "THIRD_PARTY_LICENSES.md");
const START = "<!-- generated: npm run licences -->";
const END = "<!-- end generated -->";

function npm() {
  const lock = JSON.parse(readFileSync(join(ROOT, "package-lock.json"), "utf8")).packages;
  return Object.entries(lock)
    .filter(([path, p]) => path.includes("node_modules/") && !p.dev && !p.devOptional && !p.link)
    .map(([path, p]) => ({ name: path.split("node_modules/").pop(), version: p.version, licence: p.license ?? "unknown", via: "npm" }));
}

const PY_LICENCES = `
import json, sys
from importlib.metadata import metadata
out = []
for line in sys.stdin.read().splitlines():
    if "==" not in line or line.startswith(("#", " ", "-")):
        continue
    name, version = line.split(";")[0].strip().split("==")
    m = metadata(name)
    lic = m.get("License-Expression") or (m.get("License") or "").split("\\n")[0].strip()
    if not lic or len(lic) > 40:
        cls = [c.split(" :: ")[-1] for c in (m.get_all("Classifier") or []) if c.startswith("License ::")]
        lic = " / ".join(cls) or "unknown"
    out.append({"name": name, "version": version, "licence": lic.replace(" License", ""), "via": "PyPI"})
print(json.dumps(out))
`;

function python() {
  const server = join(ROOT, "server");
  const env = { ...process.env, UV_NO_PROGRESS: "1" };
  const reqs = execFileSync("uv", ["export", "--no-dev", "--no-hashes", "--frozen", "--no-emit-project"], { cwd: server, env, encoding: "utf8" });
  const out = execFileSync("uv", ["run", "--frozen", "--no-sync", "python", "-c", PY_LICENCES], { cwd: server, env, input: reqs, encoding: "utf8" });
  return JSON.parse(out);
}

const rows = [...npm(), ...python()].sort((a, b) => a.via.localeCompare(b.via) || a.name.localeCompare(b.name));
const table = [
  START,
  "",
  "| Package | Version | Licence | From |",
  "| --- | --- | --- | --- |",
  ...rows.map((r) => `| ${r.name} | ${r.version} | ${r.licence} | ${r.via} |`),
  "",
  END,
].join("\n");

const md = readFileSync(FILE, "utf8");
const at = md.indexOf(START);
const next = at < 0 ? `${md.trimEnd()}\n\n## Every runtime dependency\n\n${table}\n` : `${md.slice(0, at)}${table}${md.slice(md.indexOf(END) + END.length)}`;

if (process.argv.includes("--check")) {
  if (next !== md) {
    console.error("THIRD_PARTY_LICENSES.md is out of date. Run npm run licences and commit it.");
    process.exit(1);
  }
  console.log(`THIRD_PARTY_LICENSES.md lists all ${rows.length} runtime dependencies.`);
} else {
  writeFileSync(FILE, next);
  console.log(`Wrote ${rows.length} runtime dependencies to THIRD_PARTY_LICENSES.md.`);
}
