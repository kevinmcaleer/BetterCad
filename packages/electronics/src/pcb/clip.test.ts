import { describe, expect, it } from "vitest";
import { GRID, resistor } from "../basics";
import { boardPads } from "../board";
import { addWire, placePart } from "../edit";
import { emptyDesign, type ElectronicsDesign, type Id, type P2 } from "../model";
import { pushToBoard } from "../sync";
import { boardClipOrigin, copyBoard, isBoardClip, pasteBoard } from "./clip";
import { addPour } from "./pour";
import { addHole, addText, addTrack, addVia, setBoard, setPlacement } from "./route";

/** Two channels of two resistors each, R1 to R2 and R3 to R4, joined pin 2 to pin 1. R1 and R2 are routed. */
function channels(): { d: ElectronicsDesign; parts: Id[]; pad: (d: ElectronicsDesign, ref: string, n: string) => BoardPad } {
  let d = emptyDesign();
  const parts: Id[] = [];
  for (let i = 0; i < 4; i += 1) {
    const p = placePart(d, "sh1", resistor(), { x: i * 10 * GRID, y: 0 });
    d = p.design;
    parts.push(p.part.id);
  }
  const pin = (part: Id, n: string): P2 => {
    const sym = d.sheets[0]!.symbols.find((s) => s.part === part)!;
    const pp = d.defs[d.parts.find((x) => x.id === part)!.def]!.symbol.pins.find((x) => x.number === n)!;
    return [sym.x + pp.x, sym.y + pp.y];
  };
  d = addWire(d, "sh1", pin(parts[0]!, "2"), pin(parts[1]!, "1"));
  d = addWire(d, "sh1", pin(parts[2]!, "2"), pin(parts[3]!, "1"));
  d = pushToBoard(d).design;
  d = setBoard(d, {
    outline: [
      { x: 0, y: 0 },
      { x: 80, y: 0 },
      { x: 80, y: 60 },
      { x: 0, y: 60 },
    ],
  });
  d = setPlacement(d, parts[0]!, { x: 10, y: 10, rot: 0 });
  d = setPlacement(d, parts[1]!, { x: 20, y: 10, rot: 0 });
  d = setPlacement(d, parts[2]!, { x: 50, y: 40, rot: 0 });
  d = setPlacement(d, parts[3]!, { x: 60, y: 50, rot: 0 });
  const pad = (x: ElectronicsDesign, ref: string, n: string) => boardPads(x).find((p) => p.ref === ref && p.pad.number === n)!;
  const a = pad(d, "R1", "2");
  const b = pad(d, "R2", "1");
  d = addTrack(d, a.net, "top", [a.at, [a.at[0] + 2, a.at[1] + 2], [b.at[0], a.at[1] + 2], b.at]);
  return { d, parts, pad };
}
type BoardPad = ReturnType<typeof boardPads>[number];

describe("copy and paste on the board (#741)", () => {
  it("copies a part with the routing round it", () => {
    const { d, parts } = channels();
    const clip = copyBoard(d, [parts[0]!, parts[1]!])!;
    expect(isBoardClip(JSON.parse(JSON.stringify(clip)))).toBe(true);
    expect(clip.parts.map((p) => [p.ref, p.x, p.y])).toEqual([
      ["R1", 10, 10],
      ["R2", 20, 10],
    ]);
    expect(clip.tracks).toHaveLength(1);
    // One part alone does not take a track that runs off to another.
    expect(copyBoard(d, [parts[0]!])!.tracks).toHaveLength(0);
  });

  it("lays out matching parts as copied and routes them on their own nets: a channel repeated", () => {
    const { d, parts, pad } = channels();
    const clip = copyBoard(d, [parts[0]!, parts[1]!])!;
    const out = pasteBoard(d, clip, [0, 0], [parts[3]!, parts[2]!]);
    expect(out.why).toBeUndefined();
    expect(out.laid).toBe(2);
    const b = out.design.board!;
    // R3 stays where it is; R4 sits from it as R2 does from R1.
    expect(b.placements.find((p) => p.part === parts[2])).toMatchObject({ x: 50, y: 40, rot: 0 });
    expect(b.placements.find((p) => p.part === parts[3])).toMatchObject({ x: 60, y: 40, rot: 0 });
    const t = b.tracks.at(-1)!;
    const from = pad(out.design, "R3", "2");
    const to = pad(out.design, "R4", "1");
    expect(t.net).toBe(from.net);
    expect(t.pts[0]).toEqual(from.at);
    expect(t.pts.at(-1)).toEqual(to.at);
    expect(out.offNet).toBe(0);
    expect(out.ids).toEqual([t.id]);
  });

  it("turns the copy with the first part when it is turned", () => {
    const { d, parts } = channels();
    const clip = copyBoard(d, [parts[0]!, parts[1]!])!;
    const turned = setPlacement(d, parts[2]!, { rot: 90 });
    const b = pasteBoard(turned, clip, [0, 0], [parts[2]!, parts[3]!]).design.board!;
    expect(b.placements.find((p) => p.part === parts[3])).toMatchObject({ x: 50, y: 50, rot: 90 });
  });

  it("says what is wrong when the picked parts do not match", () => {
    const { d, parts } = channels();
    const clip = copyBoard(d, [parts[0]!, parts[1]!])!;
    expect(pasteBoard(d, clip, [0, 0], [parts[2]!]).why).toMatch(/The copy has 2 parts. Pick as many/);
    const flipped = setPlacement(d, parts[3]!, { side: "bottom" });
    expect(pasteBoard(flipped, clip, [0, 0], [parts[2]!, parts[3]!]).why).toMatch(/Flip them to match first/);
  });

  it("pastes copper and drawings under the pointer with fresh ids, nets from what it lands on", () => {
    const { d: start, pad } = channels();
    let d = start;
    const r3 = pad(d, "R3", "2");
    d = addVia(d, "", 30, 30);
    d = addTrack(d, "", "top", [
      [30, 30],
      [35, 30],
    ]);
    d = addHole(d, 32, 34, 3.2);
    d = addText(d, 30, 36, "A");
    d = addPour(d, "", "bottom", [
      [28, 28],
      [38, 28],
      [38, 38],
    ]);
    const b0 = d.board!;
    const ids = [b0.vias.at(-1)!.id, b0.tracks.at(-1)!.id, b0.holes.at(-1)!.id, b0.texts.at(-1)!.id, b0.pours.at(-1)!.id];
    const clip = copyBoard(d, ids)!;
    expect(boardClipOrigin(clip)).toEqual([28, 28]);
    // The via lands on R3's pad 1, so the track joined to it takes that net too.
    const at: P2 = [r3.at[0] - 2, r3.at[1] - 2];
    const out = pasteBoard(d, clip, at);
    const b = out.design.board!;
    expect(out.ids).toHaveLength(5);
    expect(b.vias.at(-1)).toMatchObject({ x: r3.at[0], y: r3.at[1], net: r3.net });
    expect(b.tracks.at(-1)!.net).toBe(r3.net);
    expect(b.holes.at(-1)).toMatchObject({ x: q2(r3.at[0] + 2), y: q2(r3.at[1] + 4) });
    expect(b.texts.at(-1)!.text).toBe("A");
    expect(out.offNet).toBe(0);
    // Somewhere bare, the copper is on no net and said so.
    const bare = pasteBoard(d, clip, [60, 5]);
    expect(bare.offNet).toBe(2);
    expect(bare.design.board!.vias.at(-1)!.net).toBe("");
  });

  it("does not paste parts without parts to lay out, and says so", () => {
    const { d, parts } = channels();
    const out = pasteBoard(d, copyBoard(d, [parts[0]!, parts[1]!])!, [40, 5]);
    expect(out.why).toMatch(/Parts come from the schematic/);
    expect(out.design.board!.placements).toEqual(d.board!.placements);
    expect(out.design.board!.tracks).toHaveLength(2);
  });
});

const q2 = (n: number) => Math.round(n * 100) / 100;
