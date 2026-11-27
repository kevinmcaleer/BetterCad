/**
 * True bodies for the starter parts (#752), drawn in code from the footprint and a few sizes: a header's strip and its
 * pins, a chip's body and its leads, a switch's shell and its lever. Each is boxes and cylinders in the materials a
 * made part shows, so a board in 3D looks like the board that comes back from the fab, and nothing is downloaded.
 *
 * Bodies are in the footprint's own millimetres: z = 0 is the face of the board the part stands on, and anything below
 * it goes through the board. A part no rule here knows keeps its simple box.
 */
import { emptyBox, grow } from "../geom";
import { bodyBox } from "../library/body";
import type { FootprintDef, Model3D, Pad } from "../model";

type V3 = [number, number, number];

/** One block, as the modelling kernel's catalogue blocks are: a box stands on the middle of its base; a cylinder starts at the middle of its first end. */
export interface BodyBlock {
  kind: "box" | "cylinder";
  /** Across, deep and tall before turning; a cylinder is [diameter, diameter, length]. */
  size: V3;
  at: V3;
  axis?: "x" | "y" | "z";
}

/** What each piece is made of, which sets its colour. */
export type BodyMaterial = "plastic-black" | "plastic-white" | "plastic-green" | "metal" | "gold" | "ceramic" | "led" | "module";

export interface BodyPiece {
  material: BodyMaterial;
  blocks: BodyBlock[];
}

/** The part a body is drawn for. `prefix` is its reference's letters (R, C, D, U, J…), which tell a resistor from a capacitor of the same size. */
export interface BodyAsk {
  name: string;
  prefix: string;
  footprint: FootprintDef;
  model?: Model3D;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const box = (x: number, y: number, z: number, w: number, d: number, h: number): BodyBlock => ({
  kind: "box",
  size: [r3(w), r3(d), r3(h)],
  at: [r3(x), r3(y), r3(z)],
});
const cyl = (x: number, y: number, z: number, dia: number, h: number): BodyBlock => ({
  kind: "cylinder",
  size: [r3(dia), r3(dia), r3(h)],
  at: [r3(x), r3(y), r3(z)],
});

/** How far a through-hole lead pokes out under the board, from the face the part stands on. */
const TAIL = 3;

/** A pad's size across and deep, turned with it. */
const padSize = (p: Pad): [number, number] => (Math.abs(((p.angle ?? 0) % 180) - 90) < 1 ? [p.h, p.w] : [p.w, p.h]);
const thru = (fp: FootprintDef) => fp.pads.filter((p) => p.drill && p.kind !== "npth" && p.kind !== "smd");
const smd = (fp: FootprintDef) => fp.pads.filter((p) => p.kind === "smd" && !p.back);

/** Where a part's body sits: its model's box, or its fabrication drawing's, and how tall. */
function outline(a: BodyAsk, tall: number) {
  const s = a.model?.source;
  if (s?.kind === "box") {
    const [cx, cy] = a.model?.offset ?? [0, 0];
    return { x1: cx - s.size[0] / 2, y1: cy - s.size[1] / 2, x2: cx + s.size[0] / 2, y2: cy + s.size[1] / 2, h: s.size[2] };
  }
  return { ...bodyBox(a.footprint), h: tall };
}

/** Square pins through the board, from under it up to `top`. */
const pins = (pads: Pad[], top: number, side = 0.64): BodyBlock[] => pads.map((p) => box(p.x, p.y, -TAIL, side, side, TAIL + top));

/** Round leads through the board, from under it up to `top`. */
const leads = (pads: Pad[], top: number): BodyBlock[] => pads.map((p) => cyl(p.x, p.y, -TAIL, Math.min(0.6, (p.drill ?? 0.8) * 0.7), TAIL + top));

/** A pin header or socket (#752): a black strip with gold pins, or a socket's tall housing with its tails under the board. */
function header(a: BodyAsk): BodyPiece[] | null {
  if (/Horizontal|SMD/.test(a.name)) return null;
  if (a.model?.source.kind !== "header" && !/^Pin(Header|Socket)_/.test(a.name)) return null;
  const pads = thru(a.footprint);
  if (!pads.length) return null;
  const s = a.model?.source;
  const pitch = s?.kind === "header" ? s.pitch : Number(/P([\d.]+)mm/.exec(a.name)?.[1] ?? 2.54);
  const socket = s?.kind === "header" ? s.height > 5 : /Socket/.test(a.name);
  const b = emptyBox();
  for (const p of pads) grow(b, [p.x, p.y], pitch / 2);
  const tall = socket ? (s?.kind === "header" ? s.height : 8.5) : 2.5;
  const housing = box((b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2, 0, b.x2 - b.x1, b.y2 - b.y1, tall);
  const side = pitch < 2 ? 0.4 : 0.64;
  return [
    { material: "plastic-black", blocks: [housing] },
    { material: "gold", blocks: socket ? pins(pads, 0, side) : pins(pads, tall + 6, side) },
  ];
}

/** A two-ended chip (#752): resistors black with tinned ends, capacitors tan, LEDs white with a coloured lens. */
function chip(a: BodyAsk): BodyPiece[] | null {
  const pads = smd(a.footprint);
  if (pads.length !== 2) return null;
  const [p, q] = pads as [Pad, Pad];
  const along = Math.abs(q.x - p.x) >= Math.abs(q.y - p.y) ? "x" : "y";
  const o = outline(a, 0.55);
  const [cx, cy] = [(o.x1 + o.x2) / 2, (o.y1 + o.y2) / 2];
  const [L, W] = along === "x" ? [o.x2 - o.x1, o.y2 - o.y1] : [o.y2 - o.y1, o.x2 - o.x1];
  const end = Math.min(0.5, L * 0.2);
  const at = (t: number, len: number, z: number, h: number, w = W) => (along === "x" ? box(cx + t, cy, z, len, w, h) : box(cx, cy + t, z, w, len, h));
  const ends = { material: "metal" as const, blocks: [at(-(L - end) / 2, end, 0, o.h), at((L - end) / 2, end, 0, o.h)] };
  const middle = L - 2 * end;
  if (/^D|^LED/.test(a.prefix) || /^LED_/.test(a.name))
    return [
      ends,
      { material: "plastic-white", blocks: [at(0, middle, 0, o.h * 0.6)] },
      { material: "led", blocks: [at(0, middle, o.h * 0.6, o.h * 0.4, W * 0.8)] },
    ];
  return [ends, { material: /^C/.test(a.prefix) || /^C_/.test(a.name) ? "ceramic" : "plastic-black", blocks: [at(0, middle, 0, o.h * 0.95)] }];
}

/** A DIP (#752): a black body on its standoffs, with the leads bent down through the board. */
function dip(a: BodyAsk): BodyPiece[] | null {
  const pads = thru(a.footprint);
  if (pads.length < 4) return null;
  const xs = [...new Set(pads.map((p) => r3(p.x)))].sort((m, n) => m - n);
  if (xs.length !== 2) return null;
  const [x1, x2] = xs as [number, number];
  const ys = pads.map((p) => p.y);
  const [y1, y2] = [Math.min(...ys), Math.max(...ys)];
  const across = x2 - x1 - 1.27;
  const long = y2 - y1 + 1.6;
  const lift = 0.5;
  const tall = 3.3;
  const cx = (x1 + x2) / 2;
  const legs = pads.map((p) => box(p.x, p.y, -TAIL, 0.5, 0.25, TAIL + lift + 0.6));
  const shoulders = pads.map((p) =>
    box((p.x + (p.x < cx ? cx - across / 2 : cx + across / 2)) / 2, p.y, lift + 0.6, Math.abs(x2 - x1 - across) / 2 + 0.25, 0.5, 0.25),
  );
  return [
    { material: "plastic-black", blocks: [box(cx, (y1 + y2) / 2, lift, across, long, tall)] },
    { material: "metal", blocks: [...legs, ...shoulders] },
  ];
}

/**
 * A surface chip with leads (#752): SOIC, SSOP, TSSOP, MSOP, SOT. Its body over the middle and a lead from each pad
 * that pokes out from under it, a foot on the pad and a riser up to the body. Pads wholly under the body (QFN, LGA,
 * a thermal pad) show as a thin edge of metal.
 */
function leaded(a: BodyAsk): BodyPiece[] | null {
  const pads = smd(a.footprint);
  if (pads.length < 3) return null;
  const o = outline(a, 1.6);
  const [cx, cy] = [(o.x1 + o.x2) / 2, (o.y1 + o.y2) / 2];
  const lift = o.h > 1 ? 0.1 : 0;
  const metal: BodyBlock[] = [];
  for (const p of pads) {
    const [w, d] = padSize(p);
    const out = [o.x1 - p.x, p.x - o.x2, o.y1 - p.y, p.y - o.y2];
    const far = Math.max(...out);
    if (far <= -Math.min(w, d) / 2) {
      // Under the body: a sliver at its edge, where the solder shows.
      continue;
    }
    const side = out.indexOf(far);
    const sideways = side < 2;
    const wide = Math.min(sideways ? d : w, 0.5) * 0.8;
    const edge = side === 0 ? o.x1 : side === 1 ? o.x2 : side === 2 ? o.y1 : o.y2;
    const tip = sideways ? p.x + (side === 0 ? -w / 2 : w / 2) * 0.8 : p.y + (side === 2 ? -d / 2 : d / 2) * 0.8;
    const len = Math.max(0.2, Math.abs(tip - edge));
    const mid = (tip + edge) / 2;
    const riser = edge + (side === 0 || side === 2 ? -0.1 : 0.1);
    const rise = lift + o.h * 0.45;
    if (sideways) metal.push(box(mid, p.y, 0, len, wide, 0.15), box(riser, p.y, 0, 0.2, wide, rise));
    else metal.push(box(p.x, mid, 0, wide, len, 0.15), box(p.x, riser, 0, wide, 0.2, rise));
  }
  return [
    { material: "plastic-black", blocks: [box(cx, cy, lift, o.x2 - o.x1, o.y2 - o.y1, o.h - lift)] },
    ...(metal.length ? [{ material: "metal" as const, blocks: metal }] : []),
  ];
}

/** A JST socket (#752): a natural white housing, tinned pins, and the metal tabs that hold it down. */
function jst(a: BodyAsk): BodyPiece[] | null {
  const o = outline(a, 3);
  const metal: BodyBlock[] = [];
  for (const p of a.footprint.pads) {
    const [w, d] = padSize(p);
    if (p.drill) metal.push(...pins([p], o.h * 0.6, 0.5));
    else if (/^MP$|^$/.test(p.number)) metal.push(box(p.x, p.y, 0, w * 0.8, d * 0.8, Math.min(1.2, o.h)));
    else metal.push(box(p.x, p.y, 0, w * 0.6, d * 0.7, 0.15));
  }
  return [
    { material: "plastic-white", blocks: [box((o.x1 + o.x2) / 2, (o.y1 + o.y2) / 2, 0, o.x2 - o.x1, o.y2 - o.y1, o.h)] },
    { material: "metal", blocks: metal },
  ];
}

/** A slide switch (#752): its metal shell, the lever out of the side away from its pins, and the pins. */
function slide(a: BodyAsk): BodyPiece[] | null {
  const o = outline(a, 1.4);
  const signal = a.footprint.pads.filter((p) => /^\d+$/.test(p.number));
  if (!signal.length) return null;
  const tall = Math.min(o.h, 1.4);
  const [cx, cy] = [(o.x1 + o.x2) / 2, (o.y1 + o.y2) / 2];
  const py = signal.reduce((k, p) => k + p.y, 0) / signal.length;
  const px = signal.reduce((k, p) => k + p.x, 0) / signal.length;
  const rowAlongX = Math.abs(o.x2 - o.x1) >= Math.abs(o.y2 - o.y1);
  const lever = rowAlongX
    ? box(cx, py > cy ? o.y1 - 0.75 : o.y2 + 0.75, tall * 0.2, 1.4, 1.5, tall * 0.6)
    : box(px > cx ? o.x1 - 0.75 : o.x2 + 0.75, cy, tall * 0.2, 1.5, 1.4, tall * 0.6);
  const feet = a.footprint.pads.map((p) => {
    const [w, d] = padSize(p);
    return p.drill ? pins([p], tall * 0.5, 0.5)[0]! : box(p.x, p.y, 0, w * 0.6, d * 0.6, 0.2);
  });
  return [
    { material: "metal", blocks: [box(cx, cy, 0, o.x2 - o.x1, o.y2 - o.y1, tall), ...feet] },
    { material: "plastic-black", blocks: [lever] },
  ];
}

/** A tactile button (#752): a black base, a metal plate on it and a round black button on top. */
function button(a: BodyAsk): BodyPiece[] | null {
  const o = outline(a, 4.3);
  const [cx, cy] = [(o.x1 + o.x2) / 2, (o.y1 + o.y2) / 2];
  const w = o.x2 - o.x1;
  const d = o.y2 - o.y1;
  const base = Math.min(3.5, o.h * 0.7);
  const plate = 0.3;
  const feet = a.footprint.pads.map((p) => {
    const [pw, pd] = padSize(p);
    return p.drill ? pins([p], 0.5, 0.6)[0]! : box(p.x, p.y, 0, pw * 0.6, pd * 0.6, 0.2);
  });
  return [
    { material: "plastic-black", blocks: [box(cx, cy, 0, w, d, base), cyl(cx, cy, base + plate, Math.min(w, d) * 0.55, Math.max(0.3, o.h - base - plate))] },
    { material: "metal", blocks: [box(cx, cy, base, w * 0.98, d * 0.98, plate), ...feet] },
  ];
}

/** A round can or a round LED (#752): the body, and its leads through the board. */
function radial(a: BodyAsk): BodyPiece[] | null {
  const s = a.model?.source;
  if (s?.kind !== "cylinder") return null;
  const [cx, cy] = a.model?.offset ?? [0, 0];
  const pads = thru(a.footprint);
  if (/LED/.test(a.name))
    return [
      { material: "led", blocks: [cyl(cx, cy, 0.5, s.diameter + 0.8, 1), cyl(cx, cy, 1.5, s.diameter, s.height - 1.5)] },
      { material: "metal", blocks: leads(pads, 0.5) },
    ];
  return [
    { material: "plastic-black", blocks: [cyl(cx, cy, 0.3, s.diameter, s.height - 0.6)] },
    { material: "metal", blocks: [cyl(cx, cy, s.height - 0.3, s.diameter * 0.96, 0.3), ...leads(pads, 0.3)] },
  ];
}

/** A USB socket (#752): a metal shell, and its legs. */
function usb(a: BodyAsk): BodyPiece[] | null {
  const o = outline(a, 3.2);
  const feet = a.footprint.pads.map((p) => (p.drill ? leads([p], 0.5)[0]! : box(p.x, p.y, 0, padSize(p)[0] * 0.6, padSize(p)[1] * 0.6, 0.15)));
  return [{ material: "metal", blocks: [box((o.x1 + o.x2) / 2, (o.y1 + o.y2) / 2, 0, o.x2 - o.x1, o.y2 - o.y1, o.h), ...feet] }];
}

/** An ESP module (#752): its board, and the metal can over the chip, leaving the antenna end bare. */
function espModule(a: BodyAsk): BodyPiece[] | null {
  const o = outline(a, 3.2);
  const pads = smd(a.footprint);
  if (pads.length < 8) return null;
  const pb = emptyBox();
  for (const p of pads) grow(pb, [p.x, p.y]);
  // The antenna is at the end that reaches furthest past the pads.
  const over = [pb.x1 - o.x1, o.x2 - pb.x2, pb.y1 - o.y1, o.y2 - pb.y2];
  const side = over.indexOf(Math.max(...over));
  const bare = Math.min(6.5, (side < 2 ? o.x2 - o.x1 : o.y2 - o.y1) * 0.3);
  const can = { ...o };
  if (side === 0) can.x1 += bare;
  else if (side === 1) can.x2 -= bare;
  else if (side === 2) can.y1 += bare;
  else can.y2 -= bare;
  const thick = 0.8;
  const inset = 0.5;
  return [
    { material: "module", blocks: [box((o.x1 + o.x2) / 2, (o.y1 + o.y2) / 2, 0, o.x2 - o.x1, o.y2 - o.y1, thick)] },
    {
      material: "metal",
      blocks: [box((can.x1 + can.x2) / 2, (can.y1 + can.y2) / 2, thick, can.x2 - can.x1 - 2 * inset, can.y2 - can.y1 - 2 * inset, Math.max(0.5, o.h - thick))],
    },
  ];
}

/** A TO-220 (#752): a black body standing up with its metal tab behind, and three legs. */
function to220(a: BodyAsk): BodyPiece[] | null {
  if (!/Vertical/.test(a.name)) return null;
  const pads = thru(a.footprint);
  if (pads.length < 2) return null;
  const xs = pads.map((p) => p.x);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const y = pads.reduce((k, p) => k + p.y, 0) / pads.length;
  const lift = 3;
  return [
    { material: "plastic-black", blocks: [box(cx, y, lift, 10, 4.5, 9)] },
    { material: "metal", blocks: [box(cx, y + 2.25 + 0.65, lift, 10, 1.3, 15.5), ...pins(pads, lift + 0.5, 0.8)] },
  ];
}

/** A barrel jack (#752): its black housing, and its legs through the board. */
function barrel(a: BodyAsk): BodyPiece[] | null {
  const o = outline(a, 11);
  return [
    { material: "plastic-black", blocks: [box((o.x1 + o.x2) / 2, (o.y1 + o.y2) / 2, 0, o.x2 - o.x1, o.y2 - o.y1, o.h)] },
    { material: "metal", blocks: leads(thru(a.footprint), 0.5) },
  ];
}

/** A screw terminal (#752): a green housing with a screw head on top over each way in, and its legs. */
function terminal(a: BodyAsk): BodyPiece[] | null {
  const o = outline(a, 10);
  const pads = thru(a.footprint);
  if (!pads.length) return null;
  const [cx, cy] = [(o.x1 + o.x2) / 2, (o.y1 + o.y2) / 2];
  return [
    { material: "plastic-green", blocks: [box(cx, cy, 0, o.x2 - o.x1, o.y2 - o.y1, o.h)] },
    { material: "metal", blocks: [...pads.map((p) => cyl(p.x, cy, o.h, Math.min(3, (o.y2 - o.y1) * 0.4), 0.3)), ...leads(pads, 0.5)] },
  ];
}

/** A TO-92 (#752): a black body on its three legs. */
function to92(a: BodyAsk): BodyPiece[] | null {
  const pads = thru(a.footprint);
  if (pads.length !== 3) return null;
  const xs = pads.map((p) => p.x);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const y = pads.reduce((k, p) => k + p.y, 0) / pads.length;
  const lift = 2.5;
  return [
    { material: "plastic-black", blocks: [box(cx, y - 0.6, lift, 4.8, 3.2, 4.5)] },
    { material: "metal", blocks: pins(pads, lift + 0.3, 0.45) },
  ];
}

/**
 * A development board on pin headers (#752), such as an ESP32 DevKit: a black strip and gold pins under each row,
 * the board on top of them, and the module's can on the board.
 */
function devKit(a: BodyAsk): BodyPiece[] | null {
  const pads = thru(a.footprint);
  if (pads.length < 8) return null;
  const o = outline(a, 1.6);
  const strip = 2.5;
  const rows = new Map<number, Pad[]>();
  for (const p of pads) rows.set(r3(p.x), [...(rows.get(r3(p.x)) ?? []), p]);
  const strips = [...rows.values()].map((row) => {
    const ys = row.map((p) => p.y);
    return box(row[0]!.x, (Math.min(...ys) + Math.max(...ys)) / 2, 0, 2.54, Math.max(...ys) - Math.min(...ys) + 2.54, strip);
  });
  const [cx, cy] = [(o.x1 + o.x2) / 2, (o.y1 + o.y2) / 2];
  const w = o.x2 - o.x1;
  const d = o.y2 - o.y1;
  const tall = d >= w;
  const can = tall
    ? box(cx, o.y1 + d * 0.3, strip + 1.6, Math.min(w * 0.7, 13), d * 0.35, 2.4)
    : box(o.x1 + w * 0.3, cy, strip + 1.6, w * 0.35, Math.min(d * 0.7, 13), 2.4);
  return [
    { material: "plastic-black", blocks: strips },
    { material: "gold", blocks: pins(pads, strip + 1.6 + 0.5) },
    { material: "module", blocks: [box(cx, cy, strip, w, d, 1.6)] },
    { material: "metal", blocks: [can] },
  ];
}

/** Rules, tried in order. A rule that answers null passes the part on to the simple box. */
const RULES: [RegExp, (a: BodyAsk) => BodyPiece[] | null][] = [
  [/^Pin(Header|Socket)_|^Pin header /, header],
  [/^DIP-\d+_/, dip],
  [/^(R|C|L|LED|Fuse)_(0402|0603|0805|1206|1210|1812)_|^(0402|0603|0805|1206) \(\d+ metric\)$/, chip],
  [/^(SOIC|SSOP|TSSOP|MSOP|HTSSOP|SOT-|TSOT-|SC-70|Texas_HTSOP|QFN|DFN|TQFP|LQFP|QFP)/, leaded],
  [/^JST_(SH|PH|XH)_/, jst],
  [/^SW_SPDT_PCM12|^SW_Slide/, slide],
  [/^SW_PUSH_6mm|^SW_SPST_TL3342/, button],
  [/^(LED_D|CP_Radial)/, radial],
  [/^USB_/, usb],
  [/^ESP32-.*(WROOM|MINI)|^ESP-12/, espModule],
  [/^TO-220-3/, to220],
  [/^BarrelJack_/, barrel],
  [/^TerminalBlock_/, terminal],
  [/^TO-92/, to92],
  [/DevKit/, devKit],
];

/** A true body for a part, or null when it keeps its simple box (#752). */
export function drawnBody(a: BodyAsk): BodyPiece[] | null {
  const s = a.model?.source;
  if (s && s.kind !== "box" && s.kind !== "header" && s.kind !== "cylinder") return null;
  const rule = RULES.find(([re]) => re.test(a.name));
  const made = rule?.[1](a) ?? null;
  return made && made.every((p) => p.blocks.every((b) => b.size.every((v) => v > 0))) ? made.filter((p) => p.blocks.length) : null;
}
