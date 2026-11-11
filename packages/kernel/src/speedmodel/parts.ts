import type { ModelDoc } from "../document";
import type { OC } from "../occt/oc";
import type { Draft, Vec2 } from "@bettercad/sketch";
import { DENSITY, Timeline, frame, near0, outline, rect, roundCorner, roundedRect, slot, world } from "./kit";

/**
 * Too Tall Toby's Party Pack 01 (https://www.youtube.com/@TooTallToby), modelled in BetterCad the way you would in the
 * app. Each part has the mass the challenge asks for, from build123d's reference answers
 * (https://build123d.readthedocs.io/en/stable/tttt.html), so a part that builds to the right mass is right.
 *
 * A part BetterCad can't model yet is listed with `missing`: what the drawing needs that the app doesn't have.
 */
export interface SpeedPart {
  id: string;
  name: string;
  /** The challenge's answer, grams. */
  mass: number;
  density: number;
  build?: (oc: OC) => ModelDoc;
  /** Why it can't be modelled yet. */
  missing?: string[];
}

/** 01-03 C Clamp Base, aluminium: a C-shaped plate, two bosses, and a countersunk M5 hole through both jaws. */
function cClampBase(): ModelDoc {
  const t = new Timeline("C Clamp Base");
  const plate = t.sketch(world("XY"), (d) =>
    outline(
      d,
      [0, -47.5],
      [
        [16, -47.5],
        { arc: [16, -29.5], to: [34, -29.5] },
        [34, 29.5],
        { arc: [16, 29.5], to: [16, 47.5] },
        [0, 47.5],
        [0, 29.5],
        [11, 29.5],
        { arc: [11, 22.5], cw: true, to: [18, 22.5] },
        [18, -26.5],
        { arc: [11, -26.5], cw: true, to: [11, -33.5] },
        [0, -33.5],
      ],
    ),
  );
  const body = t.extrude({ sketch: plate, seeds: [[26, 0]], distance: 16, operation: "new" });
  // The bosses: circles on the back of each jaw, pushed in along it. The XZ plane faces -Y.
  const top = t.sketch(world("XZ", -47.5), (d) => d.circle([0, 8], 8));
  t.extrude({ sketch: top, seeds: [[0, 8]], distance: 18, operation: "join", target: body });
  const bottom = t.sketch(world("XZ", 33.5), (d) => d.circle([0, 8], 8));
  t.extrude({ sketch: bottom, seeds: [[0, 8]], distance: 23, operation: "join", target: body });
  t.hole({
    part: body,
    frame: frame([0, -56.5, 8], [0, -1, 0], [1, 0, 0]),
    points: [[0, 0]],
    size: "M5",
    fit: "normal",
    head: "countersink",
    depth: null,
  });
  return t.doc;
}

/** 01-08 Tie Plate, steel: a plate of two slots and a bar with five holes, and a lug at each end with a pin hole. */
function tiePlate(): ModelDoc {
  const t = new Timeline("Tie Plate");
  // Where the bar's 81 mm edge meets each slot's R33 end.
  const x = 61 - Math.sqrt(33 ** 2 - 19 ** 2);
  const plate = t.sketch(world("XY"), (d) => {
    outline(
      d,
      [-x, 81],
      [
        [x, 81],
        { arc: [61, 62], cw: true, to: [94, 62] },
        [94, -62],
        { arc: [61, -62], cw: true, to: [x, -81] },
        [-x, -81],
        { arc: [-61, -62], cw: true, to: [-94, -62] },
        [-94, 62],
        { arc: [-61, 62], cw: true, to: [-x, 81] },
      ],
    );
    for (const cx of [-61, 61]) for (const cy of [-62, 62]) d.circle([cx, cy], 14.5);
    d.circle([0, 0], 42);
  });
  const body = t.extrude({ sketch: plate, seeds: [[0, 60]], distance: 16, operation: "new" });
  // The lug: its side view, 20 mm thick about the middle, then trimmed to its plan view.
  const side = t.sketch(world("XZ"), (d) => {
    outline(
      d,
      [45, 0],
      [
        [85, -19],
        [125, -19],
        [125, 11],
        [45, 11],
      ],
    );
    d.circle([111, -5], 5.5);
  });
  const lug = t.extrude({ sketch: side, seeds: [[100, 5]], distance: 20, direction: "symmetric", operation: "new" });
  const plan = t.sketch(world("XY"), (d) =>
    outline(
      d,
      [45, -4],
      [
        [85, -4],
        [85, -10],
        [125, -10],
        [125, 10],
        [85, 10],
        [85, 4],
        [45, 4],
      ],
    ),
  );
  t.extrude({ sketch: plan, seeds: [[100, 0]], distance: 60, direction: "symmetric", operation: "intersect", target: lug });
  t.pattern({ kind: "mirror", parts: [lug], plane: "YZ", join: true });
  t.combine(body, [lug]);
  return t.doc;
}

/** 01-04 Angle Bracket, steel: a stepped boss, an arm out to a tab, rounds, and a counterbored slot in the tab. */
function angleBracket(oc: OC): ModelDoc {
  const t = new Timeline("Angle Bracket", oc);
  const base = t.sketch(world("XY"), (d) => d.circle([0, 0], 19));
  const body = t.extrude({ sketch: base, seeds: [[0, 0]], distance: 20, operation: "new" });
  const step = t.sketch(world("XY", 20), (d) => d.circle([0, 0], 13));
  t.extrude({ sketch: step, seeds: [[0, 0]], distance: 8, operation: "join", target: body });
  // The arm, drawn wider than the boss so its R4 round meets flat sides, then trimmed back to the boss's width.
  const arm = t.sketch(world("YZ"), (d) => rect(d, [0, 3.5], 53, 7));
  t.extrude({ sketch: arm, seeds: [[0, 3.5]], distance: 61, operation: "join", target: body });
  t.finish({ type: "fillet", part: body, refs: t.edges(body, ([x, y, z]) => near0(z, 7) && x > 0 && near0(Math.hypot(x, y), 19, 0.05)), size: 4 });
  const trim = t.sketch(world("YZ"), (d) => {
    rect(d, [-23, 7.5], 8, 15);
    rect(d, [23, 7.5], 8, 15);
  });
  t.extrude({
    sketch: trim,
    seeds: [
      [-23, 7.5],
      [23, 7.5],
    ],
    distance: 61,
    operation: "cut",
    target: body,
  });
  const bore = t.sketch(world("XY"), (d) => d.circle([0, 0], 8));
  t.extrude({ sketch: bore, seeds: [[0, 0]], distance: 28, operation: "cut", target: body });
  const tab = t.sketch(world("XY"), (d) => rect(d, [56, 0], 10, 38));
  t.extrude({ sketch: tab, seeds: [[56, 0]], distance: -23, operation: "join", target: body });
  t.finish({ type: "fillet", part: body, refs: t.edges(body, ([x, , z]) => near0(x, 61) && near0(z, 7)), size: 10 });
  t.finish({ type: "fillet", part: body, refs: t.edges(body, ([x, , z]) => near0(x, 51) && near0(z, 0)), size: 5 });
  const bigSlot = t.sketch(world("YZ", 61), (d) => slot(d, [0, -23], 34, 18, 90));
  t.extrude({ sketch: bigSlot, seeds: [[0, -10]], distance: -5, operation: "cut", target: body });
  const smallSlot = t.sketch(world("YZ", 61), (d) => slot(d, [0, -23], 28, 12, 90));
  t.extrude({ sketch: smallSlot, seeds: [[0, -10]], distance: -10, operation: "cut", target: body });
  return t.doc;
}

/** 01-01 Bearing Bracket, steel: a slotted base, two counterbored uprights, rounded corners and a dovetail underneath. */
function bearingBracket(oc: OC): ModelDoc {
  const t = new Timeline("Bearing Bracket", oc);
  const base = t.sketch(world("XY"), (d) => {
    rect(d, [0, 0], 115, 50);
    slot(d, [2.5, 0], 90, 12);
  });
  const body = t.extrude({ sketch: base, seeds: [[0, 20]], distance: 15, operation: "new" });
  // One upright on the front edge (the XZ plane faces -Y), drawn from the base up: R26 over the top.
  const upright = t.sketch(world("XZ", 25), (d) => outline(d, [-57.5, 0], [[-5.5, 0], [-5.5, 42], { arc: [-31.5, 42], to: [-57.5, 42] }]));
  t.extrude({ sketch: upright, seeds: [[-31.5, 30]], distance: -12, operation: "join", target: body });
  const wall = t.last;
  // The bearing's counterbore: Ø34 4 mm deep, then Ø24 through. The Hole tool only takes screw sizes for heads.
  const bore = t.sketch(world("XZ", 25), (d) => d.circle([-31.5, 42], 17));
  t.extrude({ sketch: bore, seeds: [[-31.5, 42]], distance: -4, operation: "cut", target: body });
  const cb = t.last;
  const through = t.sketch(world("XZ", 25), (d) => d.circle([-31.5, 42], 12));
  t.extrude({ sketch: through, seeds: [[-31.5, 42]], distance: -12, operation: "cut", target: body });
  t.pattern({ kind: "mirror", parts: [], of: "features", features: [wall, cb, t.last], plane: "XZ", offset: 0 });
  t.finish({ type: "fillet", part: body, refs: t.edges(body, ([x, , z]) => near0(x, -5.5) && near0(z, 15)), size: 9 });
  const corners = t.sketch(world("XY"), (d) => roundedRect(d, [0, 0], 115, 50, 6));
  t.extrude({ sketch: corners, seeds: [[0, 0]], distance: 80, operation: "intersect", target: body });
  const dovetail = t.sketch(world("YZ"), (d) => {
    const w = 9 + 8 / Math.tan(Math.PI / 3);
    outline(
      d,
      [-9, 0],
      [
        [9, 0],
        [w, 8],
        [-w, 8],
      ],
    );
  });
  t.extrude({ sketch: dovetail, seeds: [[0, 4]], distance: 115, direction: "symmetric", operation: "cut", target: body });
  return t.doc;
}

/** 01-06 Bearing Jig, steel: a forked plate on a keyed boss, welded with an R6 round, slotted down the middle. */
function bearingJig(oc: OC): ModelDoc {
  const t = new Timeline("Bearing Jig", oc);
  // Oversized plate and the boss under it as Library shapes, rounded where they meet, then cut to the outline.
  const body = t.shape("box", { x: 200, y: 200, z: 22 }, { x: 0, y: 0, z: -11 });
  const boss = t.shape("cylinder", { x: 30, y: 30, z: 25 }, { x: 0, y: 0, z: -25 });
  t.combine(body, [boss]);
  t.finish({ type: "fillet", part: body, refs: t.edges(body, ([x, y, z]) => near0(z, -11) && near0(Math.hypot(x, y), 15, 0.05)), size: 6 });
  // R10 ends turn 135° into 45° flanks, which meet the boss's sides with an R12 round.
  const end: Vec2 = [22 + 10 * Math.SQRT1_2, 44 - 10 * Math.SQRT1_2];
  const corner: Vec2 = [15, end[1] - (end[0] - 15)];
  const mirror = (p: Vec2): Vec2 => [-p[0], p[1]];
  const shape = t.sketch(world("XY", 11), (d) => {
    outline(
      d,
      [-22, 54],
      [
        [22, 54],
        { arc: [22, 44], cw: true, to: end },
        ...roundCorner(end, corner, [15, 0], 12),
        [15, 0],
        { arc: [0, 0], cw: true, to: [-15, 0] },
        ...roundCorner([-15, 0], mirror(corner), mirror(end), 12),
        mirror(end),
        { arc: [-22, 44], cw: true, to: [-22, 54] },
      ],
    );
    d.circle([22, 44], 6.5);
    d.circle([-22, 44], 6.5);
    // The keyed bore: Ø12 with a 4 mm key 9 mm up from the middle.
    const k = Math.sqrt(36 - 4);
    outline(d, [2, k], [[2, 9], [-2, 9], [-2, k], { arc: [0, 0], to: [2, k] }]);
  });
  t.extrude({ sketch: shape, seeds: [[0, 30]], distance: -36, operation: "intersect", target: body });
  const fork = t.sketch(world("XY", -5), (d) => rect(d, [0, 46.5], 69, 69));
  t.extrude({ sketch: fork, seeds: [[0, 46.5]], distance: 10, operation: "cut", target: body });
  return t.doc;
}

/** 01-09 Corner Tie, aluminium: a counterbored plate, an upright with a pin hole, and a leg at 45° with a Ø33 eye. */
function cornerTie(oc: OC): ModelDoc {
  const t = new Timeline("Corner Tie", oc);
  const plate = t.sketch(world("XY"), (d) =>
    outline(d, [0, -37.5], [[0, 37.5], [-52, 37.5], { arc: [-52, 20.5], to: [-69, 20.5] }, [-69, -20.5], { arc: [-52, -20.5], to: [-52, -37.5] }]),
  );
  const body = t.extrude({ sketch: plate, seeds: [[-30, 0]], distance: 13, operation: "new" });
  // 2× Ø8 through, Ø15 4 deep: no M8 in the screw table, so two cuts.
  const cb = t.sketch(world("XY", 13), (d) => [20.5, -20.5].forEach((y) => d.circle([-52, y], 7.5)));
  t.extrude({
    sketch: cb,
    seeds: [
      [-52, 20.5],
      [-52, -20.5],
    ],
    distance: -4,
    operation: "cut",
    target: body,
  });
  const thru = t.sketch(world("XY", 13), (d) => [20.5, -20.5].forEach((y) => d.circle([-52, y], 4)));
  t.extrude({
    sketch: thru,
    seeds: [
      [-52, 20.5],
      [-52, -20.5],
    ],
    distance: -13,
    operation: "cut",
    target: body,
  });
  // The upright: flanks 75° apart, tangent to the R15 top. YZ looks from +X: Y right, Z up.
  const a = (37.5 * Math.PI) / 180;
  const tp: Vec2 = [15 * Math.cos(a), 45 + 15 * Math.sin(a)];
  const side: Vec2 = [37.5, tp[1] - (37.5 - tp[0]) / Math.tan(a)];
  const upright = t.sketch(world("YZ"), (d) => {
    outline(d, [-37.5, 0], [[37.5, 0], side, tp, { arc: [0, 45], to: [-tp[0], tp[1]] }, [-side[0], side[1]]]);
    d.circle([0, 45], 6);
  });
  t.extrude({ sketch: upright, seeds: [[0, 10]], distance: -13, operation: "join", target: body });
  // The leg, on a plane through the Y axis tipped 45°: its sketch Y runs up and back, so the leg is drawn downward.
  const tilt = t.construct({ kind: "angle", refs: [{ origin: "Y" }], value: 45 });
  const r = 45 * Math.SQRT2 - 37.5;
  const leg = t.sketch(
    { kind: "construct", step: tilt, offset: 0, frame: { origin: [0, 0, 0], x: [0, 1, 0], normal: [Math.SQRT1_2, 0, Math.SQRT1_2] } },
    (d) => {
      outline(d, [-37.5, 0], [[37.5, 0], [37.5, -r], { arc: [0, -r], cw: true, to: [-37.5, -r] }]);
      d.circle([0, -r], 16.5);
    },
  );
  t.extrude({ sketch: leg, seeds: [[0, -5]], distance: 6, operation: "join", target: body });
  // Fill the notch between the leg's end and the upright, then round it R16.
  const k = 6 * Math.SQRT1_2;
  const fill = t.sketch(world("XZ"), (d) =>
    outline(
      d,
      [0, 0],
      [
        [k, k],
        [0, 2 * k],
      ],
    ),
  );
  t.extrude({ sketch: fill, seeds: [[k / 3, k]], distance: 75, direction: "symmetric", operation: "join", target: body });
  t.finish({ type: "fillet", part: body, refs: t.edges(body, ([x, , z]) => near0(x, 0) && near0(z, 2 * k)), size: 16 });
  return t.doc;
}

/**
 * 01-10 Light Cap, ABS: an 8 mm skin over a 184 × 84 mm pill, 46 high. Its R40 end domes are turned; the straight run
 * between them is pushed. Inside it is flat at 30 mm with an R8 round round the edge of that ceiling.
 */
function lightCap(oc: OC): ModelDoc {
  const t = new Timeline("Light Cap", oc);
  // The side runs from the 84 mm base tangent onto R40 centred 6 mm up; the inside is that, 8 mm in, cut flat at 30.
  const O: Vec2 = [0, 6];
  const P: Vec2 = [-42, 0];
  const L = Math.hypot(P[0] - O[0], P[1] - O[1]);
  const base = Math.atan2(P[1] - O[1], P[0] - O[0]) - Math.acos(40 / L);
  const T: Vec2 = [O[0] + 40 * Math.cos(base), O[1] + 40 * Math.sin(base)];
  const Ti: Vec2 = [O[0] + 32 * Math.cos(base), O[1] + 32 * Math.sin(base)];
  const dir: Vec2 = [T[0] - P[0], T[1] - P[1]];
  const xb = Ti[0] - (Ti[1] * dir[0]) / dir[1];
  const xc = -Math.sqrt(32 ** 2 - (30 - O[1]) ** 2);
  const m = (p: Vec2): Vec2 => [-p[0], p[1]];
  const outer = (d: Draft) => outline(d, [0, 0], [P, T, { arc: O, cw: true, to: [0, 46] }]);
  const inner = (d: Draft) => outline(d, [0, 0], [[xb, 0], Ti, { arc: O, cw: true, to: [xc, 30] }, [0, 30]]);
  // The XZ plane faces -Y, so offset -50 is the end at y = 50.
  let body = "";
  for (const y of [-50, 50]) {
    const end = t.sketch(world("XZ", y), outer);
    const made = t.revolve({
      sketch: end,
      seeds: [[-20, 20]],
      axis: { kind: "y" },
      angle: 360,
      operation: body ? "join" : "new",
      ...(body ? { target: body } : {}),
    });
    body ||= made;
  }
  const run = t.sketch(world("XZ", -50), (d) => outline(d, P, [T, { arc: O, cw: true, to: m(T) }, m(P)]));
  t.extrude({ sketch: run, seeds: [[0, 20]], distance: 100, operation: "join", target: body });
  for (const y of [-50, 50]) {
    const end = t.sketch(world("XZ", y), inner);
    t.revolve({ sketch: end, seeds: [[-10, 10]], axis: { kind: "y" }, angle: 360, operation: "cut", target: body });
  }
  const hollow = t.sketch(world("XZ", -50), (d) =>
    outline(d, [xb, 0], [Ti, { arc: O, cw: true, to: [xc, 30] }, [-xc, 30], { arc: O, cw: true, to: m(Ti) }, [-xb, 0]]),
  );
  t.extrude({ sketch: hollow, seeds: [[0, 10]], distance: 100, operation: "cut", target: body });
  // The ceiling's edge: R21.2 round each end, straight along the run.
  const rim = (x: number, y: number) => Math.hypot(x, Math.max(Math.abs(y) - 50, 0));
  t.finish({ type: "fillet", part: body, refs: t.edges(body, ([x, y, z]) => near0(z, 30) && near0(rim(x, y), -xc, 0.05)), size: 8 });
  return t.doc;
}

/**
 * 01-05 Paste Sleeve, ABS: a 3 mm skin lofted from a 45 × 38 slot to a 60 × 4 slot 103 mm up, with a straight 30 mm
 * sleeve under the bottom. Each sketch holds the slot and the slot 3 mm out, so the ring between them is the shape.
 */
function pasteSleeve(): ModelDoc {
  const t = new Timeline("Paste Sleeve");
  const bottom = t.sketch(world("XY"), (d) => {
    slot(d, [0, 0], 45, 38);
    slot(d, [0, 0], 51, 44);
  });
  const top = t.sketch(world("XY", 103), (d) => {
    slot(d, [0, 0], 60, 4);
    slot(d, [0, 0], 66, 10);
  });
  const body = t.loft({
    sections: [
      { sketch: bottom, seed: [0, 20.5] },
      { sketch: top, seed: [0, 3.5] },
    ],
    operation: "new",
  });
  t.extrude({ sketch: bottom, seeds: [[0, 20.5]], distance: -30, operation: "join", target: body });
  return t.doc;
}

export const PARTS: SpeedPart[] = (
  [
    {
      id: "ppp0102",
      name: "01-02 Post Cap",
      mass: 43.09,
      density: DENSITY.abs,
      missing: ["An ellipse in sketches, for the rim's bead and the handle's section", "Sweep, to run the handle's section along its arc"],
    },
    { id: "ppp0105", name: "01-05 Paste Sleeve", mass: 57.08, density: DENSITY.abs, build: pasteSleeve },
    {
      id: "ppp0107",
      name: "01-07 Flanged Hub",
      mass: 372.99,
      density: DENSITY.aluminium,
      missing: ["A taper angle on Extrude, for the three ribs (10° each side)"],
    },
    { id: "ppp0101", name: "01-01 Bearing Bracket", mass: 797.15, density: DENSITY.steel, build: bearingBracket },
    { id: "ppp0103", name: "01-03 C Clamp Base", mass: 96.13, density: DENSITY.aluminium, build: cClampBase },
    { id: "ppp0104", name: "01-04 Angle Bracket", mass: 310, density: DENSITY.steel, build: angleBracket },
    { id: "ppp0106", name: "01-06 Bearing Jig", mass: 328.02, density: DENSITY.steel, build: bearingJig },
    { id: "ppp0108", name: "01-08 Tie Plate", mass: 3387.06, density: DENSITY.steel, build: tiePlate },
    { id: "ppp0109", name: "01-09 Corner Tie", mass: 307.23, density: DENSITY.aluminium, build: cornerTie },
    { id: "ppp0110", name: "01-10 Light Cap", mass: 211.3, density: DENSITY.abs, build: lightCap },
  ] as SpeedPart[]
).sort((a, b) => a.id.localeCompare(b.id));
