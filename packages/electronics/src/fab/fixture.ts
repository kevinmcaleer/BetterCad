import { GRID, header, resistor } from "../basics";
import { boardPads } from "../board";
import { addWire, placePart } from "../edit";
import { emptyDesign, type ElectronicsDesign, type P2 } from "../model";
import { addPour, wholeBoard } from "../pcb/pour";
import { addHole, addText, addTrack, addVia, roundedOutline, setBoard, setPlacement } from "../pcb/route";
import { pushToBoard } from "../sync";

/**
 * The board the manufacturing tests share: R1 (an 0805, turned 30° so its pads need a macro) and J1 (a two pin
 * header) on a 50 by 40 mm board with 3 mm corners and a slot cut out of it. One net is routed on top with a via; the
 * other is a pour over the whole bottom. A mounting hole, a plated hole and a line of text finish it.
 */
export function fabBoard(): { d: ElectronicsDesign; pad: (ref: string, n: string) => P2; nets: [string, string] } {
  const G = GRID;
  let d = emptyDesign();
  const r = placePart(d, "sh1", resistor(), { x: 0, y: 0 });
  const j = placePart(r.design, "sh1", header(2), { x: 20 * G, y: 0 });
  d = j.design;
  const at = (part: string, pin: string): P2 => {
    const sym = d.sheets[0]!.symbols.find((s) => s.part === part)!;
    const p = d.defs[d.parts.find((x) => x.id === part)!.def]!.symbol.pins.find((x) => x.number === pin)!;
    return [sym.x + p.x, sym.y + p.y];
  };
  for (const [n, row] of [
    ["1", 6 * G],
    ["2", -6 * G],
  ] as const) {
    const a = at(r.part.id, n);
    const b = at(j.part.id, n);
    d = addWire(d, "sh1", a, [a[0], row]);
    d = addWire(d, "sh1", [a[0], row], [b[0], row]);
    d = addWire(d, "sh1", [b[0], row], b);
  }
  d = pushToBoard(d).design;
  d = setBoard(d, {
    outline: roundedOutline(50, 40, 3),
    cutouts: [
      [
        { x: 20, y: 5 },
        { x: 30, y: 5 },
        { x: 30, y: 8 },
        { x: 20, y: 8 },
      ],
    ],
  });
  d = setPlacement(d, r.part.id, { x: 10, y: 20, rot: 30 });
  d = setPlacement(d, j.part.id, { x: 30, y: 20 });
  const pads = boardPads(d);
  const pad = (ref: string, n: string) => pads.find((p) => p.ref === ref && p.pad.number === n)!.at;
  const net = (ref: string, n: string) => pads.find((p) => p.ref === ref && p.pad.number === n)!.net;
  const nets: [string, string] = [net("R1", "1"), net("R1", "2")];
  d = addTrack(d, nets[0], "top", [pad("R1", "1"), [10, 30], [20, 30]], 0.25);
  d = addVia(d, nets[0], 20, 30);
  d = addTrack(d, nets[0], "bottom", [[20, 30], [30, 30], pad("J1", "1")], 0.25);
  d = addPour(d, nets[1], "bottom", wholeBoard(d.board!), true);
  d = addHole(d, 45, 35, 3.2);
  d = addHole(d, 5, 35, 1, 2);
  d = addText(d, 5, 3, "Rev A", "silk-top", 1.5);
  return { d, pad, nets };
}
