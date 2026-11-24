import { emptyBox, grow } from "../geom";
import type { FootprintDef, Model3D } from "../model";

const r2 = (v: number) => Math.round(v * 100) / 100;

/** The box round a footprint's fabrication drawing, or its pads when it has none. */
export function bodyBox(fp: FootprintDef) {
  const b = emptyBox();
  for (const s of fp.shapes) {
    if (s.layer !== "fab") continue;
    if (s.kind === "line") s.pts.forEach((p) => grow(b, p));
    else if (s.kind === "rect") grow(grow(b, [s.x1, s.y1]), [s.x2, s.y2]);
    else if (s.kind === "circle" || s.kind === "arc") grow(grow(b, [s.cx - s.r, s.cy - s.r]), [s.cx + s.r, s.cy + s.r]);
  }
  if (b.x1 === Infinity) for (const p of fp.pads) grow(grow(b, [p.x - p.w / 2, p.y - p.h / 2]), [p.x + p.w / 2, p.y + p.h / 2]);
  return b.x1 === Infinity ? { x1: -1, y1: -1, x2: 1, y2: 1 } : b;
}

/** How tall a package stands, by the usual names. First match wins. */
const HEIGHTS: [RegExp, number][] = [
  [/_0402_/, 0.35],
  [/_0603_/, 0.45],
  [/_0805_/, 0.55],
  [/_1206_/, 0.6],
  [/SOD-123|SOD-323|D_SMA|D_MELF/, 1.1],
  [/SOT-223/, 1.6],
  [/SOT-23|SOT-363|SC-70|TSOT/, 1.1],
  [/TSSOP|MSOP|VSSOP|SSOP/, 1.1],
  [/SOIC|SOP-|HTSOP|SO-Power/, 1.6],
  [/QFN|DFN|LGA|SON|OLGA/, 0.85],
  [/TO-263/, 4.5],
  [/TO-220.*Vertical|TO-220-15/, 15],
  [/TO-92/, 5],
  [/DIP-\d/, 3.6],
  [/PLCC4|LED_RGB_5050|WS2812|SK6812/, 1.6],
  [/CP_Elec/, 5.6],
  [/Crystal_SMD/, 0.8],
  [/HC49/, 3.5],
  [/Relay/, 15],
  [/SW_PUSH_6mm|TL3342/, 4.3],
  [/Buzzer/, 9.5],
  [/USB_C|USB_Micro/, 3.2],
  [/BarrelJack/, 11],
  [/TerminalBlock/, 10],
  [/Potentiometer/, 6.5],
  [/microSD/, 1.9],
  [/JST_SH/, 3],
  [/JST_/, 6],
  [/ESP|RaspberryPi|Arduino|Module|Feather|Pololu/, 3.2],
];

/**
 * A simple 3D body for a footprint (#624, #628): a box over its fabrication outline, a cylinder for round cans and
 * LEDs, or a pin header. Good enough to check a board fits its case; a STEP file can replace it on any part.
 */
export function simpleBody(key: string, fp: FootprintDef): Model3D | undefined {
  const name = key.split(":").pop() ?? key;
  if (/MountingHole|Fiducial|TestPoint|SolderJumper/.test(name)) return undefined;
  const header = /Pin(Header|Socket)_(\d)x(\d+)_P([\d.]+)mm/.exec(name);
  if (header) {
    const socket = header[1] === "Socket";
    return {
      source: { kind: "header", rows: Number(header[2]), pins: Number(header[3]), pitch: Number(header[4]), height: socket ? 8.5 : 2.5 },
      ...(socket ? {} : { colour: "plastic-black" }),
    };
  }
  const round = /(?:CP_Radial|C_Disc|LED|Buzzer_Beeper:Buzzer|Buzzer)_D([\d.]+)mm|Radial_D([\d.]+)mm/.exec(name);
  const b = bodyBox(fp);
  const centre: [number, number, number] = [r2((b.x1 + b.x2) / 2), r2((b.y1 + b.y2) / 2), 0];
  const offset = centre[0] || centre[1] ? { offset: centre } : {};
  if (round && !/C_Disc/.test(name)) {
    const d = Number(round[1] ?? round[2]);
    const h = /LED/.test(name) ? d + 3.6 : /Buzzer/.test(name) ? 9.5 : Math.max(5, d * 2 + 1);
    return { source: { kind: "cylinder", diameter: d, height: r2(h) }, ...offset };
  }
  const height = HEIGHTS.find(([re]) => re.test(name))?.[1] ?? 2;
  return { source: { kind: "box", size: [r2(b.x2 - b.x1), r2(b.y2 - b.y1), height] }, ...offset };
}
