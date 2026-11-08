import { describe, expect, it } from "vitest";
import { Draft, Solver, SketchIndex, drawPolyline, drawRectangle, newSketch, profiles, type Sketch } from "@bettercad/sketch";
import { addConstraints, commit, constraintsFor, levelOrUpright, newlyRedundant, preview, resolveOrigin } from "./tools";
import { ORIGIN, pickAt, type Snap } from "./snap";

const free = (x: number, y: number): Snap => ({ xy: [x, y], kind: "free", label: "" });

describe("sketch tools", () => {
  it("previews a rectangle with its width and height", () => {
    const p = preview("rectangle", [[0, 0]], [30, -10]);
    expect(p.values).toEqual([30, 10]);
    expect(p.lines[0]).toHaveLength(5);
  });

  it("draws a closed, level rectangle", () => {
    const c = commit("rectangle", newSketch(), [free(0, 0), free(40, 20)])!;
    expect(c.label).toBe("Draw a rectangle");
    expect(c.sketch.entities.filter((e) => e.kind === "line")).toHaveLength(4);
    expect(c.sketch.constraints.map((x) => x.type).sort()).toEqual(["horizontal", "horizontal", "vertical", "vertical"]);
    expect(profiles(c.sketch).profiles[0]!.area).toBeCloseTo(800);
  });

  it("uses typed sizes and adds them as dimensions", () => {
    const c = commit("rectangle", newSketch(), [free(0, 0), free(-3, 7)], [25, 15])!;
    expect(c.sketch.dimensions.map((d) => d.value)).toEqual([25, 15]);
    expect(profiles(c.sketch).profiles[0]!.area).toBeCloseTo(375);
    const circle = commit("circle", newSketch(), [free(0, 0), free(1, 0)], [12])!;
    expect(circle.sketch.entities.find((e) => e.kind === "circle")).toMatchObject({ r: 6 });
  });

  it("chains lines from the last point and joins a corner snapped to", () => {
    const first = commit("line", newSketch(), [free(0, 0), free(10, 0)])!;
    const end = first.end!;
    const second = commit("line", first.sketch, [{ xy: [10, 0], kind: "end", ref: end, label: "End" }, free(10, 10)])!;
    const lines = second.sketch.entities.filter((e) => e.kind === "line");
    expect(lines).toHaveLength(2);
    expect(second.sketch.entities.filter((e) => e.kind === "point")).toHaveLength(3);
  });

  it("makes an equal-sided polygon on a construction circle", () => {
    const c = commit("polygon", newSketch(), [free(0, 0), free(10, 0)], [], 5)!;
    expect(c.label).toBe("Draw a 5-sided polygon");
    expect(c.sketch.entities.filter((e) => e.kind === "line")).toHaveLength(5);
    expect(c.sketch.entities.find((e) => e.kind === "circle")?.construction).toBe(true);
  });

  it("says what a constraint needs until the selection fits", () => {
    const s = drawRectangle(newSketch(), [0, 0], [40, 20]).sketch;
    const lines = s.entities.filter((e) => e.kind === "line").map((e) => e.id);
    const pts = s.entities.filter((e) => e.kind === "point").map((e) => e.id);
    expect(constraintsFor("parallel", s, [lines[0]!])).toBe("Pick two lines");
    expect(constraintsFor("perpendicular", s, [lines[0]!, lines[1]!])).toEqual([{ type: "perpendicular", a: lines[0], b: lines[1] }]);
    expect(constraintsFor("coincident", s, [pts[0]!, lines[1]!])).toEqual([{ type: "pointOn", p: pts[0], e: lines[1] }]);
    expect(constraintsFor("fix", s, [lines[0]!])).toHaveLength(2);
  });

  it("fixes a point drawn on the origin, once, and shares it", () => {
    const origin: Snap = { xy: [0, 0], kind: "origin", label: "Origin" };
    const line = commit("line", newSketch(), [origin, free(30, 0)])!;
    const fixes = line.sketch.constraints.filter((c) => c.type === "fix");
    expect(fixes).toHaveLength(1);
    const p = (fixes[0] as { p: string }).p;
    expect(line.sketch.entities.find((e) => e.id === p)).toMatchObject({ x: 0, y: 0 });
    // A circle centred on the same point reuses it and adds no second fix.
    const circle = commit("circle", line.sketch, [{ ...origin, ref: p }, free(5, 0)])!;
    expect(circle.sketch.constraints.filter((c) => c.type === "fix")).toHaveLength(1);
    expect(circle.sketch.entities.find((e) => e.kind === "circle")).toMatchObject({ c: p, r: 5 });
  });

  it("lines up two lines' midpoints, one of them fixed, the way Fusion's Midpoint does", async () => {
    // A fixed 60 × 30 rectangle with a free, level trapezoid above it, off to one side.
    const r = drawRectangle(newSketch(), [0, 0], [60, 30]);
    const d = new Draft(r.sketch);
    for (const e of r.sketch.entities) if (e.kind === "point") d.constrain({ type: "fix", p: e.id });
    const t = drawPolyline(
      d.done().sketch,
      [
        [5, 40],
        [25, 40],
        [30, 48],
        [0, 48],
      ],
      true,
    );
    const idx = new SketchIndex(t.sketch);
    const level = (s: Sketch, id: string) => {
      const l = new SketchIndex(s).get(id) as { a: string; b: string };
      return Math.abs(new SketchIndex(s).xy(l.a)[1] - new SketchIndex(s).xy(l.b)[1]) < 1e-6;
    };
    const rectTop = r.ids.find((id) => level(t.sketch, id) && idx.xy((idx.get(id) as { a: string }).a)[1] === 30)!;
    const trapTop = t.ids[2]!;
    const mid = (s: Sketch, id: string) => {
      const i = new SketchIndex(s);
      const l = i.get(id) as { a: string; b: string };
      const [a, b] = [i.xy(l.a), i.xy(l.b)];
      return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    };

    // Two lines were refused before: now they share a construction point at both midpoints.
    const out = addConstraints("midpoint", t.sketch, [trapTop, rectTop]);
    if (typeof out === "string") throw new Error(out);
    const added = out.entities.filter((e) => !t.sketch.entities.includes(e));
    expect(added).toEqual([expect.objectContaining({ kind: "point", construction: true })]);
    expect(out.constraints.filter((c) => c.type === "midpoint")).toHaveLength(2);

    // The drawn rectangle is level and fixed, so it is redundant already, as Kev's projected one was. That old
    // redundancy no longer blocks the new constraint; a repeat of one still does.
    const solver = await Solver.load();
    const before = solver.solve(t.sketch);
    expect(before.status).toBe("redundant");
    const solved = solver.solve(out);
    expect(newlyRedundant(before, solved)).toEqual([]);
    const rd = new Draft(t.sketch);
    rd.constrain({ type: "horizontal", e: trapTop });
    const repeat = rd.done().sketch;
    expect(newlyRedundant(before, solver.solve(repeat)).length).toBeGreaterThan(0);
    const [x, y] = mid(solved.sketch, trapTop);
    expect(x).toBeCloseTo(30);
    expect(y).toBeCloseTo(30);
    expect(mid(solved.sketch, rectTop)).toEqual([30, 30]);

    // A line with a midpoint point already reuses it rather than adding another.
    const reuse = addConstraints("midpoint", out, [trapTop, t.ids[0]!]) as Sketch;
    expect(reuse.entities).toHaveLength(out.entities.length);
    // A point and a line in either order still works.
    const p = added[0]!.id;
    expect(constraintsFor("midpoint", out, [t.ids[0]!, p])).toEqual([{ type: "midpoint", p, line: t.ids[0] }]);
  });

  it("makes a line horizontal up to 45° from the horizon and vertical past it", () => {
    const d = new Draft(newSketch());
    const line = (x: number, y: number) => d.line(d.point([0, 0]), d.point([x, y]), { auto: false });
    const flat = line(10, 4);
    const steep = line(-3, 10);
    const diagonal = line(10, -10);
    const s = d.done().sketch;
    expect(levelOrUpright(s, flat)).toBe("horizontal");
    expect(levelOrUpright(s, steep)).toBe("vertical");
    expect(levelOrUpright(s, diagonal)).toBe("horizontal");
    expect(constraintsFor("horizontalVertical", s, [flat, steep])).toEqual([
      { type: "horizontal", e: flat },
      { type: "vertical", e: steep },
    ]);
  });

  it("skips lines that are already horizontal or vertical", () => {
    const s = drawRectangle(newSketch(), [0, 0], [40, 20]).sketch;
    const lines = s.entities.filter((e) => e.kind === "line").map((e) => e.id);
    expect(constraintsFor("horizontalVertical", s, [lines[0]!])).toBe("That line is already horizontal or vertical");
    const pts = s.entities.filter((e) => e.kind === "point").map((e) => e.id);
    expect(constraintsFor("horizontalVertical", s, [pts[0]!])).toBe("Pick lines");
  });

  it("places a point, on a line when it lands on one, and never doubles one", () => {
    const one = commit("point", newSketch(), [free(5, 7)])!;
    expect(one.label).toBe("Add a point");
    expect(one.sketch.entities).toEqual([expect.objectContaining({ kind: "point", x: 5, y: 7 })]);
    expect(one.sketch.constraints).toHaveLength(0);

    const r = drawRectangle(newSketch(), [0, 0], [40, 20]).sketch;
    const bottom = r.entities.find((e) => e.kind === "line")!.id;
    const on = commit("point", r, [{ xy: [10, 0], kind: "on", ref: bottom, label: "" }])!;
    expect(on.sketch.constraints.at(-1)).toMatchObject({ type: "pointOn", e: bottom });

    const corner = r.entities.find((e) => e.kind === "point")!;
    expect(commit("point", r, [{ xy: [corner.x, corner.y], kind: "end", ref: corner.id, label: "" }])).toBeNull();
    const atOrigin = commit("point", newSketch(), [{ xy: [0, 0], kind: "origin", label: "" }])!;
    expect(atOrigin.sketch.constraints).toEqual([expect.objectContaining({ type: "fix" })]);
  });

  it("picks the origin when no point is nearer, and ties a line through it", async () => {
    const d = new Draft(newSketch());
    const line = d.line(d.point([5, 10]), d.point([30, 25]), { auto: false });
    const s = d.done().sketch;
    expect(pickAt([0.2, 0.1], s, 1, [0, 0])).toBe(ORIGIN);
    expect(pickAt([0.2, 0.1], s, 1, null)).toBeNull();
    expect(pickAt([17.5, 17.5], s, 1, [0, 0])).toBe(line);

    // Coincident on a line and the origin: the line passes through a point fixed on the origin.
    const out = addConstraints("coincident", s, [line, ORIGIN]);
    if (typeof out === "string") throw new Error(out);
    const o = out.entities.find((e) => e.kind === "point" && e.x === 0 && e.y === 0)!;
    expect(out.constraints).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "fix", p: o.id }), expect.objectContaining({ type: "pointOn", p: o.id, e: line })]),
    );
    const solved = (await Solver.load()).solve(out);
    expect(solved.status).toBe("ok");
    const i = new SketchIndex(solved.sketch);
    const l = solved.sketch.entities.find((e) => e.id === line)!;
    if (l.kind !== "line") throw new Error("not a line");
    const [a, b] = [i.xy(l.a), i.xy(l.b)];
    expect(Math.abs(a[0] * b[1] - a[1] * b[0])).toBeLessThan(1e-6);

    // A second use of the origin reuses its point; a point picked onto the origin is coincident with it.
    const again = resolveOrigin(out, [ORIGIN]);
    expect(again.sketch).toBe(out);
    expect(again.picked).toEqual([o.id]);
    const end = (l as { a: string }).a;
    const coin = addConstraints("coincident", out, [end, ORIGIN]) as Sketch;
    expect(coin.constraints.at(-1)).toMatchObject({ type: "coincident", a: end, b: o.id });
    // Midpoint: the line's midpoint on the origin.
    const midOut = addConstraints("midpoint", s, [ORIGIN, line]) as Sketch;
    expect(midOut.constraints.at(-1)).toMatchObject({ type: "midpoint", line });
  });
});
