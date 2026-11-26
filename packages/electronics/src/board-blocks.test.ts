import { describe, expect, it } from "vitest";
import { buildBlock, placeBlock } from "./blocks";
import { lookup } from "./blocks.test";
import { placePart, rotateOnBoard } from "./edit";
import { STARTER_BLOCKS } from "./library/blocks";
import { emptyDesign, packageOf, type ElectronicsDesign, type Placement } from "./model";
import { boardGroups, clusters, footprintBox, pickGroups, pushToBoard, turnedBox } from "./sync";

const spec = (id: string) => STARTER_BLOCKS.find((b) => b.id === id)!;
const place = (d: ElectronicsDesign, id: string, at: [number, number]) => placeBlock(d, "sh1", buildBlock(spec(id), lookup), at).design;
const boxOf = (d: ElectronicsDesign, at: Placement) => {
  const part = d.parts.find((p) => p.id === at.part)!;
  const b = turnedBox(footprintBox(packageOf(d, part)!.footprint), at.rot);
  return { x1: at.x + b.x1, y1: at.y + b.y1, x2: at.x + b.x2, y2: at.y + b.y2 };
};
const overlap = (a: ReturnType<typeof boxOf>, b: ReturnType<typeof boxOf>) =>
  a.x1 < b.x2 - 1e-6 && b.x1 < a.x2 - 1e-6 && a.y1 < b.y2 - 1e-6 && b.y1 < a.y2 - 1e-6;
const span = (boxes: ReturnType<typeof boxOf>[]) => ({
  x1: Math.min(...boxes.map((b) => b.x1)),
  x2: Math.max(...boxes.map((b) => b.x2)),
  y1: Math.min(...boxes.map((b) => b.y1)),
  y2: Math.max(...boxes.map((b) => b.y2)),
});

describe("blocks on the board (#774)", () => {
  it("lays every block's guide out with no courtyards overlapping", () => {
    const guided = STARTER_BLOCKS.filter((b) => b.layout);
    expect(guided.length).toBeGreaterThanOrEqual(4);
    for (const b of guided) {
      const d = place(emptyDesign(), b.id, [0, 0]);
      const [c] = clusters(
        d,
        d.parts.map((p) => p.id),
      );
      expect(c!.placements).toHaveLength(d.parts.length);
      const boxes = c!.placements.map((at) => boxOf(d, at));
      for (let i = 0; i < boxes.length; i += 1)
        for (let j = i + 1; j < boxes.length; j += 1) expect(overlap(boxes[i]!, boxes[j]!), `${b.id} ${i} ${j}`).toBe(false);
      // The regulator's capacitors sit right by it: the whole block fits in a small square.
      const all = span(boxes);
      expect(all.x2 - all.x1).toBeLessThan(20);
    }
  });

  it("pushes each group's footprints together, outside the board, apart from the others", () => {
    let d = place(emptyDesign(), "reg-3v3-linear", [0, 0]);
    d = place(d, "i2c-level-shifter", [200, 0]);
    d = placePart(d, "sh1", lookup("resistor")!, { x: 0, y: 200 }).design;
    const { design } = pushToBoard(d);
    const board = design.board!;
    const edge = Math.max(...board.outline.map((c) => c.x));
    const groups = design.sheets[0]!.groups!;
    const boxes = groups.map((g) => {
      const parts = new Set(design.sheets[0]!.symbols.filter((y) => g.members.includes(y.id)).map((y) => y.part));
      return span(board.placements.filter((p) => parts.has(p.part)).map((at) => boxOf(design, at)));
    });
    for (const b of boxes) expect(b.x1).toBeGreaterThan(edge);
    // Each cluster stays compact, and the two clusters don't overlap.
    expect(boxes[1]!.x2 - boxes[1]!.x1).toBeLessThan(20);
    expect(overlap(boxes[0]!, boxes[1]!)).toBe(false);
    const all = board.placements.map((at) => boxOf(design, at));
    for (let i = 0; i < all.length; i += 1) for (let j = i + 1; j < all.length; j += 1) expect(overlap(all[i]!, all[j]!)).toBe(false);
    expect(board.placements).toHaveLength(design.parts.length);
    // Parked off the board, each cluster shows its group's name.
    expect(boardGroups(design, new Set()).map((g) => g.name)).toEqual(groups.map((g) => g.name));
  });

  it("picks a group's footprints from one of them, and turns them as one", () => {
    let d = place(emptyDesign(), "drv8833", [0, 0]);
    d = placePart(d, "sh1", lookup("resistor")!, { x: 0, y: 200 }).design;
    const { design } = pushToBoard(d);
    const lone = design.parts.find(
      (p) => p.ref.startsWith("R") && !design.sheets[0]!.groups![0]!.members.some((m) => design.sheets[0]!.symbols.find((y) => y.id === m)?.part === p.id),
    )!;
    const block = design.parts.filter((p) => p.id !== lone.id).map((p) => p.id);
    expect(pickGroups(design, [block[1]!]).sort()).toEqual([...block].sort());
    expect(pickGroups(design, [lone.id])).toEqual([lone.id]);
    const before = design.board!.placements.filter((p) => block.includes(p.part)).map((at) => boxOf(design, at));
    const turned = rotateOnBoard(design, block);
    const after = turned.board!.placements.filter((p) => block.includes(p.part)).map((at) => boxOf(turned, at));
    for (let i = 0; i < after.length; i += 1) for (let j = i + 1; j < after.length; j += 1) expect(overlap(after[i]!, after[j]!)).toBe(false);
    // A quarter turn swaps the cluster's width and height.
    const [b, a] = [span(before), span(after)];
    expect(a.x2 - a.x1).toBeCloseTo(b.y2 - b.y1, 0);
    expect(a.y2 - a.y1).toBeCloseTo(b.x2 - b.x1, 0);
  });
});
