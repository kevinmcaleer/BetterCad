import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { parse } from "opentype.js";
import { describe, expect, it } from "vitest";
import { layoutText, newSketch, profiles, solidLoops, type Sketch } from "@bettercad/sketch";
import { adapt } from "./glyphs";
import { FONTS } from "./fonts";

const require = createRequire(import.meta.url);
const FILES: Record<string, string> = {
  inter: "@fontsource/inter/files/inter-latin-400-normal.woff",
  "inter-bold": "@fontsource/inter/files/inter-latin-700-normal.woff",
  "archivo-black": "@fontsource/archivo-black/files/archivo-black-latin-400-normal.woff",
  "roboto-slab": "@fontsource/roboto-slab/files/roboto-slab-latin-400-normal.woff",
  "jetbrains-mono": "@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff",
  stencil: "@fontsource/allerta-stencil/files/allerta-stencil-latin-400-normal.woff",
};
const font = (id: string) => {
  const b = readFileSync(require.resolve(FILES[id]!));
  return adapt(parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)));
};
const style = { height: 10, letterSpacing: 0, lineSpacing: 1 };

describe("bundled fonts", () => {
  it("has a file for every font offered", () => {
    expect(FONTS.map((f) => f.id).sort()).toEqual(Object.keys(FILES).sort());
  });

  it("sets capitals to the height asked for", () => {
    const ys = layoutText(font("inter"), { text: "H", ...style })
      .flat()
      .map((p) => p[1]);
    expect(Math.min(...ys)).toBeCloseTo(0, 1);
    expect(Math.max(...ys)).toBeCloseTo(10, 1);
  });

  it("gives letters with holes closed profiles with holes", () => {
    const loops = layoutText(font("inter"), { text: "oB", ...style });
    // o: outline and hole; B: outline and two holes.
    expect(loops).toHaveLength(5);
    expect(solidLoops(loops).size).toBe(2);
    const s: Sketch = {
      ...newSketch(),
      entities: [{ id: "p", kind: "point", x: 0, y: 0 }],
      texts: [{ id: "t", p: "p", text: "oB", font: "inter", angle: 0, ...style, loops }],
    };
    const pr = profiles(s).profiles;
    expect(pr.map((p) => p.holes.length).sort()).toEqual([1, 2]);
  });

  it.each(Object.keys(FILES))("%s outlines every printable letter without crossings", (id) => {
    const f = font(id);
    const cross = (a: number[], b: number[], c: number[], d: number[]) => {
      const o = (p: number[], q: number[], r: number[]) => (q[0]! - p[0]!) * (r[1]! - p[1]!) - (q[1]! - p[1]!) * (r[0]! - p[0]!);
      return o(c, d, a) * o(c, d, b) < 0 && o(a, b, c) * o(a, b, d) < 0;
    };
    const bad: string[] = [];
    for (let c = 33; c < 127; c++) {
      const loops = layoutText(f, { text: String.fromCharCode(c), ...style });
      const segs = loops.flatMap((l) => l.map((p, i) => [p, l[(i + 1) % l.length]!]));
      const hit = segs.some(([a, b], i) => segs.some(([c2, d], j) => j > i + 1 && cross(a!, b!, c2!, d!)));
      if (hit) bad.push(String.fromCharCode(c));
    }
    expect(bad).toEqual([]);
  });
});
