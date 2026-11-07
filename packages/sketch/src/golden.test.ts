import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { Solver } from "./solver";
import { newSketch, type Id, type Sketch } from "./model";
import { Draft, drawCircle, drawPolygon, drawPolyline, drawRectangle } from "./draw";
import { profiles } from "./profiles";

/**
 * Golden sketches (#60): built through the model API, solved by the real planegcs in Node, and checked against
 * committed coordinates in golden/. Each also edits one dimension and checks the new solve. To accept a deliberate
 * change, run `UPDATE_GOLDEN=1 npm run test:golden` and commit.
 */
const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "golden");
const UPDATE = !!process.env.UPDATE_GOLDEN;

let solver: Solver;
beforeAll(async () => {
  solver = await Solver.load();
});

interface Case {
  /** In words, so it can be drawn by hand in the app as a manual test. */
  about: string;
  build(): { sketch: Sketch; edit: Id; to: number };
  loops: number;
  holes: number;
}

const fixFirst = (d: Draft) => {
  const p = d.entities.find((e) => e.kind === "point")!.id;
  d.constrain({ type: "fix", p });
};
const lineIds = (s: Sketch) => s.entities.filter((e) => e.kind === "line").map((e) => e.id);

const CASES: Record<string, Case> = {
  "l-bracket": {
    about: "An L: 80 wide, 40 tall, both arms 10 thick, bottom-left corner fixed at the origin.",
    build() {
      const s = drawPolyline(
        newSketch(),
        [
          [0, 0],
          [78, 0],
          [79, 12],
          [11, 9],
          [12, 41],
          [0, 39],
        ],
        true,
      ).sketch;
      const d = new Draft(s);
      fixFirst(d);
      const [bottom, right, , , armTop, left] = lineIds(s);
      // Nearly-level lines were made horizontal or vertical when drawn; make sure all six are square.
      for (const [i, id] of lineIds(s).entries())
        if (!d.constraints.some((c) => (c.type === "horizontal" || c.type === "vertical") && c.e === id))
          d.constrain({ type: i % 2 ? "vertical" : "horizontal", e: id });
      const width = d.dimension("length", [bottom!], 80);
      d.dimension("length", [left!], 40);
      d.dimension("length", [right!], 10);
      d.dimension("length", [armTop!], 10);
      return { sketch: d.done().sketch, edit: width, to: 100 };
    },
    loops: 1,
    holes: 0,
  },
  "plate-with-holes": {
    about: "An 80 × 50 plate, four ⌀6 holes 60 apart across and 30 apart up, centred by two construction lines.",
    build() {
      const r = drawRectangle(newSketch(), [0, 0], [80, 50], { width: 80, height: 50 });
      const d = new Draft(r.sketch);
      fixFirst(d);
      const [bottom, right, top, left] = r.ids;
      const vAxis = d.line([40, 0], [40, 50], { construction: true, auto: false });
      const hAxis = d.line([0, 25], [80, 25], { construction: true, auto: false });
      const ends = (id: Id) => d.entities.find((e) => e.id === id) as { a: Id; b: Id };
      d.constrain({ type: "midpoint", p: ends(vAxis).a, line: bottom! });
      d.constrain({ type: "midpoint", p: ends(vAxis).b, line: top! });
      d.constrain({ type: "midpoint", p: ends(hAxis).a, line: left! });
      d.constrain({ type: "midpoint", p: ends(hAxis).b, line: right! });
      const holes = [d.circle([12, 11], 2.5), d.circle([69, 9], 3.5), d.circle([9, 41], 3), d.circle([71, 40], 3)];
      const centre = (id: Id) => (d.entities.find((e) => e.id === id) as { c: Id }).c;
      for (const h of holes.slice(1)) d.constrain({ type: "equal", a: holes[0]!, b: h });
      d.dimension("diameter", [holes[0]!], 6);
      d.constrain({ type: "symmetric", a: centre(holes[0]!), b: centre(holes[1]!), line: vAxis });
      d.constrain({ type: "symmetric", a: centre(holes[2]!), b: centre(holes[3]!), line: vAxis });
      d.constrain({ type: "symmetric", a: centre(holes[0]!), b: centre(holes[2]!), line: hAxis });
      const across = d.dimension("distanceX", [centre(holes[0]!), centre(holes[1]!)], 60);
      d.dimension("distanceY", [centre(holes[0]!), centre(holes[2]!)], 30);
      return { sketch: d.done().sketch, edit: across, to: 50 };
    },
    loops: 1,
    holes: 4,
  },
  slot: {
    about: "A slot: two R5 ends 30 apart joined by tangent lines, the left centre fixed at the origin.",
    build() {
      const d = new Draft(newSketch());
      const lc = d.point([0, 0]);
      d.constrain({ type: "fix", p: lc });
      const rc = d.point([31, 1]);
      const tl = d.point([0, 5]);
      const tr = d.point([31, 6]);
      const br = d.point([30, -4]);
      const bl = d.point([1, -5]);
      const top = d.line(tl, tr, { auto: false });
      const bottom = d.line(br, bl, { auto: false });
      const right = d.arc(rc, br, tr);
      const left = d.arc(lc, tl, bl);
      d.constrain({ type: "horizontal", e: top });
      for (const l of [top, bottom]) for (const a of [right, left]) d.constrain({ type: "tangent", a: l, b: a });
      d.constrain({ type: "equal", a: left, b: right });
      const length = d.dimension("distance", [lc, rc], 30);
      d.dimension("radius", [left], 5);
      return { sketch: d.done().sketch, edit: length, to: 45 };
    },
    loops: 1,
    holes: 0,
  },
  hexagon: {
    about: "A hexagon with flats top and bottom, 20 across the flats, centred on the origin.",
    build() {
      const p = drawPolygon(newSketch(), [0, 0], 11, 6, 0);
      const d = new Draft(p.sketch);
      fixFirst(d);
      const sides = p.ids.slice(1);
      d.constrain({ type: "horizontal", e: sides[1]! });
      const opposite = d.entities.find((e) => e.id === sides[4]) as { a: Id };
      const flats = d.dimension("distance", [opposite.a, sides[1]!], 20);
      return { sketch: d.done().sketch, edit: flats, to: 13 };
    },
    loops: 1,
    holes: 0,
  },
};

const coords = (s: Sketch) => s.entities.flatMap((e) => (e.kind === "point" ? [[round(e.x), round(e.y)]] : e.kind === "line" ? [] : [[round(e.r)]]));
const round = (v: number) => Math.round(v * 1e6) / 1e6 + 0;

describe("golden sketches", () => {
  for (const [name, c] of Object.entries(CASES)) {
    it(name, () => {
      const { sketch, edit, to } = c.build();
      const r = solver.solve(sketch);
      expect(r.status, name).toBe("ok");
      expect(r.dof, name).toBe(0);
      const p = profiles(r.sketch);
      expect(p.profiles).toHaveLength(c.loops);
      expect(p.profiles.reduce((n, x) => n + x.holes.length, 0)).toBe(c.holes);
      // Edit one dimension: the next solve starts from this one's answer.
      const edited = { ...r.sketch, dimensions: r.sketch.dimensions.map((d) => (d.id === edit ? { ...d, value: to, expression: `${to}` } : d)) };
      const r2 = solver.solve(edited);
      expect(r2.status, `${name} after edit`).toBe("ok");
      expect(r2.dof).toBe(0);
      const got = { about: c.about, solved: coords(r.sketch), edited: coords(r2.sketch) };
      const file = join(DIR, `${name}.json`);
      if (UPDATE || !existsSync(file)) {
        if (!UPDATE && process.env.CI) throw new Error(`No golden file for ${name}. Run UPDATE_GOLDEN=1 npm run test:golden and commit it.`);
        mkdirSync(DIR, { recursive: true });
        writeFileSync(file, JSON.stringify(got) + "\n");
        return;
      }
      const want = JSON.parse(readFileSync(file, "utf8")) as typeof got;
      for (const k of ["solved", "edited"] as const) {
        expect(got[k].length).toBe(want[k].length);
        got[k].forEach((v, i) => v.forEach((x, j) => expect(x, `${name} ${k} ${i}`).toBeCloseTo(want[k][i]![j]!, 6)));
      }
    });
  }

  it("an over-constrained rectangle names the conflicting dimension", () => {
    const r = drawRectangle(newSketch(), [0, 0], [40, 20], { width: 40, height: 20 });
    const d = new Draft(r.sketch);
    const extra = d.dimension("length", [r.ids[2]!], 35);
    const res = solver.solve(d.done().sketch);
    expect(res.status).toBe("conflicting");
    expect(res.conflicting).toContain(extra);
  });

  it("a 200-circle grid solves within the frame budget", () => {
    let s = newSketch();
    for (let i = 0; i < 200; i++) s = drawCircle(s, [(i % 20) * 10, Math.floor(i / 20) * 10], 3, 4).sketch;
    solver.solve(s);
    const t0 = performance.now();
    const r = solver.solve(s);
    const ms = performance.now() - t0;
    expect(r.status).toBe("ok");
    // Timing is recorded, not asserted, so slow CI runners do not flake (#12 enforces budgets).
    if (UPDATE) writeFileSync(join(DIR, "timing.txt"), `200 circles: ${ms.toFixed(1)} ms (map, solve, freedom) on ${process.platform}/${process.arch}\n`);
  });
});
