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

// The robot parts catalogue (#167), for the parts that are in both: the same record the mechanical side places.
const robot = join(root, "node_modules/.cache/kicad/catalogue.mjs");
await build({
  stdin: {
    contents: `export { cataloguePart } from "./catalogue/list"; export { partBounds } from "./catalogue"; export { placeMatrix } from "./pose";`,
    resolveDir: join(root, "packages/kernel/src"),
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: robot,
  logLevel: "error",
});
const { cataloguePart, partBounds, placeMatrix } = await import(pathToFileURL(robot).href);
function catalogue(id, rotate) {
  const part = cataloguePart(id);
  if (!part) return undefined;
  const [a, b] = partBounds(part);
  const m = placeMatrix([0, 0, 0], rotate);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const x of [a[0], b[0]])
    for (const y of [a[1], b[1]])
      for (const z of [a[2], b[2]])
        for (let i = 0; i < 3; i += 1) {
          const v = m[i] * x + m[4 + i] * y + m[8 + i] * z;
          min[i] = Math.min(min[i], v);
          max[i] = Math.max(max[i], v);
        }
  const r = (v) => Math.round(v * 1000) / 1000;
  return { part, centre: [r((min[0] + max[0]) / 2), r((min[1] + max[1]) / 2)], size: [0, 1, 2].map((i) => r(max[i] - min[i])), bottom: r(min[2]) };
}

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
const src = { symbols: (l) => symbols.get(l), footprint: (l, n) => footprints.get(`${l}:${n}`), catalogue };
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
