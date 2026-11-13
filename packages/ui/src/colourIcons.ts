// Colour tool icons: a muted blue-grey solid drawn in the same three-quarter view, with one part in the icon accent
// (the face that moves, the edge that rounds, the new feature). Fusion-style, muted, one highlight.
//
// Each entry is the inner markup of a 24-unit SVG, keyed by the line icon it stands in for (ICONS) or by its own
// name ("sk-…" for sketch constraints). Colours are tokens only (--bc-color-icon-*), so the three themes restyle them.
// This module loads after first paint (Icon asks for it the first time a colour icon renders); until then, and for
// any name without a colour drawing, the line icon shows.

type Pt = [number, number];

const TOP = "var(--bc-color-icon-top)";
const SIDE = "var(--bc-color-icon-side)";
const DARK = "var(--bc-color-icon-side-dark)";
const EDGE = "var(--bc-color-icon-edge)";
const HOLE = "var(--bc-color-icon-hole)";
const HI = "var(--bc-color-icon-accent)";
const HI_S = "var(--bc-color-icon-accent-side)";
const HI_D = "var(--bc-color-icon-accent-dark)";

const C = 0.866;
/** Model space (x right-down, y left-down, z up, about ±8) to the 24-unit icon grid. */
const P = (x: number, y: number, z: number, ox = 12, oy = 13): Pt => [ox + (x - y) * C, oy + (x + y) * 0.5 - z];
const n = (v: number) => +v.toFixed(2);
const pts = (a: Pt[]) => a.map((p) => `${n(p[0])},${n(p[1])}`).join(" ");
const path = (a: Pt[], close = true) => "M" + a.map((p) => `${n(p[0])} ${n(p[1])}`).join("L") + (close ? "Z" : "");
const poly = (a: Pt[], fill: string, w = 0.9) => `<polygon points="${pts(a)}" fill="${fill}" stroke="${EDGE}" stroke-width="${w}" stroke-linejoin="round"/>`;
const line = (d: string, c = EDGE, w = 1.4, extra = "") =>
  `<path d="${d}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"${extra}/>`;
const hiLine = (d: string, w = 1.8, extra = "") => line(d, HI, w, extra);
const dot = (x: number, y: number, r = 1.6) => `<circle cx="${n(x)}" cy="${n(y)}" r="${r}" fill="${HI}" stroke="${EDGE}" stroke-width="0.6"/>`;
const sheet = (a: Pt[], w = 1.2) => `<polygon points="${pts(a)}" fill="${HI}" fill-opacity="0.55" stroke="${HI}" stroke-width="${w}" stroke-linejoin="round"/>`;
const dashed = ' stroke-dasharray="1.3 1.3"';

type Face = "T" | "L" | "R";
/** A box's three visible faces; the named ones in the accent. */
function box(x: number, y: number, z: number, w: number, d: number, h: number, hi: Face[] | "all" = [], o: { ox?: number; oy?: number } = {}) {
  const Q = (a: number, b: number, c: number) => P(a, b, c, o.ox, o.oy);
  const faces: Record<Face, Pt[]> = {
    T: [Q(x, y, z + h), Q(x + w, y, z + h), Q(x + w, y + d, z + h), Q(x, y + d, z + h)],
    R: [Q(x + w, y, z), Q(x + w, y + d, z), Q(x + w, y + d, z + h), Q(x + w, y, z + h)],
    L: [Q(x, y + d, z), Q(x + w, y + d, z), Q(x + w, y + d, z + h), Q(x, y + d, z + h)],
  };
  const lit = (f: Face) => hi === "all" || hi.includes(f);
  const fill: Record<Face, [string, string]> = { T: [TOP, HI], L: [SIDE, HI_S], R: [DARK, HI_D] };
  return (["L", "R", "T"] as Face[]).map((f) => poly(faces[f], fill[f][lit(f) ? 1 : 0])).join("");
}
const allHi: Face[] = ["T", "L", "R"];

/** An upright cylinder in icon units: its top ellipse at `top`, its foot at `bot`. */
function cyl(cx: number, top: number, bot: number, rx: number, ry: number, hi = false) {
  return (
    `<path d="M${n(cx - rx)} ${n(top)}V${n(bot)}A${rx} ${ry} 0 0 0 ${n(cx + rx)} ${n(bot)}V${n(top)}" fill="${hi ? HI_S : SIDE}" stroke="${EDGE}" stroke-width="0.9"/>` +
    `<ellipse cx="${n(cx)}" cy="${n(top)}" rx="${rx}" ry="${ry}" fill="${hi ? HI : TOP}" stroke="${EDGE}" stroke-width="0.9"/>`
  );
}

function gearPath(cx: number, cy: number, teeth: number, ro: number, ri: number) {
  let d = "";
  const s = (Math.PI * 2) / teeth;
  for (let i = 0; i < teeth; i++) {
    const a = i * s;
    const q: [number, number][] = [
      [ri, a - s * 0.5],
      [ri, a - s * 0.22],
      [ro, a - s * 0.14],
      [ro, a + s * 0.14],
      [ri, a + s * 0.22],
    ];
    q.forEach(([r, t], j) => (d += (i === 0 && j === 0 ? "M" : "L") + `${n(cx + r * Math.cos(t))} ${n(cy + r * Math.sin(t))}`));
  }
  return d + "Z";
}

const flatSquare = (h: number, r = 7, o: { ox?: number; oy?: number } = {}) => [
  P(-r, -r, h, o.ox, o.oy),
  P(r, -r, h, o.ox, o.oy),
  P(r, r, h, o.ox, o.oy),
  P(-r, r, h, o.ox, o.oy),
];

function fillet(round: boolean) {
  const x = -5,
    y = -5,
    z = -5,
    w = 10,
    d = 10,
    h = 8,
    r = 3;
  const A = P(x + w - r, y, z + h),
    B = P(x + w - r, y + d, z + h),
    Cn = P(x + w, y + d, z + h - r),
    D = P(x + w, y, z + h - r),
    K1 = P(x + w, y, z + h),
    K2 = P(x + w, y + d, z + h);
  const q = (k: Pt, e: Pt) => (round ? `Q${n(k[0])} ${n(k[1])} ${n(e[0])} ${n(e[1])}` : `L${n(e[0])} ${n(e[1])}`);
  const left = `M${pts([P(x, y + d, z)])}L${pts([P(x + w, y + d, z)])}L${pts([Cn])}${q(K2, B)}L${pts([P(x, y + d, z + h)])}Z`.replace(/,/g, " ");
  const band = `M${n(A[0])} ${n(A[1])}${q(K1, D)}L${n(Cn[0])} ${n(Cn[1])}${q(K2, B)}Z`;
  return (
    `<path d="${left}" fill="${SIDE}" stroke="${EDGE}" stroke-width="0.9" stroke-linejoin="round"/>` +
    poly([P(x + w, y, z), P(x + w, y + d, z), Cn, D], DARK) +
    poly([P(x, y, z + h), A, B, P(x, y + d, z + h)], TOP) +
    `<path d="${band}" fill="${HI}" stroke="${EDGE}" stroke-width="0.9" stroke-linejoin="round"/>`
  );
}

const plate = () =>
  poly(flatSquare(-3), TOP) +
  poly([P(-7, 7, -3), P(7, 7, -3), P(7, 7, -4.5), P(-7, 7, -4.5)], SIDE) +
  poly([P(7, -7, -3), P(7, 7, -3), P(7, 7, -4.5), P(7, -7, -4.5)], DARK);

const DRAW: Record<string, () => string> = {
  // Arrange
  arrow: () =>
    box(1, 1, -5, 5, 5, 5, [], { ox: 13 }) +
    `<path d="M5 2.5V16l3.6-3.2 2.4 5.4 2.4-1.1-2.4-5.3h4.9z" fill="${HI}" stroke="${EDGE}" stroke-width="0.9" stroke-linejoin="round"/>`,
  move: () => box(-3.5, -3.5, -2, 7, 7, 5) + hiLine("M12 1.5v4M10 3.5l2-2 2 2M2 15.5h5M3.8 13.7 2 15.5l1.8 1.8M22 15.5h-5M20.2 13.7l1.8 1.8-1.8 1.8", 1.6),
  rotate: () => box(-3.5, -3.5, -2, 7, 7, 5) + hiLine("M4 8.5A9 6 0 0 1 20.5 7.5M18 4.6l2.6 2.9-3.6 1.2", 1.7),
  // Create
  sketch: () => {
    const r = [P(-4, -4, -1), P(4, -4, -1), P(4, 3, -1), P(-4, 3, -1)];
    return poly(flatSquare(-1), TOP) + hiLine(path(r), 1.6) + dot(r[0][0], r[0][1], 1.3) + dot(r[2][0], r[2][1], 1.3);
  },
  extrude: () => box(-5, -5, -5, 10, 10, 7, ["T"]) + hiLine("M12 9V1.5M9.8 3.7 12 1.5l2.2 2.2", 1.8),
  pushpull: () => box(-5, -5, -5, 10, 10, 5) + box(-3, -3, 0, 6, 6, 3, allHi) + line("M12 1v3", EDGE, 1.3),
  revolve: () =>
    cyl(13, 6, 18, 6.5, 2.4) + `<path d="M13 6V18H19.5V6z" fill="${HI}" stroke="${EDGE}" stroke-width="0.9"/>` + line("M13 2V22", EDGE, 1.1, dashed),
  loft: () => {
    const b = flatSquare(-5, 6),
      t = flatSquare(5, 2.5);
    return poly([b[3]!, b[2]!, t[2]!, t[3]!], SIDE) + poly([b[1]!, b[2]!, t[2]!, t[1]!], DARK) + poly(t, TOP) + hiLine(path(b.slice(1), false) + path(t), 1.6);
  },
  sweep: () => {
    const d = "M5 19.5C5 11 10 6 19.5 6";
    return (
      line(d, EDGE, 6.6) +
      line(d, SIDE, 4.8) +
      line(d, TOP, 1.6) +
      `<ellipse cx="5" cy="20" rx="3.3" ry="1.6" fill="${HI}" stroke="${EDGE}" stroke-width="0.9"/><ellipse cx="20" cy="6" rx="1.4" ry="3.2" fill="${TOP}" stroke="${EDGE}" stroke-width="0.9"/>`
    );
  },
  // Modify
  fillet: () => fillet(true),
  chamfer: () => fillet(false),
  shell: () => {
    const t = 1.6;
    const inner = [P(-5 + t, -5 + t, 3), P(5 - t, -5 + t, 3), P(5 - t, 5 - t, 3), P(-5 + t, 5 - t, 3)];
    const floor = [P(-5 + t, -5 + t, -3), P(5 - t, -5 + t, -3)];
    return (
      box(-5, -5, -5, 10, 10, 8) +
      poly(inner, HI) +
      poly([inner[0]!, inner[1]!, floor[1]!, floor[0]!], HI_D, 0.6) +
      poly([inner[0]!, floor[0]!, P(-5 + t, 5 - t, -3), inner[3]!], HI_S, 0.6)
    );
  },
  combine: () => box(-6, -3, -5, 7, 7, 7) + box(-1, -5, -3, 7, 7, 7, allHi),
  split: () => box(-6, -5, -5, 5, 10, 8) + sheet([P(0.2, -7, -6), P(0.2, 7, -6), P(0.2, 7, 5), P(0.2, -7, 5)], 1.1) + box(1.5, -5, -5, 5, 10, 8),
  hole: () => {
    const [cx, cy] = P(0, 0, 2);
    return (
      box(-6, -6, -4, 12, 12, 6) +
      `<ellipse cx="${n(cx)}" cy="${n(cy)}" rx="4.15" ry="2.4" fill="${HI}" stroke="${EDGE}" stroke-width="0.9"/>` +
      `<path d="M${n(cx - 4.15)} ${n(cy)}A4.15 2.4 0 0 1 ${n(cx + 4.15)} ${n(cy)}A4.15 1.4 0 0 0 ${n(cx - 4.15)} ${n(cy)}z" fill="${HI_D}"/>`
    );
  },
  offsetFace: () =>
    box(-6, -5, -5, 9, 10, 8) +
    poly([P(6, -5, -5), P(6, 5, -5), P(6, 5, 3), P(6, -5, 3)], HI) +
    `<polygon points="${pts([P(3, -5, -5), P(6, -5, -5), P(6, -5, 3), P(3, -5, 3)])}" fill="none" stroke="${EDGE}" stroke-width="0.8"${dashed}/>`,
  image: () =>
    box(-5, -5, -5, 10, 10, 8) +
    poly([P(5, -3, -3.5), P(5, 0.5, 1.5), P(5, 3.6, -3.5)], HI, 0.7) +
    `<circle cx="${n(P(5, -2, 1.2)[0])}" cy="${n(P(5, -2, 1.2)[1])}" r="1.1" fill="${HI}"/>`,
  // Copy
  distributeH: () =>
    box(-7.5, -1.5, -4, 4, 4, 4, allHi, { ox: 10, oy: 9 }) +
    box(-1.5, -1.5, -4, 4, 4, 4, [], { ox: 10, oy: 9 }) +
    box(4.5, -1.5, -4, 4, 4, 4, [], { ox: 10, oy: 9 }),
  flipH: () => {
    const o = { ox: 11, oy: 12 };
    return (
      box(-7, -3, -4, 5, 6, 6, [], o) +
      sheet([P(-0.5, -7, -6, 11, 12), P(-0.5, 7, -6, 11, 12), P(-0.5, 7, 5, 11, 12), P(-0.5, -7, 5, 11, 12)]) +
      box(1, -3, -4, 5, 6, 6, [], o)
    );
  },
  track: () =>
    `<rect x="2" y="7" width="20" height="10" rx="5" fill="${HI}" stroke="${EDGE}" stroke-width="0.9"/><rect x="4" y="9" width="16" height="6" rx="3" fill="${HOLE}" stroke="${EDGE}" stroke-width="0.6"/>` +
    `<circle cx="7" cy="12" r="2.6" fill="${SIDE}" stroke="${EDGE}" stroke-width="0.9"/><circle cx="17" cy="12" r="2.6" fill="${SIDE}" stroke="${EDGE}" stroke-width="0.9"/>`,
  // Library shapes and arranging steps, as the timeline shows them: the new part in the accent.
  cube: () => box(-5, -5, -5, 10, 10, 9, allHi),
  cylinder: () => cyl(12, 7, 18, 7.5, 2.8, true),
  sphere: () =>
    `<circle cx="12" cy="12" r="8.5" fill="${HI}" stroke="${EDGE}" stroke-width="0.9"/>` +
    `<path d="M3.5 12a8.5 3 0 0 0 17 0" fill="none" stroke="${EDGE}" stroke-width="0.8"/>`,
  cone: () => `<path d="M12 3 4.5 17.5A7.5 2.8 0 0 0 19.5 17.5Z" fill="${HI}" stroke="${EDGE}" stroke-width="0.9" stroke-linejoin="round"/>`,
  torus: () =>
    `<ellipse cx="12" cy="13" rx="9.5" ry="5.5" fill="${HI}" stroke="${EDGE}" stroke-width="0.9"/>` +
    `<ellipse cx="12" cy="12.4" rx="3.6" ry="1.7" fill="${HOLE}" stroke="${EDGE}" stroke-width="0.8"/>`,
  wedge: () => poly([P(-5, 5, -5), P(5, 5, -5), P(-5, 5, 4)], HI_S) + poly([P(-5, -5, 4), P(5, -5, -5), P(5, 5, -5), P(-5, 5, 4)], HI),
  resize: () => box(-4, -4, -4, 8, 8, 6) + hiLine("M3 21l4.5-4.5M3 21h4M3 21v-4M21 3l-4.5 4.5M21 3h-4M21 3v4", 1.6),
  copy: () => box(-6, -1, -5, 6, 6, 6, [], { ox: 10, oy: 13 }) + box(-1, -6, -3, 6, 6, 6, allHi, { ox: 14, oy: 11 }),
  // Construct
  plane: () => box(-2.5, -2.5, -6, 5, 5, 5) + sheet(flatSquare(0, 8), 1.3),
  axis: () => box(-3.5, -3.5, -4, 7, 7, 6) + hiLine("M12 1V23", 1.9),
  point: () => {
    const [x, y] = P(4.5, -4.5, 2);
    return box(-4.5, -4.5, -5, 9, 9, 7) + `<circle cx="${n(x)}" cy="${n(y)}" r="2.6" fill="${HI}" stroke="${EDGE}" stroke-width="0.9"/>`;
  },
  // Insert
  shapes: () => {
    const o = { ox: 12, oy: 14 };
    return box(-6.5, -1, -6, 5, 5, 5, [], o) + box(-1, -1, -6, 5, 5, 5, [], o) + box(-3.6, -3.6, -1, 5, 5, 5, allHi, o);
  },
  gear: () =>
    `<path d="${gearPath(12, 12, 9, 10, 7.6)}" fill="${SIDE}" stroke="${EDGE}" stroke-width="0.9" stroke-linejoin="round"/>` +
    `<circle cx="12" cy="12" r="6.4" fill="${TOP}" stroke="${EDGE}" stroke-width="0.6"/><circle cx="12" cy="12" r="3.4" fill="${HI}" stroke="${EDGE}" stroke-width="0.9"/>` +
    `<circle cx="12" cy="12" r="1.3" fill="${HOLE}" stroke="${EDGE}" stroke-width="0.6"/>`,
  screw: () => {
    const a = P(-3.5, -3.5, 3),
      a0 = P(-3.5, -3.5, -3),
      b = P(3.5, 3.5, 3),
      b0 = P(3.5, 3.5, -3);
    return plate() + cyl(a[0], a[1], a0[1], 1.9, 0.9, true) + cyl(b[0], b[1], b0[1], 1.9, 0.9, true);
  },
  component: () =>
    `<rect x="2.5" y="2.5" width="19" height="19" rx="3" fill="none" stroke="${HI}" stroke-width="1.5" stroke-dasharray="2.4 1.8"/>` + box(-4, -4, -3, 8, 8, 6),
  sliders: () =>
    line("M4 6h16M4 12h16M4 18h16", EDGE, 1.5) +
    `<circle cx="8" cy="6" r="2.2" fill="${TOP}" stroke="${EDGE}"/><circle cx="15" cy="12" r="2.4" fill="${HI}" stroke="${EDGE}"/><circle cx="10" cy="18" r="2.2" fill="${TOP}" stroke="${EDGE}"/>`,
  printer: () =>
    `<path d="M3 3h18v18H3z" fill="none" stroke="${EDGE}" stroke-width="1.5" stroke-linejoin="round"/><rect x="3" y="5.5" width="18" height="2.2" fill="${SIDE}" stroke="${EDGE}" stroke-width="0.7"/>` +
    `<path d="M10.5 7.7h3l-1.5 2.4z" fill="${DARK}" stroke="${EDGE}" stroke-width="0.7"/><rect x="5" y="17" width="14" height="2.2" fill="${TOP}" stroke="${EDGE}" stroke-width="0.7"/>` +
    `<rect x="9" y="12.5" width="6" height="4.5" fill="${HI}" stroke="${EDGE}" stroke-width="0.7"/>`,
  // Assemble
  joint: () =>
    box(-7, -2.5, -4, 6, 5, 4) +
    box(1, -2.5, -1, 6, 5, 4) +
    `<ellipse cx="12" cy="11.5" rx="3.6" ry="2.1" fill="none" stroke="${HI}" stroke-width="2"/>` +
    hiLine("M12 4.5v14", 1.2, dashed),
  link: () =>
    box(-7, -2.5, -4, 6, 5, 5) +
    box(1, -2.5, -4, 6, 5, 5) +
    `<rect x="8.4" y="8.2" width="7.2" height="3.6" rx="1.8" fill="none" stroke="${HI}" stroke-width="1.7"/>`,
  // Inspect
  ruler: () =>
    `<polygon points="2.5,16 16,2.5 21.5,8 8,21.5" fill="${TOP}" stroke="${EDGE}" stroke-width="0.9" stroke-linejoin="round"/>` +
    `<polygon points="8,21.5 21.5,8 21.5,9.6 8,23.1" fill="${DARK}" stroke="${EDGE}" stroke-width="0.7" stroke-linejoin="round"/>` +
    hiLine("M6.5 12l2.4 2.4M9.5 9l2.4 2.4M12.5 6l2.4 2.4M15.5 3.4l1.6 1.6", 1.5),
  section: () =>
    box(-5, -5, -5, 5, 10, 9, ["R"]) +
    `<polygon points="${pts([P(0, -5, 4), P(5, -5, 4), P(5, 5, 4), P(0, 5, 4)])}" fill="none" stroke="${EDGE}" stroke-width="0.7"${dashed}/>` +
    `<polyline points="${pts([P(5, -5, 4), P(5, -5, -5), P(5, 5, -5), P(0, 5, -5)])}" fill="none" stroke="${EDGE}" stroke-width="0.7"${dashed}/>`,
  camera: () =>
    `<ellipse cx="12" cy="20" rx="8" ry="2" fill="${DARK}" opacity="0.5"/><circle cx="12" cy="11" r="8" fill="${SIDE}" stroke="${EDGE}" stroke-width="0.9"/>` +
    `<path d="M12 3a8 8 0 0 0 0 16a8 8 0 0 1 0-16z" fill="${TOP}"/><circle cx="12" cy="11" r="8" fill="none" stroke="${EDGE}" stroke-width="0.9"/><circle cx="9" cy="7.8" r="2.6" fill="${HI}"/>`,
  clash: () => box(-6, -3, -5, 7, 7, 7) + box(-1, -5, -3, 7, 7, 7) + poly([P(-1, -3, 2), P(1, -3, 2), P(1, 2, 2), P(-1, 2, 2)], HI, 0.7),
  // Sketch: flat shapes with their points in the accent
  line: () => line("M5 19L19 5", EDGE, 1.8) + dot(5, 19, 2) + dot(19, 5, 2),
  rect: () => `<rect x="4" y="6" width="16" height="12" fill="${TOP}" stroke="${EDGE}" stroke-width="1.6"/>` + dot(4, 18, 2) + dot(20, 6, 2),
  circle: () => `<circle cx="12" cy="12" r="8" fill="${TOP}" stroke="${EDGE}" stroke-width="1.6"/>` + line("M12 12h8", EDGE, 1, dashed) + dot(12, 12, 2),
  arc: () => line("M4 18A9 9 0 0 1 20 18", EDGE, 1.8) + dot(4, 18, 2) + dot(20, 18, 2) + dot(12, 8.3, 1.4),
  slot: () => `<rect x="3" y="8" width="18" height="8" rx="4" fill="${TOP}" stroke="${EDGE}" stroke-width="1.6"/>` + dot(7, 12, 1.7) + dot(17, 12, 1.7),
  ellipse: () => `<ellipse cx="12" cy="12" rx="9" ry="5.5" fill="${TOP}" stroke="${EDGE}" stroke-width="1.6"/>` + dot(12, 12, 1.8) + dot(21, 12, 1.5),
  spline: () => line("M3 17C7 3 12 21 21 7", EDGE, 1.8) + dot(3, 17, 1.8) + dot(12, 12.3, 1.5) + dot(21, 7, 1.8),
  polygon: () =>
    `<path d="M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9z" fill="${TOP}" stroke="${EDGE}" stroke-width="1.6" stroke-linejoin="round"/>` +
    dot(12, 12, 1.6) +
    dot(12, 3, 1.6),
  text: () => line("M5 6.5V4.5h14v2M12 4.5v15M9 19.5h6", EDGE, 2.2) + dot(19, 19, 1.8),
  dimension: () =>
    line("M4 17V9M20 17V9", EDGE, 1.2) +
    hiLine("M4 13h16M7 10.5 4 13l3 2.5M17 10.5l3 2.5-3 2.5", 1.6) +
    `<rect x="8.5" y="5" width="7" height="4.6" rx="1" fill="${TOP}" stroke="${EDGE}" stroke-width="0.8"/>`,
  crop: () => line("M3 12h7M14 12h7", EDGE, 1.8) + line("M10 12h4", HI, 1.8, dashed) + hiLine("M9 6l6 12M15 6 9 18", 1.3),
  shrink: () =>
    `<rect x="3" y="3" width="18" height="18" rx="2" fill="none" stroke="${EDGE}" stroke-width="1.6"/>` +
    `<rect x="7" y="7" width="10" height="10" rx="1" fill="none" stroke="${HI}" stroke-width="1.8"/>`,
  body: () => box(-5, -5, -6, 10, 10, 6) + hiLine(path(flatSquare(3, 5)), 1.5),
  constraint: () => line("M3 19L12 12M12 12L21 16", EDGE, 1.6) + dot(12, 12, 2.6),
  "sk-fillet": () => line("M4 20V11a7 7 0 0 1 7-7h9", EDGE, 1.8) + hiLine("M4 11a7 7 0 0 1 7-7", 2.2),
  "sk-mirror": () =>
    line("M12 2v20", HI, 1.6, dashed) +
    `<path d="M9 7 3 17h6z" fill="${TOP}" stroke="${EDGE}" stroke-width="1.4" stroke-linejoin="round"/><path d="M15 7l6 10h-6z" fill="none" stroke="${EDGE}" stroke-width="1.4" stroke-linejoin="round"${dashed}/>`,
  "sk-coincident": () => line("M3 19L12 12M12 12L21 16", EDGE, 1.6) + dot(12, 12, 2.6),
  "sk-horizontalVertical": () =>
    line("M4 7h16M17 4v16", EDGE, 1.6) + `<rect x="7" y="4.5" width="5" height="5" rx="1" fill="${HI}" stroke="${EDGE}" stroke-width="0.7"/>`,
  "sk-parallel": () => line("M4 15L14 5M10 19L20 9", EDGE, 1.6) + hiLine("M8 8.5l3 3M13.5 14l1 1", 1.4),
  "sk-perpendicular": () => line("M4 20h16M8 20V4", EDGE, 1.6) + `<path d="M8 15h5v5" fill="none" stroke="${HI}" stroke-width="1.6"/>`,
  "sk-tangent": () => `<circle cx="11" cy="13" r="6" fill="${TOP}" stroke="${EDGE}" stroke-width="1.6"/>` + line("M3 7h18", EDGE, 1.6) + dot(11, 7, 2),
  "sk-equal": () => line("M4 9h7M13 9h7M4 15h16", EDGE, 1.6) + hiLine("M7.5 6.5v5M12 12.5v5", 1.5),
  "sk-concentric": () =>
    `<circle cx="12" cy="12" r="9" fill="none" stroke="${EDGE}" stroke-width="1.6"/><circle cx="12" cy="12" r="5" fill="${TOP}" stroke="${EDGE}" stroke-width="1.6"/>` +
    dot(12, 12, 1.8),
  "sk-midpoint": () =>
    line("M3 18L21 6", EDGE, 1.6) +
    dot(3, 18, 1.4) +
    dot(21, 6, 1.4) +
    `<path d="M12 9.5l2.6 2.5-2.6 2.5-2.6-2.5z" fill="${HI}" stroke="${EDGE}" stroke-width="0.7"/>`,
  "sk-fix": () =>
    line("M4 19L20 5", EDGE, 1.6) +
    `<rect x="9" y="10" width="6" height="5.5" rx="1" fill="${HI}" stroke="${EDGE}" stroke-width="0.8"/>` +
    line("M10.4 10V8.4a1.6 1.6 0 0 1 3.2 0V10", EDGE, 1.2),
  "sk-symmetric": () => line("M12 2v20", EDGE, 1.2, dashed) + dot(5, 12, 2) + dot(19, 12, 2) + hiLine("M7.5 12h2.5M14 12h2.5", 1.4),
};

let cache: Record<string, string> | null = null;

/** Every colour icon's SVG markup, by name. Drawn once, on first use. */
export function colourIcons(): Record<string, string> {
  if (!cache) cache = Object.fromEntries(Object.entries(DRAW).map(([k, f]) => [k, f()]));
  return cache;
}
