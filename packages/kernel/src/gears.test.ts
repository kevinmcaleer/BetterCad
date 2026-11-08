import { describe, expect, it } from "vitest";
import {
  GEAR_DEFAULTS,
  centreDistance,
  dFlat,
  dFlatSegs,
  gearArea,
  gearCircles,
  gearOutline,
  gearProblem,
  gearSegs,
  meshProblem,
  minTeeth,
  outsideDiameter,
  polyArea,
  ratioText,
  toothThickness,
  undercutWarning,
  type GearParams,
} from "./gears";

const g = (p: Partial<GearParams> = {}): GearParams => ({ ...GEAR_DEFAULTS, backlash: 0, ...p });

/** Where a closed polyline crosses the circle of radius r, as angles. */
function crossings(pts: [number, number][], r: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    const ra = Math.hypot(...a) - r;
    const rb = Math.hypot(...b) - r;
    if (ra === 0 || ra * rb < 0) {
      const t = ra / (ra - rb);
      out.push(Math.atan2(a[1] + (b[1] - a[1]) * t, a[0] + (b[0] - a[0]) * t));
    }
  }
  return out;
}

describe("spur gears (#191)", () => {
  it("sizes a 20-tooth module 1 gear", () => {
    const p = g();
    const c = gearCircles(p);
    expect(c.pitch).toBe(10);
    expect(outsideDiameter(p)).toBeCloseTo(22, 9);
    expect(c.root).toBeCloseTo(8.75, 9);
    expect(c.base).toBeCloseTo(10 * Math.cos((20 * Math.PI) / 180), 9);
  });

  it("makes teeth half the circular pitch thick at the pitch circle, less backlash", () => {
    expect(toothThickness(g(), 10)).toBeCloseTo(Math.PI / 2, 9);
    expect(toothThickness(g({ backlash: 0.2 }), 10)).toBeCloseTo(Math.PI / 2 - 0.2, 9);
    // In the outline: the chord between where one tooth's flanks cross the pitch circle.
    const pts = gearSegs(g()).flatMap((s) => (s.kind === "arc" ? arcPoints(s.a, s.m, s.b, 16) : s.kind === "line" ? [s.a] : []));
    const a = crossings(pts, 10).slice(0, 2);
    expect(Math.abs(a[1]! - a[0]!) * 10).toBeCloseTo(Math.PI / 2, 2);
  });

  it("draws an anticlockwise outline between the root and the tip", () => {
    const p = g();
    const pts = gearOutline(p);
    expect(polyArea(pts)).toBeGreaterThan(0);
    const rs = pts.map((q) => Math.hypot(...q));
    expect(Math.max(...rs)).toBeCloseTo(11, 9);
    expect(Math.min(...rs)).toBeGreaterThan(8.75 - 1e-6);
    // The area sits between the root disc and the tip disc, about the pitch disc.
    const area = polyArea(pts);
    expect(area).toBeGreaterThan(Math.PI * 8.75 ** 2);
    expect(area).toBeLessThan(Math.PI * 11 ** 2);
    expect(Math.abs(area - Math.PI * 100)).toBeLessThan(10);
    // No edge crosses another: angles only go round one way.
    let turn = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = Math.atan2(pts[i]![1], pts[i]![0]);
      const b = Math.atan2(pts[(i + 1) % pts.length]![1], pts[(i + 1) % pts.length]![0]);
      let d = b - a;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d <= -Math.PI) d += 2 * Math.PI;
      expect(d).toBeGreaterThan(-1e-9);
      turn += d;
    }
    expect(turn).toBeCloseTo(2 * Math.PI, 6);
  });

  it("warns below 17 teeth at 20°, and less with profile shift", () => {
    expect(minTeeth({ pressure: 20, shift: 0 })).toBe(17);
    expect(undercutWarning(g({ teeth: 12 }))).toBe("Fewer than 17 teeth weakens the root at 20°. Try profile shift.");
    expect(undercutWarning(g({ teeth: 12, shift: 0.3 }))).toBeNull();
    expect(undercutWarning(g({ teeth: 20 }))).toBeNull();
  });

  it("meshes gears of the same module and pressure angle at m(z1 + z2)/2", () => {
    expect(centreDistance(g({ teeth: 12, module: 1.5 }), g({ teeth: 36, module: 1.5 }))).toBeCloseTo(36, 9);
    expect(meshProblem(g({ module: 1 }), g({ module: 1.5 }))).toMatch(/different modules/);
    expect(meshProblem(g(), g({ pressure: 14.5 }))).toMatch(/pressure angles/);
    expect(meshProblem(g(), g({ teeth: 40 }))).toBeNull();
    expect(ratioText(12, 24)).toBe("2 : 1, the small gear turns twice as fast");
    expect(ratioText(12, 36)).toBe("3 : 1, the small gear turns three times as fast");
  });

  it("refuses settings that can't make a gear", () => {
    expect(gearProblem(g({ teeth: 4 }))).toMatch(/at least 6/);
    expect(gearProblem(g({ module: 0 }))).toMatch(/module/);
    expect(gearProblem(g({ shift: 2 }))).toMatch(/point/);
    expect(gearProblem(g())).toBeNull();
    for (const teeth of [6, 8, 12, 17, 40, 100]) expect(gearProblem(g({ teeth, shift: teeth < 10 ? 0.4 : 0 })), String(teeth)).toBeNull();
  });

  it("follows the involute to within a few microns with two arcs a flank", () => {
    for (const p of [g(), g({ teeth: 12, shift: 0.3 }), g({ teeth: 60, module: 2 })]) {
      const { base, tip, root } = gearCircles(p);
      let worst = 0;
      for (const s of gearSegs(p)) {
        if (s.kind !== "arc") continue;
        // Sample the arc between its three points; keep the samples on the flank of the first tooth.
        const c = circumcentre(s.a, s.m, s.b);
        const R = Math.hypot(s.a[0] - c[0], s.a[1] - c[1]);
        for (const [u, v] of [
          [s.a, s.m],
          [s.m, s.b],
        ] as const) {
          const a0 = Math.atan2(u[1] - c[1], u[0] - c[0]);
          let da = Math.atan2(v[1] - c[1], v[0] - c[0]) - a0;
          while (da > Math.PI) da -= 2 * Math.PI;
          while (da < -Math.PI) da += 2 * Math.PI;
          const q: [number, number] = [c[0] + R * Math.cos(a0 + da / 2), c[1] + R * Math.sin(a0 + da / 2)];
          const r = Math.hypot(...q);
          const ang = Math.abs(Math.atan2(q[1], q[0]));
          if (r < Math.max(base, root) + 0.01 || r > tip - 0.01 || ang > Math.PI / p.teeth) continue;
          worst = Math.max(worst, Math.abs(ang - toothThickness(p, r) / (2 * r)) * r);
        }
      }
      expect(worst).toBeLessThan(0.005);
    }
  });

  it("measures the area inside the arcs", () => {
    // A circle's worth of arcs: the gear's area against a fine polygon of its outline.
    const p = g();
    const fine = gearSegs(p).flatMap((s) => (s.kind === "arc" ? arcPoints(s.a, s.m, s.b, 64) : s.kind === "line" ? [s.a] : []));
    expect(gearArea(p)).toBeCloseTo(polyArea(fine), 1);
  });

  it("cuts a D-flat as one arc and a flat", () => {
    const s = dFlatSegs(5, 2);
    expect(s.map((q) => q.kind)).toEqual(["arc", "line"]);
  });

  it("makes a D-flat shaft hole", () => {
    const pts = dFlat(5, 2);
    expect(Math.max(...pts.map((p) => p[0]))).toBeCloseTo(2, 9);
    expect(polyArea(pts)).toBeGreaterThan(0);
  });
});

function circumcentre(a: [number, number], b: [number, number], c: [number, number]): [number, number] {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  const sq = (p: [number, number]) => p[0] ** 2 + p[1] ** 2;
  return [
    (sq(a) * (b[1] - c[1]) + sq(b) * (c[1] - a[1]) + sq(c) * (a[1] - b[1])) / d,
    (sq(a) * (c[0] - b[0]) + sq(b) * (a[0] - c[0]) + sq(c) * (b[0] - a[0])) / d,
  ];
}

/** n points along an arc from a, through m, stopping short of b. */
function arcPoints(a: [number, number], m: [number, number], b: [number, number], n: number): [number, number][] {
  const c = circumcentre(a, m, b);
  const R = Math.hypot(a[0] - c[0], a[1] - c[1]);
  const ang = (p: [number, number]) => Math.atan2(p[1] - c[1], p[0] - c[0]);
  const norm = (x: number) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  // Go the way that passes m.
  const toM = norm(ang(m) - ang(a));
  const toB = norm(ang(b) - ang(a));
  const sweep = toM < toB ? toB : toB - 2 * Math.PI;
  return Array.from({ length: n }, (_, i) => [c[0] + R * Math.cos(ang(a) + (sweep * i) / n), c[1] + R * Math.sin(ang(a) + (sweep * i) / n)]);
}
