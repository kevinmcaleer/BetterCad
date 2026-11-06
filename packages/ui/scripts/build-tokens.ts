// Generates src/tokens.css and src/tokens.ts from src/tokens.json (the BetterCad design system's tokens).
// Run with --check to fail when either generated file is out of date (CI does this).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "src");
type Value = string | Record<string, string>;
interface Token {
  name: string;
  value: Value;
  usage?: string;
}
interface Style {
  name: string;
  fontSize: string;
  lineHeight: number | string;
  fontWeight: number | string;
  usage?: string;
}
interface Tokens {
  color: { themes: { id: string; name: string }[]; tokens: Token[] };
  type: { families: Record<string, string>; groups: { name: string; family: string; styles: Style[] }[] };
  spacing: { tokens: Token[] };
  radius: { tokens: Token[] };
  shadow: { tokens: Token[] };
}

const tokens: Tokens = JSON.parse(readFileSync(join(src, "tokens.json"), "utf8"));
const themes = tokens.color.themes.map((t) => t.id);
const first = themes[0];

/** A value for a theme: plain values hold for every theme; a missing theme falls back to dark (for shadows), then the first theme. */
function valueFor(value: Value, theme: string): string {
  if (typeof value !== "object" || value === null) return String(value);
  return value[theme] ?? (theme !== first ? value.dark : undefined) ?? value[first]!;
}

const comment = (s: string | false | undefined) => (s ? `  /* ${String(s).replace(/\*\//g, "* /")} */\n` : "");
const HEAD = "/* BetterCad — generated from tokens.json by scripts/build-tokens.ts. Do not edit by hand. */\n";

function themeBlock(selector: string, theme: string): string {
  let out = `${selector} {\n  color-scheme: ${theme === first ? "light" : "dark"};\n`;
  for (const t of tokens.color.tokens) out += comment(theme === first && t.usage) + `  --bc-color-${t.name}: ${valueFor(t.value, theme)};\n`;
  for (const t of tokens.shadow.tokens) out += comment(theme === first && t.usage) + `  --bc-${t.name}: ${valueFor(t.value, theme)};\n`;
  return out + "}\n";
}

let css = HEAD + ":root {\n";
css += `  --bc-font-sans: ${tokens.type.families.sans};\n  --bc-font-mono: ${tokens.type.families.mono};\n`;
for (const family of ["spacing", "radius"] as const) {
  for (const t of tokens[family].tokens) css += comment(t.usage) + `  --bc-${t.name}: ${t.value};\n`;
}
for (const group of tokens.type.groups) {
  for (const s of group.styles) {
    css += comment(s.usage);
    css += `  --bc-type-${s.name}-size: ${s.fontSize};\n  --bc-type-${s.name}-line: ${s.lineHeight};\n  --bc-type-${s.name}-weight: ${s.fontWeight};\n`;
  }
}
css += "}\n";
css += themeBlock(`:root, [data-theme="${first}"]`, first);
for (const theme of themes.slice(1)) css += themeBlock(`[data-theme="${theme}"]`, theme);
for (const group of tokens.type.groups) {
  for (const s of group.styles) {
    const n = `--bc-type-${s.name}`;
    css += `.bc-type-${s.name} { font-family: var(--bc-font-${group.family}); font-size: var(${n}-size); line-height: var(${n}-line); font-weight: var(${n}-weight); }\n`;
  }
}

// Typed hex values for code that cannot read CSS variables cheaply (the three.js viewport).
const colours: Record<string, Record<string, string>> = {};
for (const theme of themes) {
  colours[theme] = {};
  for (const t of tokens.color.tokens) colours[theme][t.name] = valueFor(t.value, theme);
}
let ts = HEAD.replace("/*", "//").replace(" */", "") + "\n";
ts += `export const THEME_IDS = ${JSON.stringify(themes)} as const;\nexport type ThemeId = (typeof THEME_IDS)[number];\n\n`;
ts += `export const THEME_NAMES: Record<ThemeId, string> = ${JSON.stringify(Object.fromEntries(tokens.color.themes.map((t) => [t.id, t.name])), null, 2)};\n\n`;
ts += `export type ColourName = ${tokens.color.tokens.map((t) => JSON.stringify(t.name)).join(" | ")};\n\n`;
ts += `/** Every colour token's value in every theme. */\nexport const COLOURS: Record<ThemeId, Record<ColourName, string>> = ${JSON.stringify(colours, null, 2)};\n`;

const outputs: [string, string][] = [
  [join(src, "tokens.css"), css],
  [join(src, "tokens.ts"), ts],
];
if (process.argv.includes("--check")) {
  const stale = outputs.filter(([p, body]) => readFileSync(p, "utf8") !== body);
  if (stale.length) {
    console.error("Generated tokens are out of date: run `npm run tokens`.");
    process.exit(1);
  }
  console.log("Generated tokens are up to date.");
} else {
  for (const [p, body] of outputs) writeFileSync(p, body);
  console.log("Wrote src/tokens.css and src/tokens.ts");
}
