// Rebuilds the starter component library (#624) from the KiCad libraries at the release named in the manifest.
//
//   npm run library            build packages/electronics/library/starter.json
//   npm run library -- --check fail when a part in the manifest cannot be built whole
//
// The KiCad files are fetched once into node_modules/.cache/kicad and are not kept in this repository; the pack that
// comes out is, with its credits (CC-BY-SA 4.0, see packages/electronics/library/CREDITS.md).
import { build } from "esbuild";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const lib = join(root, "packages/electronics/library");
const manifest = JSON.parse(readFileSync(join(lib, "starter.manifest.json"), "utf8"));
const cache = join(root, "node_modules/.cache/kicad", manifest.kicad);
const check = process.argv.includes("--check");

const bundled = join(root, "node_modules/.cache/kicad/build.mjs");
await build({
  entryPoints: [join(root, "packages/electronics/src/library/build.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: bundled,
  logLevel: "error",
});
const { buildPack, expand } = await import(pathToFileURL(bundled).href);

async function fetched(repo, path) {
  const file = join(cache, repo, path);
  if (existsSync(file)) return readFileSync(file, "utf8") || undefined;
  mkdirSync(dirname(file), { recursive: true });
  const url = `https://gitlab.com/kicad/libraries/${repo}/-/raw/${manifest.kicad}/${path.split("/").map(encodeURIComponent).join("/")}`;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const res = await fetch(url).catch(() => null);
    if (res?.ok) {
      const text = await res.text();
      writeFileSync(file, text);
      return text;
    }
    // Not there: remember it, so a wrong name is asked for once.
    if (res?.status === 404) {
      writeFileSync(file, "");
      return undefined;
    }
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }
  throw new Error(`Could not fetch ${url}`);
}

// Fetch everything the manifest names, a few at a time, then build from memory.
const parts = expand(manifest.parts);
const symbolLibs = [...new Set(parts.filter((p) => !p.symbol.startsWith("module:")).map((p) => p.symbol.split(":")[0]))];
const symbols = new Map();
for (const name of symbolLibs) symbols.set(name, await fetched("kicad-symbols", `${name}.kicad_sym`));

// A part with no footprints of its own uses its symbol's, which only the first build can tell us.
const footprints = new Map();
const wanted = (keys) => keys.filter((k) => !footprints.has(k));
async function fetchFootprints(keys) {
  const queue = [...new Set(wanted(keys))];
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      for (let key = queue.pop(); key; key = queue.pop()) {
        const [l, n] = key.split(":");
        footprints.set(key, await fetched("kicad-footprints", `${l}.pretty/${n}.kicad_mod`));
      }
    }),
  );
}
const src = { symbols: (l) => symbols.get(l), footprint: (l, n) => footprints.get(`${l}:${n}`) };
await fetchFootprints(parts.flatMap((p) => p.footprints ?? []));
const first = buildPack(manifest, src);
const defaults = first.problems.map((p) => /footprint (\S+:\S+) not found/.exec(p)?.[1]).filter(Boolean);
await fetchFootprints(defaults);
const { pack, problems } = buildPack(manifest, src);

writeFileSync(join(lib, "starter.json"), `${JSON.stringify(pack)}\n`);

// The list people read (docs/electronics-library.md) is written from the pack, so the two never disagree.
const doc = join(root, "docs/electronics-library.md");
const START = "<!-- generated: npm run library -->";
const END = "<!-- end generated -->";
const cell = (t) => String(t ?? "").replace(/\|/g, "/");
const list = [...new Set(pack.parts.map((p) => p.category))].flatMap((shelf) => [
  `### ${shelf}`,
  "",
  "| Part | Starts as | Packages |",
  "| --- | --- | --- |",
  ...pack.parts
    .filter((p) => p.category === shelf)
    .map((p) => `| ${cell(p.name)} | ${cell(p.value)} | ${cell(p.packages.map((k) => k.label ?? k.footprint).join(", ")) || "None: a power symbol"} |`),
  "",
]);
const text = readFileSync(doc, "utf8");
const at = text.indexOf(START);
if (at < 0) throw new Error(`${doc} has no "${START}" line`);
writeFileSync(doc, `${text.slice(0, at)}${START}\n\n${list.join("\n")}${text.slice(text.indexOf(END, at))}`);

const count = (o) => Object.keys(o).length;
console.log(
  `${pack.parts.length} parts, ${count(pack.symbols)} symbols, ${count(pack.footprints)} footprints, ${(JSON.stringify(pack).length / 1024).toFixed(0)} KB`,
);
if (problems.length) {
  console.log(`\n${problems.length} left out or cut down:\n${problems.map((p) => `  ${p}`).join("\n")}`);
  if (check) process.exit(1);
}
