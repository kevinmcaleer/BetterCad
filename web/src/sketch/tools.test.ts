import { describe, expect, it } from "vitest";
import { Draft, SketchIndex, drawPolyline, drawRectangle, newSketch, profiles, type Sketch } from "@bettercad/sketch";
import { Solver } from "@bettercad/sketch/solver";
import { addConstraints, axisLine, commit, constraintsFor, toolById, levelOrUpright, newlyRedundant, picksReady, preview, resolveOrigin } from "./tools";
import { ORIGIN, middleOf, pickAt, pointPickAt, type Snap } from "./snap";

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

  it("previews a slot with its length, then its width from the pointer", () => {
    expect(preview("slot", [[0, 0]], [30, 0]).values).toEqual([30]);
    const p = preview(
      "slot",
      [
        [0, 0],
        [30, 0],
      ],
      [12, 4],
    );
    expect(p.values).toEqual([30, 8]);
    const xs = p.lines[0]!.map((q) => q[0]);
    expect(Math.min(...xs)).toBeCloseTo(-4);
    expect(Math.max(...xs)).toBeCloseTo(34);
  });

  it("draws a slot that solves and closes, with typed sizes as dimensions", async () => {
    const c = commit("slot", newSketch(), [free(0, 0), free(20, 0), free(5, 3)])!;
    expect(c.label).toBe("Draw a slot");
    expect(c.sketch.entities.filter((e) => e.kind === "arc")).toHaveLength(2);
    expect(profiles(c.sketch).profiles).toHaveLength(1);
    expect(profiles(c.sketch).profiles[0]!.area).toBeCloseTo(20 * 6 + Math.PI * 9, 0);
    // Enter after the first click with both sizes typed.
    const typed = commit("slot", newSketch(), [free(0, 0), free(3, 4)], [25, 6])!;
    expect(typed.sketch.dimensions.map((d) => `${d.kind} ${d.value}`)).toEqual(["length 25", "diameter 6"]);
    const r = (await Solver.load()).solve(typed.sketch);
    expect(r.status).toBe("ok");
    expect(commit("slot", newSketch(), [free(0, 0), free(20, 0)])).toBeNull();
  });

  it("previews an ellipse with its two widths, and draws one that is a closed profile", async () => {
    expect(preview("ellipse", [[0, 0]], [10, 0]).values).toEqual([20]);
    expect(
      preview(
        "ellipse",
        [
          [0, 0],
          [10, 0],
        ],
        [3, 4],
      ).values,
    ).toEqual([20, 8]);
    const c = commit("ellipse", newSketch(), [free(0, 0), free(10, 0), free(3, 4)])!;
    expect(c.label).toBe("Draw an ellipse");
    expect(profiles(c.sketch).profiles[0]!.area).toBeCloseTo(Math.PI * 40, 6);
    // Enter after the first click with both widths typed: they become dimensions.
    const typed = commit("ellipse", newSketch(), [free(0, 0), free(7, 0.1)], [30, 12])!;
    expect(typed.sketch.dimensions.map((d) => `${d.kind} ${d.value}`)).toEqual(["length 30", "length 12"]);
    expect((await Solver.load()).solve(typed.sketch).status).toBe("ok");
    expect(commit("ellipse", newSketch(), [free(0, 0), free(10, 0)])).toBeNull();
  });

  it("lets an ellipse be concentric or fixed, but nothing sit on it yet", () => {
    const c = commit("ellipse", newSketch(), [free(0, 0), free(10, 0), free(3, 4)])!;
    const e = c.sketch.entities.find((x) => x.kind === "ellipse")!.id;
    const ring = commit("circle", c.sketch, [free(0, 0), free(2, 0)])!.sketch;
    const circle = ring.entities.find((x) => x.kind === "circle")!.id;
    expect(constraintsFor("concentric", ring, [e, circle])).toEqual([{ type: "concentric", a: e, b: circle }]);
    expect(constraintsFor("fix", ring, [e])).toHaveLength(5);
    const p = ring.entities.find((x) => x.kind === "point" && !x.construction)!.id;
    expect(typeof constraintsFor("coincident", ring, [p, e])).toBe("string");
  });

  it("gives the Arc tool three kinds, the extra two picked from its bar", () => {
    expect(toolById("arcTangent").modes!.map((m) => m.mode)).toEqual(["3 point", "Centre", "Tangent"]);
    expect(toolById("arc").modes).toHaveLength(3);
    expect(toolById("line").modes).toBeUndefined();
  });

  it("draws a centre-point arc the way the pointer turns, with a typed radius as a dimension", () => {
    expect(preview("arcCentre", [[0, 0]], [10, 0]).values).toEqual([10]);
    const left = commit("arcCentre", newSketch(), [free(0, 0), free(10, 0), free(0, 7)])!;
    const arc = left.sketch.entities.find((e) => e.kind === "arc") as { a: string; b: string; r: number };
    const at = (id: string) => left.sketch.entities.find((e) => e.id === id) as { x: number; y: number };
    expect(arc.r).toBe(10);
    // Anticlockwise from 3 o'clock to 12, the end pulled onto the circle.
    expect([at(arc.a).x, at(arc.a).y]).toEqual([10, 0]);
    expect([at(arc.b).x, at(arc.b).y].map((v) => Math.round(v * 1e9) / 1e9 + 0)).toEqual([0, 10]);
    const right = commit("arcCentre", newSketch(), [free(0, 0), free(10, 0), free(0, -7)], [12])!;
    const r2 = right.sketch.entities.find((e) => e.kind === "arc") as { a: string; b: string };
    const at2 = (id: string) => right.sketch.entities.find((e) => e.id === id) as { x: number; y: number };
    // Clockwise is stored the other way round: from 6 o'clock up to 3.
    expect(Math.round(at2(r2.a).y)).toBe(-12);
    expect(right.sketch.dimensions.map((d) => `${d.kind} ${d.value}`)).toEqual(["radius 12"]);
  });

  it("carries a tangent arc on from a line's end, and a line on tangent from an arc's end", () => {
    const line = commit("line", newSketch(), [free(0, 0), free(20, 0)])!;
    const end: Snap = { xy: [20, 0], kind: "end", ref: line.end!, label: "End" };
    const p = preview("arcTangent", [[20, 0]], [30, 10], 6, [1, 0]);
    expect(p.values[0]).toBeCloseTo(10, 9);
    const arc = commit("arcTangent", line.sketch, [end, free(30, 10)])!;
    expect(arc.sketch.constraints.map((c) => c.type)).toEqual(["horizontal", "tangent"]);
    expect(commit("arcTangent", line.sketch, [free(20, 0), free(30, 10)])).toBeNull();
    // On from the arc's end, heading up: nearly along it, so tangent; well off it, not.
    const tip: Snap = { xy: [30, 10], kind: "end", ref: arc.end!, label: "End" };
    const on = commit("line", arc.sketch, [tip, free(30.2, 30)])!;
    expect(on.sketch.constraints.filter((c) => c.type === "tangent")).toHaveLength(2);
    const off = commit("line", arc.sketch, [tip, free(40, 30)])!;
    expect(off.sketch.constraints.filter((c) => c.type === "tangent")).toHaveLength(1);
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
    expect(constraintsFor("horizontalVertical", s, [pts[0]!])).toBe("Pick lines, or two points to line them up");
  });

  it("lines up two points across or up, whichever they are nearer to", () => {
    const d = new Draft(newSketch());
    const a = d.point([0, 0]);
    const b = d.point([30, 4]);
    const c = d.point([3, 25]);
    const s = d.done().sketch;
    expect(constraintsFor("horizontalVertical", s, [a, b])).toEqual([{ type: "horizontal", e: a, b }]);
    expect(constraintsFor("horizontalVertical", s, [a, c])).toEqual([{ type: "vertical", e: a, b: c }]);
    const done = addConstraints("horizontalVertical", s, [a, b]) as Sketch;
    expect(constraintsFor("horizontalVertical", done, [b, a])).toBe("Those points are already lined up");
  });

  it("takes two ends of one line as the line, and waits on a lone point for a second", () => {
    const s = drawPolyline(newSketch(), [
      [0, 0],
      [20, 30],
    ]).sketch;
    const line = s.entities.find((e) => e.kind === "line")!;
    if (line.kind !== "line") throw new Error("no line");
    expect(constraintsFor("horizontalVertical", s, [line.a, line.b])).toEqual([{ type: "vertical", e: line.id }]);
    expect(picksReady("horizontalVertical", s, [line.a])).toBe(false);
    expect(picksReady("horizontalVertical", s, [ORIGIN])).toBe(false);
    expect(picksReady("horizontalVertical", s, [line.id])).toBe(true);
    expect(picksReady("horizontalVertical", s, [line.a, ORIGIN])).toBe(true);
  });

  it("lines a circle's centre up with the origin, and the solver holds it", async () => {
    const d = new Draft(newSketch());
    const ring = d.circle([12, 3], 5);
    const s = d.done().sketch;
    const c = s.entities.find((e) => e.id === ring)!;
    if (c.kind !== "circle") throw new Error("no circle");
    const out = addConstraints("horizontalVertical", s, [c.c, ORIGIN]) as Sketch;
    expect(out.constraints.at(-1)).toMatchObject({ type: "horizontal", e: c.c });
    const solved = (await Solver.load()).solve(out);
    expect(solved.status).toBe("ok");
    const centre = solved.sketch.entities.find((e) => e.id === c.c)!;
    expect(centre.kind === "point" && Math.abs(centre.y)).toBeLessThan(1e-6);
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

  it("refuses a constraint mark or the same point twice as Coincident picks, instead of crashing the solver", async () => {
    const solver = await Solver.load();
    let s = solver.solve(commit("rectangle", newSketch(), [free(-20, -10), free(20, 10)])!.sketch).sketch;
    const lines = s.entities.filter((e) => e.kind === "line").map((e) => e.id);
    s = solver.solve(addConstraints("midpoint", s, [lines[0]!, lines[2]!]) as Sketch).sketch;
    const mark = s.constraints.find((c) => c.type === "midpoint")!;
    // The M mark covered the origin, so a click picked the constraint: it is not geometry.
    expect(addConstraints("coincident", s, [mark.id, ORIGIN])).toBe("Pick two points, or a point and a line or curve");
    expect(addConstraints("coincident", s, [ORIGIN, mark.id])).toBe("Pick two points, or a point and a line or curve");
    // The origin and the point already fixed on it are the same point.
    const fixed = addConstraints("coincident", s, [ORIGIN, (mark as { p: string }).p]) as Sketch;
    const o = fixed.constraints.find((c) => c.type === "fix")!;
    expect(addConstraints("coincident", fixed, [ORIGIN, (o as { p: string }).p])).toBe("Pick two different points");
  });

  it("snaps Coincident to points, then the origin, then midpoints, and lets go further away", () => {
    const d = new Draft(newSketch());
    const p = d.point([5, 5]);
    const line = d.line(d.point([10, 0]), d.point([30, 0]), { auto: false });
    const s = d.done().sketch;
    expect(pointPickAt([5.5, 5], s, 1, [0, 0])).toMatchObject({ id: p, xy: [5, 5], label: "Point" });
    expect(pointPickAt([0.5, 0], s, 1, [0, 0])).toMatchObject({ id: ORIGIN, kind: "origin" });
    expect(pointPickAt([10.4, 0], s, 1, [0, 0])).toMatchObject({ kind: "end", label: "End" });
    expect(pointPickAt([20.5, 0.3], s, 1, [0, 0])).toMatchObject({ id: middleOf(line), xy: [20, 0], kind: "middle" });
    expect(pointPickAt([24, 0], s, 1, [0, 0])).toBeNull();
  });

  it("puts a point on a line's midpoint when Coincident picks the midpoint", async () => {
    const d = new Draft(newSketch());
    const p = d.point([5, 5]);
    const a = d.line(d.point([10, 0]), d.point([30, 0]), { auto: false });
    const b = d.line(d.point([10, 10]), d.point([30, 20]), { auto: false });
    const s = d.done().sketch;
    const out = addConstraints("coincident", s, [p, middleOf(a)]) as Sketch;
    expect(out.constraints.at(-1)).toMatchObject({ type: "midpoint", p, line: a });
    const solved = (await Solver.load()).solve(out);
    expect(solved.status).toBe("ok");
    const i = new SketchIndex(solved.sketch);
    const la = solved.sketch.entities.find((e) => e.id === a) as { a: string; b: string };
    const [m0, m1] = [(i.xy(la.a)[0] + i.xy(la.b)[0]) / 2, (i.xy(la.a)[1] + i.xy(la.b)[1]) / 2];
    expect(i.xy(p)).toEqual([expect.closeTo(m0), expect.closeTo(m1)]);
    // The origin on a midpoint, and two midpoints together.
    expect((addConstraints("coincident", s, [ORIGIN, middleOf(a)]) as Sketch).constraints.at(-1)).toMatchObject({ type: "midpoint", line: a });
    expect((addConstraints("coincident", s, [middleOf(a), middleOf(b)]) as Sketch).constraints.filter((c) => c.type === "midpoint")).toHaveLength(2);
    // A line's own end can't go on its midpoint.
    const end = (s.entities.find((e) => e.id === a) as { a: string }).a;
    expect(addConstraints("coincident", s, [end, middleOf(a)])).toBe("A line's end can't sit on its own midpoint");
  });

  it("puts a diamond's centre in the middle of another line, as a drag dropped there does", async () => {
    // Kev's diamond: two construction diagonals with their crossing held in the middle of both, beside an upright line.
    const d = new Draft(newSketch());
    const c = d.point([20, 0]);
    const diag = [d.line(d.point([0, 0]), d.point([40, 0]), { construction: true }), d.line(d.point([20, -20]), d.point([20, 20]), { construction: true })];
    for (const line of diag) d.constrain({ type: "midpoint", p: c, line });
    const upright = d.line(d.point([25, -30]), d.point([25, 32]));
    d.constrain({ type: "pointOn", p: c, e: upright });
    const s = d.done().sketch;
    const solver = await Solver.load();
    // Already on the line, as the drag drops it the on constraint gives way to the midpoint.
    const base = { ...s, constraints: s.constraints.filter((x) => x.type !== "pointOn") };
    const out = addConstraints("coincident", base, [c, middleOf(upright)]) as Sketch;
    const r = solver.solve(out);
    expect(newlyRedundant(solver.solve(s), r)).toEqual([]);
    expect(r.status).not.toBe("conflicting");
    const i = new SketchIndex(r.sketch);
    const u = r.sketch.entities.find((e) => e.id === upright) as { a: string; b: string };
    expect(i.xy(c)).toEqual([expect.closeTo((i.xy(u.a)[0] + i.xy(u.b)[0]) / 2), expect.closeTo((i.xy(u.a)[1] + i.xy(u.b)[1]) / 2)]);
  });
});

describe("an axis as a line to measure from", () => {
  it("comes in as a fixed construction line through the axis, past the pick, and is reused", () => {
    const s = newSketch();
    const { sketch, id } = axisLine(s, [0, 0], [1, 0], [40, 2]);
    const idx = new SketchIndex(sketch);
    const l = idx.get(id);
    expect(l?.kind === "line" && l.construction).toBe(true);
    if (l?.kind !== "line") return;
    const [a, b] = [idx.xy(l.a), idx.xy(l.b)];
    expect(a[1]).toBeCloseTo(0);
    expect(b[1]).toBeCloseTo(0);
    expect(Math.min(a[0], b[0])).toBeLessThan(0);
    expect(Math.max(a[0], b[0])).toBeGreaterThan(40);
    expect(sketch.constraints.filter((c) => c.type === "fix")).toHaveLength(2);
    // Picking the same axis again gives the same line.
    const again = axisLine(sketch, [5, 0], [6, 0], [-20, 0]);
    expect(again.id).toBe(id);
    expect(again.sketch).toBe(sketch);
  });
});

describe("the spline tool", () => {
  it("previews the curve through the clicks and the pointer", () => {
    const p = preview(
      "spline",
      [
        [0, 0],
        [10, 5],
      ],
      [20, 0],
    );
    expect(p.lines).toHaveLength(1);
    expect(p.lines[0]!.length).toBeGreaterThan(10);
    expect(p.lines[0]![0]).toEqual([0, 0]);
  });

  it("draws an open spline, skipping a double-click's repeat", () => {
    const c = commit("spline", newSketch(), [free(0, 0), free(10, 5), free(20, 0), free(20, 0)])!;
    expect(c.label).toBe("Draw a spline");
    const sp = c.sketch.entities.filter((e) => e.kind === "spline");
    expect(sp).toHaveLength(1);
    expect(sp[0]!.kind === "spline" && sp[0]!.pts).toHaveLength(3);
    expect(profiles(c.sketch).profiles).toHaveLength(0);
  });

  it("draws a closed spline that is a profile", () => {
    const c = commit("spline", newSketch(), [free(10, 0), free(0, 10), free(-10, 0), free(0, -10)], [], 6, true)!;
    expect(c.label).toBe("Draw a closed spline");
    expect(profiles(c.sketch).profiles).toHaveLength(1);
  });

  it("needs two points, or three to close", () => {
    expect(commit("spline", newSketch(), [free(0, 0), free(0, 0)])).toBeNull();
    expect(commit("spline", newSketch(), [free(0, 0), free(5, 5)], [], 6, true)).toBeNull();
  });
});
