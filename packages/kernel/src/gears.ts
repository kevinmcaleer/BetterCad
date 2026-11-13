/**
 * Gears (#168, #191): involute spur gears as profiles, without OCCT. Millimetres and degrees. A gear lies on the XY
 * plane centred on its axis, so the Gear step pushes the profile up by its width.
 *
 * The flank is the involute of the base circle; below the base circle it runs radially down to a root fillet that
 * blends into the root circle. Backlash thins each tooth along the pitch circle, so two gears made with the same
 * backlash mesh with twice that between them.
 */
import type { ProfileSeg } from "./extrude";

type Vec2 = [number, number];

export interface GearParams {
  teeth: number;
  /** Module: pitch diameter ÷ teeth, mm. */
  module: number;
  /** Degrees; 20° is the standard. */
  pressure: number;
  /** How much each tooth is thinned along the pitch circle, mm. */
  backlash: number;
  /** Tip clearance as a share of the module: the root is this much deeper than the mating tip (0.25 is standard). */
  clearance: number;
  /** Profile shift as a share of the module: positive makes stronger, wider-rooted teeth on small gears. */
  shift: number;
}

export const GEAR_DEFAULTS: GearParams = { teeth: 20, module: 1, pressure: 20, backlash: 0.1, clearance: 0.25, shift: 0 };

const RAD = Math.PI / 180;
const inv = (a: number) => Math.tan(a) - a;
const at = (r: number, a: number): Vec2 => [r * Math.cos(a), r * Math.sin(a)];

/** The circles that size a gear, mm. */
export function gearCircles(p: GearParams) {
  const pitch = (p.module * p.teeth) / 2;
  const base = pitch * Math.cos(p.pressure * RAD);
  const tip = pitch + p.module * (1 + p.shift);
  const root = pitch - p.module * (1 + p.clearance - p.shift);
  return { pitch, base, tip, root };
}

/** The outside diameter: m(z + 2) for an unshifted gear. */
export const outsideDiameter = (p: GearParams) => 2 * gearCircles(p).tip;

/** The fewest teeth that cut without undercut at this pressure angle and shift, as the tables round it: 17 at 20°. */
export const minTeeth = (p: Pick<GearParams, "pressure" | "shift">) => Math.max(1, Math.round((2 * (1 - p.shift)) / Math.sin(p.pressure * RAD) ** 2));

/** Two gears mesh only with the same module and pressure angle. Null when they do, or why not. */
export function meshProblem(a: GearParams, b: GearParams): string | null {
  if (Math.abs(a.module - b.module) > 1e-9) return `These gears have different modules (${a.module} and ${b.module}), so their teeth won't mesh`;
  if (Math.abs(a.pressure - b.pressure) > 1e-9)
    return `These gears have different pressure angles (${a.pressure}° and ${b.pressure}°), so their teeth won't mesh`;
  return null;
}

/** The distance between two meshing gears' axes, mm: m(z1 + z2)/2, plus the profile shifts. */
export const centreDistance = (a: GearParams, b: GearParams) => (a.module * (a.teeth + b.teeth)) / 2 + a.module * (a.shift + b.shift);

/**
 * How far to turn gear b (radians) so its teeth fall between gear a's, when b sits at angle `theta` from a's centre
 * and a is turned `turnA`. Each gear has a tooth centred on its +x before turning; b's gap faces a when a's tooth
 * faces b, and they turn the opposite way in the ratio of their teeth.
 */
export function meshTurn(a: number, turnA: number, theta: number, b: number): number {
  return theta + Math.PI + Math.PI / b + ((theta - turnA) * a) / b;
}

/** "2 : 1, the small gear turns twice as fast". */
export function ratioText(driver: number, driven: number, noun = "gear"): string {
  const big = Math.max(driver, driven);
  const small = Math.min(driver, driven);
  const r = Math.round((big / small) * 100) / 100;
  if (r === 1) return "1 : 1, both turn at the same speed";
  const how = r === 2 ? "twice" : r === 3 ? "three times" : `${r} times`;
  return `${r} : 1, the small ${noun} turns ${how} as fast`;
}

/** What's wrong with the settings, or null. */
export function gearProblem(p: GearParams): string | null {
  if (!Number.isInteger(p.teeth) || p.teeth < 6) return "Give the gear at least 6 teeth";
  if (p.teeth > 400) return "That's too many teeth for one gear";
  if (!(p.module > 0)) return "Give it a module above 0 mm";
  if (!(p.pressure >= 10 && p.pressure <= 35)) return "Keep the pressure angle between 10° and 35°";
  if (p.backlash < 0 || p.clearance < 0) return "Backlash and clearance can't be below 0";
  const c = gearCircles(p);
  if (c.root <= 0) return "The teeth are too deep for this many";
  if (toothThickness(p, c.tip) <= 0) return "The teeth come to a point: use less profile shift or backlash";
  return null;
}

/** The half-angle a tooth spans at radius r (on the involute part of the flank). */
function halfAngle(p: GearParams, r: number): number {
  const { pitch, base } = gearCircles(p);
  const s = p.module * (Math.PI / 2 + 2 * p.shift * Math.tan(p.pressure * RAD)) - p.backlash;
  const phi = Math.acos(Math.min(1, base / r));
  return s / (2 * pitch) + inv(p.pressure * RAD) - inv(phi);
}

/** The tooth's thickness along the arc at radius r, mm. */
export function toothThickness(p: GearParams, r: number): number {
  return 2 * r * halfAngle(p, Math.max(r, gearCircles(p).base));
}

/** The warning for a gear that will undercut, or null. */
export function undercutWarning(p: GearParams): string | null {
  const n = minTeeth(p);
  return p.teeth < n ? `Fewer than ${n} teeth weakens the root at ${p.pressure}°. Try profile shift.` : null;
}

type Piece = { kind: "line"; pts: [Vec2, Vec2] } | { kind: "arc"; pts: [Vec2, Vec2, Vec2] };

/**
 * One tooth about +x, from the root on its lower side round to the root on its upper side, as lines and arcs. Each
 * involute flank is two arcs through five points on it, which stays within a few microns of the true curve.
 */
function toothPieces(p: GearParams): Piece[] {
  const { base, tip, root } = gearCircles(p);
  const pitchAngle = (2 * Math.PI) / p.teeth;
  const start = Math.max(base, root);
  const up: { r: number; a: number }[] = [];
  for (let i = 0; i <= 4; i++) {
    // Closer together near the base, where the involute bends most.
    const t = (i / 4) ** 1.5;
    const r = start + (tip - start) * t;
    up.push({ r, a: halfAngle(p, r) });
  }
  const flankAngle = up[0]!.a;
  // Root fillet: a circle tangent to the radial line at the flank's foot and to the root circle, in the gap.
  const gapHalf = pitchAngle / 2 - flankAngle;
  let rho = Math.min(0.38 * p.module, (root * Math.sin(gapHalf)) / (1 - Math.sin(gapHalf)) - 1e-6);
  const foot = start;
  // The fillet's tangent point on the radial line must stay below the flank's foot.
  const fits = (q: number) => (root + q) * Math.cos(Math.asin(q / (root + q))) <= foot + 1e-9;
  for (let k = 0; k < 40 && rho > 0 && !fits(rho); k++) rho *= 0.8;
  if (!(rho > 1e-4) || !fits(rho)) rho = 0;
  // The lower side (angle −a), from the root up.
  const lower: Piece[] = [];
  let last: Vec2;
  if (rho > 0) {
    const d = Math.asin(rho / (root + rho));
    const cr = root + rho;
    // The centre sits in the gap, below the tooth's lower side (more negative angle).
    const ca = -flankAngle - d;
    const c: Vec2 = at(cr, ca);
    const t1 = at(root, ca);
    const t2 = at(cr * Math.cos(d), -flankAngle);
    const a1 = Math.atan2(t1[1] - c[1], t1[0] - c[0]);
    let sweep = Math.atan2(t2[1] - c[1], t2[0] - c[0]) - a1;
    while (sweep > Math.PI) sweep -= 2 * Math.PI;
    while (sweep <= -Math.PI) sweep += 2 * Math.PI;
    const m: Vec2 = [c[0] + rho * Math.cos(a1 + sweep / 2), c[1] + rho * Math.sin(a1 + sweep / 2)];
    lower.push({ kind: "arc", pts: [t1, m, t2] });
    last = t2;
  } else last = at(root, -flankAngle);
  const flankFoot = at(foot, -flankAngle);
  if (Math.hypot(flankFoot[0] - last[0], flankFoot[1] - last[1]) > 1e-6) lower.push({ kind: "line", pts: [last, flankFoot] });
  const f = up.map((q) => at(q.r, -q.a));
  lower.push({ kind: "arc", pts: [f[0]!, f[1]!, f[2]!] }, { kind: "arc", pts: [f[2]!, f[3]!, f[4]!] });
  const tipA = up[up.length - 1]!.a;
  const mirror = (q: Vec2): Vec2 => [q[0], -q[1]];
  const upper = lower
    .slice()
    .reverse()
    .map((q): Piece =>
      q.kind === "line"
        ? { kind: "line", pts: [mirror(q.pts[1]), mirror(q.pts[0])] }
        : { kind: "arc", pts: [mirror(q.pts[2]), mirror(q.pts[1]), mirror(q.pts[0])] },
    );
  return [...lower, { kind: "arc", pts: [at(tip, -tipA), at(tip, 0), at(tip, tipA)] }, ...upper];
}

const turn = ([x, y]: Vec2, t: number): Vec2 => [x * Math.cos(t) - y * Math.sin(t), x * Math.sin(t) + y * Math.cos(t)];
const tidy = ([x, y]: Vec2): Vec2 => [Math.round(x * 1e9) / 1e9, Math.round(y * 1e9) / 1e9];

/**
 * The gear's outline as profile segments, anticlockwise: each tooth's fillets, flanks and tip as lines and arcs,
 * joined by arcs along the root circle. Turned by `spin` radians about the axis.
 */
export function gearSegs(p: GearParams, spin = 0): ProfileSeg[] {
  const { root } = gearCircles(p);
  const pitchAngle = (2 * Math.PI) / p.teeth;
  const tooth = toothPieces(p);
  const out: ProfileSeg[] = [];
  for (let k = 0; k < p.teeth; k++) {
    const t = spin + k * pitchAngle;
    const P = (q: Vec2) => tidy(turn(q, t));
    for (const q of tooth)
      out.push(q.kind === "line" ? { kind: "line", a: P(q.pts[0]), b: P(q.pts[1]) } : { kind: "arc", a: P(q.pts[0]), m: P(q.pts[1]), b: P(q.pts[2]) });
    // The root arc to the next tooth: from this tooth's upper foot, through mid-gap, to the next one's lower foot.
    const end = tooth[tooth.length - 1]!.pts;
    const a = end[end.length - 1]!;
    const b = turn(tooth[0]!.pts[0], pitchAngle);
    out.push({ kind: "arc", a: P(a), m: P(at(root, pitchAngle / 2)), b: P(b) });
  }
  return out;
}

/** The outline as points, for previews and area checks: each segment's start and, for arcs, its middle. */
export function gearOutline(p: GearParams, spin = 0): Vec2[] {
  return gearSegs(p, spin).flatMap((s) => (s.kind === "line" ? [s.a] : s.kind === "arc" ? [s.a, s.m] : []));
}

/** The area inside a gear's outline, mm², counting the arcs' bulges. */
export function gearArea(p: GearParams): number {
  let s = 0;
  for (const g of gearSegs(p)) {
    if (g.kind === "circle" || g.kind === "ellipse" || g.kind === "spline") continue;
    s += (g.a[0] * g.b[1] - g.b[0] * g.a[1]) / 2;
    if (g.kind === "arc") s += arcBulge(g.a, g.m, g.b);
  }
  return s;
}

/** The signed area between an arc and its chord (positive when it bulges left of a→b). */
function arcBulge(a: Vec2, m: Vec2, b: Vec2): number {
  const cross = (m[0] - a[0]) * (b[1] - a[1]) - (m[1] - a[1]) * (b[0] - a[0]);
  const chord = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (Math.abs(cross) < 1e-15 || chord < 1e-12) return 0;
  // Circumradius from the three points.
  const ab = chord;
  const am = Math.hypot(m[0] - a[0], m[1] - a[1]);
  const mb = Math.hypot(b[0] - m[0], b[1] - m[1]);
  const R = (ab * am * mb) / (2 * Math.abs(cross));
  const half = Math.asin(Math.min(1, ab / (2 * R)));
  // An obtuse angle at m puts m on the minor arc.
  const sweep = am * am + mb * mb < ab * ab ? 2 * half : 2 * Math.PI - 2 * half;
  const seg = (R * R * (sweep - Math.sin(sweep))) / 2;
  // cross > 0 puts m right of a→b: outward on an anticlockwise loop, so it adds area.
  return cross > 0 ? seg : -seg;
}

/** A closed polyline as profile segments. */
export const polySegs = (pts: Vec2[]): ProfileSeg[] => pts.map((a, i) => ({ kind: "line", a, b: pts[(i + 1) % pts.length]! }));

/** The area inside a closed polyline, positive when anticlockwise. */
export function polyArea(pts: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i]!;
    const [x2, y2] = pts[(i + 1) % pts.length]!;
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}

/** A D-flat shaft hole as two segments: the round part as one arc, then the flat. Turned by `spin` radians. */
export function dFlatSegs(d: number, flat: number, spin = 0): ProfileSeg[] {
  const r = d / 2;
  const f = Math.min(flat, r - 1e-6);
  const a0 = Math.acos(f / r);
  const [a, m, b] = [at(r, spin + a0), at(r, spin + Math.PI), at(r, spin - a0)].map(tidy) as [Vec2, Vec2, Vec2];
  return [
    { kind: "arc", a, m, b },
    { kind: "line", a: b, b: a },
  ];
}

/** A D-flat shaft hole: a circle of diameter `d` with a flat `flat` mm from the centre, on +x. */
export function dFlat(d: number, flat: number, n = 32): Vec2[] {
  const r = d / 2;
  const f = Math.min(flat, r - 1e-6);
  const a0 = Math.acos(f / r);
  const pts: Vec2[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((2 * Math.PI - 2 * a0) * i) / n;
    pts.push(at(r, a));
  }
  return pts;
}

// ---- Racks (#193) ----

/** The rack's teeth, mm: the pitch line at y = 0 with teeth pointing +y, centred on x = 0 and `length` long. */
export interface RackSize {
  length: number;
  /** Solid below the tooth roots, mm. */
  height: number;
}

/**
 * A rack's outline, anticlockwise: straight-flanked teeth `πm` apart, one centred on x = 0, as many as fit the
 * length, on a bar `height` deep below the roots. Thinned by the backlash along the pitch line like a gear's teeth.
 */
export function rackOutline(p: GearParams, size: RackSize): Vec2[] {
  const m = p.module;
  const pitch = Math.PI * m;
  const add = m * (1 + p.shift);
  const ded = m * (1 + p.clearance - p.shift);
  const tan = Math.tan(p.pressure * RAD);
  const half = (pitch / 2 - p.backlash) / 2; // half the tooth at the pitch line
  const tipHalf = half - add * tan;
  const rootHalf = half + ded * tan;
  const n = Math.max(1, Math.floor((size.length / 2 - rootHalf) / pitch));
  const ends = n * pitch + Math.max(rootHalf, pitch / 2);
  const out: Vec2[] = [[-ends, -ded - size.height]];
  out.push([ends, -ded - size.height], [ends, -ded]);
  for (let k = n; k >= -n; k--) {
    const c = k * pitch;
    out.push([c + rootHalf, -ded], [c + tipHalf, add], [c - tipHalf, add], [c - rootHalf, -ded]);
  }
  out.push([-ends, -ded]);
  return out.map(tidy);
}

/** A rack's settings that can't make one, or null. */
export function rackProblem(p: GearParams, size: RackSize): string | null {
  if (!(p.module > 0)) return "Give it a module above 0 mm";
  if (!(p.pressure >= 10 && p.pressure <= 35)) return "Keep the pressure angle between 10° and 35°";
  if (!(size.height > 0)) return "Give the rack a height above 0 mm";
  if (!(size.length >= 2 * Math.PI * p.module)) return `Make the rack at least ${Math.ceil(2 * Math.PI * p.module)} mm long`;
  const half = (Math.PI * p.module) / 4 - p.backlash / 2;
  if (half - p.module * (1 + p.shift) * Math.tan(p.pressure * RAD) <= 0) return "The teeth come to a point: use less backlash";
  return null;
}

// ---- GT2 timing pulleys (#193) ----

/** GT2: 2 mm pitch, the belt's pitch line 0.254 mm outside the pulley, teeth 0.75 mm tall. */
export const GT2 = { pitch: 2, pld: 0.254, depth: 0.75, radius: 0.555, widths: [6, 9] } as const;

/** A GT2 pulley's pitch diameter: the belt's pitch line, 2z/π mm (12.73 mm for 20 teeth). */
export const gt2Pitch = (teeth: number) => (GT2.pitch * teeth) / Math.PI;
/** Its outside diameter, under the belt's pitch line. */
export const gt2Outside = (teeth: number) => gt2Pitch(teeth) - 2 * GT2.pld;

/**
 * A GT2 pulley's outline as segments, anticlockwise: lands on the outside circle and, between them, a groove for each
 * belt tooth: a round bottom of the belt tooth's 0.555 mm radius, its centre 0.555 mm above the groove's floor
 * 0.75 mm down, and flanks opening out to the land. A close fit to the GT2 profile for printing, not the exact curve.
 */
export function gt2Segs(teeth: number, spin = 0): ProfileSeg[] {
  const ro = gt2Outside(teeth) / 2;
  const step = (2 * Math.PI) / teeth;
  const rb = ro - GT2.depth; // the floor
  const rc = rb + GT2.radius; // the bottom's centre
  const q = GT2.radius;
  // The groove opens to about 1.5 mm across at the outside circle.
  const mouth = 0.75 / ro;
  const out: ProfileSeg[] = [];
  for (let k = 0; k < teeth; k++) {
    const t = spin + k * step; // the groove's centre
    const P = (r: number, a: number): Vec2 => tidy(at(r, t + a));
    // The round bottom, from the side further round to the nearer one, in the pulley's local frame.
    const side = (s: number): Vec2 => {
      // Where the circle about (rc, 0) meets the tangent at its side: straight out along ±y.
      const [x, y] = [rc, s * q];
      return tidy(turn([x, y], t));
    };
    const a1 = P(ro, -mouth);
    const b1 = side(-1);
    const bottom = tidy(turn([rb, 0], t));
    const b2 = side(1);
    const a2 = P(ro, mouth);
    out.push({ kind: "line", a: a1, b: b1 }, { kind: "arc", a: b1, m: bottom, b: b2 }, { kind: "line", a: b2, b: a2 });
    // The land to the next groove.
    out.push({ kind: "arc", a: a2, m: P(ro, step / 2), b: P(ro, step - mouth) });
  }
  return out;
}

/** The pulley's tooth count that can't make one, or null. */
export function pulleyProblem(teeth: number): string | null {
  if (!Number.isInteger(teeth) || teeth < 10) return "Give the pulley at least 10 teeth";
  if (teeth > 200) return "That's too many teeth for one pulley";
  return null;
}

/** GT2 closed belts sold as stock, mm. */
export const GT2_BELTS = [
  100, 110, 112, 122, 140, 158, 160, 180, 200, 202, 210, 220, 232, 240, 250, 260, 270, 280, 288, 300, 310, 320, 330, 350, 360, 370, 376, 380, 400, 410, 420,
  440, 450, 460, 480, 500, 530, 550, 560, 600, 610, 640, 660, 700, 710, 720, 750, 760, 800, 820, 846, 852, 880, 900, 950, 1000,
];

/** A belt's length round two pulleys `c` mm apart, mm, along its pitch line. */
export function beltLength(c: number, teeth1: number, teeth2: number): number {
  const [d1, d2] = [gt2Pitch(teeth1), gt2Pitch(teeth2)];
  // The open-belt length, exact: straight runs plus the arcs each pulley wraps.
  const r1 = d1 / 2;
  const r2 = d2 / 2;
  const s = Math.asin(Math.max(-1, Math.min(1, (r2 - r1) / c)));
  return 2 * c * Math.cos(s) + r1 * (Math.PI - 2 * s) + r2 * (Math.PI + 2 * s);
}

/** The centre distance that makes a belt of `length` mm fit two pulleys, mm, or null if it's too short. */
export function centreForBelt(length: number, teeth1: number, teeth2: number): number | null {
  const lo0 = Math.abs(gt2Pitch(teeth2) - gt2Pitch(teeth1)) / 2 + (gt2Outside(Math.max(teeth1, teeth2)) + gt2Outside(Math.min(teeth1, teeth2))) / 2;
  if (beltLength(lo0, teeth1, teeth2) > length) return null;
  let lo = lo0;
  let hi = length / 2;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (beltLength(mid, teeth1, teeth2) < length) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** The stock belt nearest a length, mm. */
export const nearestBelt = (length: number) => GT2_BELTS.reduce((a, b) => (Math.abs(b - length) < Math.abs(a - length) ? b : a));
