import type { CataloguePart, CatalogueShape } from "./index";

/**
 * The first catalogue parts (#186). Models are blocks: close enough to design round and to see clashes, not
 * replicas. `checked` is true only where the outline and mounting holes come from the maker's drawing or a
 * standard; the rest are from common listings and want measuring before you print anything tight.
 */
const box = (size: CatalogueShape["size"], at: CatalogueShape["at"]): CatalogueShape => ({ kind: "box", size, at });
const cyl = (d: number, length: number, at: CatalogueShape["at"], axis?: CatalogueShape["axis"], cut?: boolean): CatalogueShape => ({
  kind: "cylinder",
  size: [d, d, length],
  at,
  ...(axis && axis !== "z" ? { axis } : {}),
  ...(cut ? { cut } : {}),
});
const rect = (w: number, h: number, at: [number, number] = [0, 0]) => ({ kind: "rect" as const, at, size: [w, h] as [number, number] });
const circle = (d: number, at: [number, number] = [0, 0]) => ({ kind: "circle" as const, at, size: [d, d] as [number, number] });
const corners = (dx: number, dy: number, cx = 0, cy = 0): [number, number][] => [
  [cx - dx / 2, cy - dy / 2],
  [cx + dx / 2, cy - dy / 2],
  [cx + dx / 2, cy + dy / 2],
  [cx - dx / 2, cy + dy / 2],
];

/**
 * A micro servo: the body drops through the plate and the tabs sit on it (z = 0 is under the tabs). The output
 * shaft is off-centre, towards +x.
 */
function microServo(o: { id: string; name: string; w: number; d: number; tabs: number; mass: number; description: string; source: string }): CataloguePart {
  const below = 15.9;
  const top = 22.7 - below;
  const shaft = o.w / 2 - o.d / 2;
  return {
    id: o.id,
    version: 1,
    name: o.name,
    category: "servo",
    description: o.description,
    model: [box([o.w, o.d, 22.7], [0, 0, -below]), box([o.tabs, o.d, 2.5], [0, 0, 0]), cyl(o.d, 4, [shaft, 0, top]), cyl(4.8, 3.2, [shaft, 0, top + 4])],
    cutout: {
      pocket: [rect(o.w, o.d)],
      depth: below,
      holes: [
        { at: [-13.9, 0], screw: "M2" },
        { at: [13.9, 0], screw: "M2" },
      ],
    },
    mount: { origin: [shaft, 0, top + 7.2], axis: [0, 0, 1] },
    mass: o.mass,
    source: o.source,
    checked: false,
    licence: "MIT",
  };
}

const sg90 = microServo({
  id: "sg90",
  name: "SG90 micro servo",
  w: 22.2,
  d: 11.8,
  tabs: 32.2,
  mass: 9,
  description: "The common 9 g plastic-geared micro servo. 180° travel, about 1.8 kg·cm.",
  source: "Sizes from the Tower Pro SG90 sheet as widely copied. Clones vary by a few tenths: measure yours.",
});

const mg90s = microServo({
  id: "mg90s",
  name: "MG90S micro servo",
  w: 22.8,
  d: 12.2,
  tabs: 32.5,
  mass: 13.4,
  description: "A metal-geared micro servo in the SG90's case. About 2.2 kg·cm.",
  source: "Sizes from common MG90S listings, close to the SG90's. Clones vary: measure yours.",
});

const mg996r: CataloguePart = {
  id: "mg996r",
  version: 1,
  name: "MG996R servo",
  category: "servo",
  description: "A standard-size metal-geared servo, about 10 kg·cm. Body drops through the plate, tabs on top.",
  model: [box([40.7, 19.7, 37], [0, 0, -27]), box([54, 19.7, 2.5], [0, 0, 0]), cyl(13, 3, [10.35, 0, 10]), cyl(6, 3, [10.35, 0, 13])],
  cutout: { pocket: [rect(40.7, 19.7)], depth: 27, holes: corners(49.5, 10).map((at) => ({ at, screw: "M4" })) },
  mount: { origin: [10.35, 0, 16], axis: [0, 0, 1] },
  mass: 55,
  source: "Sizes from common MG996R listings (40.7 × 19.7 × 42.9 mm, holes 49.5 × 10 mm). Heights are approximate.",
  checked: false,
  licence: "MIT",
};

const n20: CataloguePart = {
  id: "n20",
  version: 1,
  name: "N20 gear motor",
  category: "motor",
  description: "A 12 × 10 mm micro gear motor. Stands shaft up, gearbox face on the surface, motor in the pocket.",
  model: [box([12, 10, 24], [0, 0, -24]), cyl(3, 10, [0, 0, 0])],
  cutout: { pocket: [rect(12, 10)], depth: 24, holes: [] },
  mount: { origin: [0, 0, 10], axis: [0, 0, 1] },
  mass: 10,
  source: "Sizes from common N20 listings. Length depends on the gear ratio, and its M1.6 face holes aren't in the screw table yet.",
  checked: false,
  licence: "MIT",
};

const ttMotor: CataloguePart = {
  id: "tt-motor",
  version: 1,
  name: "TT gear motor",
  category: "motor",
  description: "The yellow hobby gear motor with a double-flat shaft out of both sides. Sits on the surface.",
  model: [box([65, 22.5, 18.8], [0, 0, 0]), cyl(5.4, 9, [-20.5, 11.25, 9.4], "y"), cyl(5.4, 9, [-20.5, -20.25, 9.4], "y")],
  cutout: { pocket: [], depth: 0, holes: [] },
  mount: { origin: [-20.5, 0, 9.4], axis: [0, 1, 0] },
  mass: 30,
  source: "Sizes from common TT motor listings. Mounting holes aren't included until they've been measured.",
  checked: false,
  licence: "MIT",
};

/** A Raspberry Pi Pico or Pico W: the board's underside at z = 0, on standoffs. */
const pico = (id: string, name: string, description: string): CataloguePart => ({
  id,
  version: 1,
  name,
  category: "board",
  description,
  model: [box([51, 21, 1], [0, 0, 0]), box([5.6, 8, 2.6], [-24, 0, 1]), box([7, 7, 1], [0, 0, 1])],
  cutout: { pocket: [], depth: 0, holes: corners(47, 11.4).map((at) => ({ at, screw: "M2" })) },
  mass: 3,
  source: "Outline and holes from the Raspberry Pi Pico datasheet's mechanical drawing (51 × 21 mm, Ø2.1 mm holes 47 × 11.4 mm apart). Components are blocks.",
  checked: true,
  licence: "MIT",
});

const piZero2w: CataloguePart = {
  id: "pi-zero-2-w",
  version: 1,
  name: "Raspberry Pi Zero 2 W",
  category: "board",
  description: "The small Raspberry Pi. Board's underside at z = 0, on M2.5 standoffs.",
  model: [
    box([65, 30, 1.4], [0, 0, 0]),
    box([13, 13, 1.2], [-3, 0, 1.4]),
    box([11.2, 7.6, 3.3], [-20.1, -11.2, 1.4]),
    box([8, 5.6, 2.6], [8.9, -12.2, 1.4]),
    box([8, 5.6, 2.6], [21.5, -12.2, 1.4]),
  ],
  cutout: { pocket: [], depth: 0, holes: corners(58, 23).map((at) => ({ at, screw: "M2.5" })) },
  mass: 10,
  source: "Outline and holes from the Raspberry Pi Zero 2 W mechanical drawing (65 × 30 mm, holes 58 × 23 mm apart). Connectors are blocks.",
  checked: true,
  licence: "MIT",
};

/** A full-size Pi: 85 × 56 mm, holes 58 × 49 mm apart, 3.5 mm in from the edges at the end away from the USB. */
const bigPi = (id: string, name: string, ethernet: number, usb: [number, number], mass: number, source: string): CataloguePart => ({
  id,
  version: 1,
  name,
  category: "board",
  description: `${name}. Board's underside at z = 0, on M2.5 standoffs. USB and Ethernet stand 2 mm past the +x edge.`,
  model: [
    box([85, 56, 1.4], [0, 0, 0]),
    box([21, 16, 13.5], [34, ethernet, 1.4]),
    box([17.5, 13.1, 16], [35.75, usb[0], 1.4]),
    box([17.5, 13.1, 16], [35.75, usb[1], 1.4]),
    box([15, 15, 2.4], [-10, 0, 1.4]),
  ],
  cutout: { pocket: [], depth: 0, holes: corners(58, 49, -10, 0).map((at) => ({ at, screw: "M2.5" })) },
  mass,
  source,
  checked: true,
  licence: "MIT",
});

const pi4 = bigPi(
  "pi-4",
  "Raspberry Pi 4 Model B",
  17.75,
  [-19, -1],
  46,
  "Outline and holes from the Raspberry Pi 4 mechanical drawing. Connector blocks are approximate.",
);
const pi5 = bigPi(
  "pi-5",
  "Raspberry Pi 5",
  -17.8,
  [1.1, 19],
  46,
  "Outline and holes from the Raspberry Pi 5 mechanical drawing. Connector blocks are approximate.",
);

const hcsr04: CataloguePart = {
  id: "hc-sr04",
  version: 1,
  name: "HC-SR04 ultrasonic sensor",
  category: "sensor",
  description: "The two-eyed distance sensor. The eyes go through the plate; the board's front sits on it.",
  model: [box([45, 20, 1.6], [0, 0, 0]), cyl(16, 12, [-13, 0, -12]), cyl(16, 12, [13, 0, -12])],
  cutout: { pocket: [circle(16, [-13, 0]), circle(16, [13, 0])], depth: 12, holes: [] },
  mass: 8.5,
  source: "Sizes from common HC-SR04 listings. Its Ø1 mm corner holes are too small for the screw table.",
  checked: false,
  licence: "MIT",
};

/** A deep-groove ball bearing, pressed into a pocket with its top face on the surface. */
const bearing = (id: string, outer: number, bore: number, width: number, mass: number): CataloguePart => ({
  id,
  version: 1,
  name: `${id} bearing`,
  category: "bearing",
  description: `A ${outer} mm ball bearing with a ${bore} mm bore, ${width} mm wide. Press it into its pocket.`,
  model: [cyl(outer, width, [0, 0, -width]), cyl(bore, width, [0, 0, -width], "z", true)],
  cutout: { pocket: [circle(outer)], depth: width, holes: [] },
  mount: { origin: [0, 0, -width / 2], axis: [0, 0, 1] },
  mass,
  source: `ISO 15 sizes for a ${id} (${outer} × ${bore} × ${width} mm).`,
  checked: true,
  licence: "MIT",
});

const cell18650: CataloguePart = {
  id: "18650",
  version: 1,
  name: "18650 cell",
  category: "power",
  description: "A lithium-ion cell lying along x, half sunk in a trough. Allow a little extra for wrapped or protected cells.",
  model: [cyl(18.5, 65, [-32.5, 0, 0], "x")],
  cutout: { pocket: [rect(65, 18.5)], depth: 9.25, holes: [] },
  mass: 46,
  source: "The 18650 size (18 × 65 mm nominal); most cells measure 18.3 to 18.6 mm across.",
  checked: true,
  licence: "MIT",
};

export const PARTS: CataloguePart[] = [
  sg90,
  mg90s,
  mg996r,
  n20,
  ttMotor,
  pico("pico", "Raspberry Pi Pico", "The RP2040 microcontroller board. Board's underside at z = 0, on M2 standoffs."),
  pico("pico-w", "Raspberry Pi Pico W", "The Pico with Wi-Fi, the same size. Board's underside at z = 0, on M2 standoffs."),
  piZero2w,
  pi4,
  pi5,
  hcsr04,
  bearing("608", 22, 8, 7, 12),
  bearing("623", 10, 3, 4, 1.5),
  cell18650,
];
