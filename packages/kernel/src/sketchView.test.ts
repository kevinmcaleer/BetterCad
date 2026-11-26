import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Sketch } from "@bettercad/sketch";
import { sketchFrame, sketchView } from "./sketchView";
import { VIEWS, type ModelView, type ViewFrame } from "./view";

const here = dirname(fileURLToPath(import.meta.url));
const UPDATE = !!process.env.UPDATE_GOLDEN;

/** A 40 × 20 plate with a 10 mm hole, a rounded corner, a construction line and a projected edge, on a plane. */
function plate(plane: Sketch["plane"]): Sketch {
  return {
    id: "s1",
    name: "Plate",
    plane,
    entities: [
      { id: "p1", kind: "point", x: 0, y: 0 },
      { id: "p2", kind: "point", x: 35, y: 0 },
      { id: "p3", kind: "point", x: 40, y: 5 },
      { id: "p4", kind: "point", x: 40, y: 20 },
      { id: "p5", kind: "point", x: 0, y: 20 },
      { id: "c0", kind: "point", x: 35, y: 5 },
      { id: "h", kind: "point", x: 12, y: 10 },
      { id: "l1", kind: "line", a: "p1", b: "p2" },
      { id: "a1", kind: "arc", c: "c0", a: "p2", b: "p3", r: 5 },
      { id: "l2", kind: "line", a: "p3", b: "p4" },
      { id: "l3", kind: "line", a: "p4", b: "p5" },
      { id: "l4", kind: "line", a: "p5", b: "p1" },
      { id: "hole", kind: "circle", c: "h", r: 5 },
      { id: "cl", kind: "line", a: "p1", b: "p4", construction: true },
      { id: "q1", kind: "point", x: 0, y: -5, projectedFrom: { body: "b", edge: 1 } },
      { id: "q2", kind: "point", x: 40, y: -5, projectedFrom: { body: "b", edge: 1 } },
      { id: "pl", kind: "line", a: "q1", b: "q2", projectedFrom: { body: "b", edge: 1 } },
    ],
    constraints: [],
    dimensions: [],
  };
}

const r = (n: number) => String(Math.round(n * 1000) / 1000 + 0);
const p = (v: readonly number[]) => `${r(v[0]!)},${r(v[1]!)}`;
/** A view as lines of text: each edge, where it came from and whether it shows, then the box. */
function describeView(v: ModelView): string {
  const out = v.edges.map((e) => {
    const c = e.curve;
    const g =
      c.kind === "line"
        ? `line ${p(c.a)} ${p(c.b)}`
        : c.kind === "circle"
          ? `circle ${p(c.c)} r${r(c.r)}`
          : c.kind === "arc"
            ? `arc ${p(c.c)} r${r(c.r)} ${r(c.from)}..${r(c.to)}`
            : c.kind === "poly"
              ? `poly ${c.pts.length} ${p(c.pts[0]!)}..${p(c.pts.at(-1)!)}`
              : c.kind;
    return `${e.source?.name ?? "-"} ${e.visible ? "seen" : "hidden"} ${g}`;
  });
  out.push(`box ${p(v.box.min)} ${p(v.box.max)}`);
  return out.join("\n") + "\n";
}

function golden(name: string, text: string) {
  const file = join(here, "testdata", "sketch-view", `${name}.txt`);
  if (UPDATE || !existsSync(file)) {
    if (!UPDATE && process.env.CI) throw new Error(`No testdata/sketch-view/${name}.txt. Run UPDATE_GOLDEN=1 npm run test:golden and commit it.`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
  expect(text).toBe(readFileSync(file, "utf8"));
}

describe("a sketch drawn flat for a drawing", () => {
  const cases: [string, Sketch["plane"], ViewFrame | undefined][] = [
    ["xy-face-on", { kind: "world", plane: "XY", offset: 0 }, undefined],
    ["xz-face-on", { kind: "world", plane: "XZ", offset: 5 }, undefined],
    ["yz-face-on", { kind: "world", plane: "YZ", offset: 0 }, undefined],
    ["xy-from-below", { kind: "world", plane: "XY", offset: 0 }, VIEWS.bottom],
    ["xy-from-the-front", { kind: "world", plane: "XY", offset: 0 }, VIEWS.front],
    ["xy-isometric", { kind: "world", plane: "XY", offset: 0 }, VIEWS.iso],
  ];
  for (const [name, plane, frame] of cases)
    it(`draws its curves: ${name}`, () => {
      const s = plate(plane);
      golden(name, describeView(sketchView(s, frame ?? sketchFrame(s), s.id)));
    });

  it("face on, shows the sketch in its own millimetres, names curves after their entities and leaves projected ones out", () => {
    const s = plate({ kind: "world", plane: "XZ", offset: 0 });
    const v = sketchView(s, sketchFrame(s), s.id);
    expect(v.edges.find((e) => e.source?.name === "l1")!.curve).toEqual({ kind: "line", a: [0, 0], b: [35, 0] });
    expect(v.edges.find((e) => e.source?.name === "hole")!.curve).toEqual({ kind: "circle", c: [12, 10], r: 5 });
    expect(v.edges.find((e) => e.source?.name === "cl")!.visible).toBe(false);
    expect(v.edges.some((e) => e.source?.name === "pl" || e.source?.name === "p:q1")).toBe(false);
    // Every point of its own is a hidden line of no length, to measure from.
    const h = v.edges.find((e) => e.source?.name === "p:h")!;
    expect([h.visible, h.curve]).toEqual([false, { kind: "line", a: [12, 10], b: [12, 10] }]);
    expect(v.box).toEqual({ min: [0, 0], max: [40, 20] });
    expect(v.edges.every((e) => e.source?.body === "sketch:s1")).toBe(true);
  });

  it("gives nothing for a sketch with no curves, or one that is gone", () => {
    const s: Sketch = { ...plate({ kind: "world", plane: "XY", offset: 0 }), entities: [{ id: "p", kind: "point", x: 1, y: 1 }] };
    expect(sketchView(s, sketchFrame(s), s.id).edges).toEqual([]);
    expect(sketchView(undefined, VIEWS.top, "x").edges).toEqual([]);
  });
});
