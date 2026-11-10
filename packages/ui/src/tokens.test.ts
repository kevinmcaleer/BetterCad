import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import tokens from "./tokens.json";
import { contrast, colour, THEMES, type ColourName } from "./contrast";

const css = readFileSync(join(__dirname, "tokens.css"), "utf8");

/** The pairs the brand book promises hold 4.5:1 in every theme (#32). */
const PAIRS: [ColourName, ColourName][] = [
  ["ink", "bar"],
  ["ink", "rail"],
  ["ink", "stage"],
  ["ink", "hover"],
  ["muted", "bar"],
  ["muted", "rail"],
  ["muted", "stage"],
  ["muted", "hover"],
  ["accent", "bar"],
  ["accent", "rail"],
  ["accent", "accent-soft"],
  ["on-accent", "accent"],
  ["warn-ink", "warn-soft"],
  ["danger", "bar"],
  ["danger", "rail"],
  ["dimension", "viewport"],
  ["snap-point", "snap-face"],
];

describe("contrast", () => {
  for (const theme of THEMES) {
    for (const [fg, bg] of PAIRS) {
      it(`${fg} on ${bg} is at least 4.5:1 in ${theme.name}`, () => {
        expect(contrast(colour(fg, theme.id), colour(bg, theme.id))).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});

describe("tokens.css", () => {
  it("has every colour token in every theme block", () => {
    const blocks = css.split(/\n(?=\S)/).filter((b) => b.includes("--bc-color-"));
    expect(blocks).toHaveLength(THEMES.length);
    for (const block of blocks) {
      for (const t of tokens.color.tokens) expect(block).toContain(`--bc-color-${t.name}:`);
    }
  });
  it("has spacing, radius, shadow and type tokens", () => {
    for (const name of ["--bc-space-8", "--bc-control", "--bc-radius-pill", "--bc-shadow-dialog", "--bc-type-ui-size", "--bc-font-sans"]) {
      expect(css).toContain(name + ":");
    }
    expect(css).toContain(".bc-type-panel-title {");
  });
  const sheets = [
    ...readdirSync(join(__dirname, "styles")).map((f) => join(__dirname, "styles", f)),
    join(__dirname, "..", "..", "..", "web", "src", "app.css"),
  ];
  for (const file of sheets) {
    it(`${file.split("/").slice(-2).join("/")} uses tokens, never literal colours`, () => {
      const body = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      expect(body).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
      const unknown = [...body.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]!).filter((v) => !v.startsWith("--bc-") && v !== "--depth");
      expect(unknown).toEqual([]);
    });
  }
  it("web/index.html splash style uses tokens, never literal colours", () => {
    const html = readFileSync(join(__dirname, "..", "..", "..", "web", "index.html"), "utf8");
    const style = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]!).join("\n");
    expect(style).toContain(".bc-splash");
    const body = style.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(body).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
    const unknown = [...body.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]!).filter((v) => !v.startsWith("--bc-"));
    expect(unknown).toEqual([]);
  });
});
