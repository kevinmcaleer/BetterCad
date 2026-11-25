import { resistor } from "../basics";
import { boardPads } from "../board";
import { placePart } from "../edit";
import { emptyDesign, type ElectronicsDesign } from "../model";
import { pushToBoard } from "../sync";
import { addTrack, setBoard, setPlacement } from "./route";

/**
 * A big board for timing (#640, #644): `n` resistors in rows on a board that fits them, each joined to the next in
 * its row by a track with two 45° corners, so there are about three segments a part. Rows are not joined to each
 * other, and nothing on it breaks a rule.
 */
export function bigBoard(n: number, perRow = 25): ElectronicsDesign {
  let d = emptyDesign();
  const ids: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const placed = placePart(d, "sh1", resistor(), { x: (i % perRow) * 12.7, y: Math.floor(i / perRow) * 12.7 });
    d = placed.design;
    ids.push(placed.part.id);
  }
  // Each part's second pin is wired to the next part's first on the sheet, as one net.
  const sheet = d.sheets[0]!;
  const wires = [...sheet.wires];
  const pin = (i: number, number: string) => {
    const sym = sheet.symbols.find((s) => s.part === ids[i])!;
    const p = d.defs[d.parts[i]!.def]!.symbol.pins.find((x) => x.number === number)!;
    return [sym.x + p.x, sym.y + p.y] as [number, number];
  };
  for (let i = 0; i + 1 < n; i += 1) if ((i + 1) % perRow) wires.push({ id: `w${i}`, a: pin(i, "2"), b: pin(i + 1, "1") });
  d = { ...d, sheets: [{ ...sheet, wires }, ...d.sheets.slice(1)] };
  d = pushToBoard(d).design;
  const rows = Math.ceil(n / perRow);
  d = setBoard(d, {
    outline: [
      { x: 0, y: 0 },
      { x: perRow * 6 + 6, y: 0 },
      { x: perRow * 6 + 6, y: rows * 4 + 6 },
      { x: 0, y: rows * 4 + 6 },
    ],
  });
  ids.forEach((id, i) => (d = setPlacement(d, id, { x: 6 + (i % perRow) * 6, y: 5 + Math.floor(i / perRow) * 4 })));
  const pads = boardPads(d);
  const at = new Map(pads.map((p) => [`${p.part}:${p.pad.number}`, p]));
  for (let i = 0; i + 1 < n; i += 1) {
    if (!((i + 1) % perRow)) continue;
    const a = at.get(`${ids[i]}:2`)!;
    const b = at.get(`${ids[i + 1]}:1`)!;
    d = addTrack(d, a.net, "top", [a.at, [a.at[0] + 1, a.at[1] + 1], [b.at[0] - 1, b.at[1] + 1], b.at], 0.25);
  }
  return d;
}
