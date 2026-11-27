import { GRID, header, resistor } from "./basics";
import { area, boardPads, boardSize, outlinePoints, pointInPolygon, ratsnest } from "./board";
import { addWire, placePart, placePartOnBoard } from "./edit";
import { emptyDesign, rectOutline } from "./model";
import { boardChanges, pushToBoard } from "./sync";

describe("board outline", () => {
  it("keeps straight edges as they are", () => {
    expect(outlinePoints(rectOutline(50, 40))).toEqual([
      [0, 0],
      [50, 0],
      [50, 40],
      [0, 40],
    ]);
    expect(boardSize({ outline: rectOutline(50, 40) })).toEqual({ x: 0, y: 0, w: 50, h: 40 });
  });

  it("cuts an arc into chords that stay on its circle", () => {
    // A 10 mm square with one quarter-round corner of radius 2: bulge tan(90°/4).
    const pts = outlinePoints([
      { x: 0, y: 0 },
      { x: 8, y: 0, bulge: Math.tan(Math.PI / 8) },
      { x: 10, y: 2 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]);
    expect(pts.length).toBeGreaterThan(8);
    for (const p of pts.slice(2, -3)) expect(Math.hypot(p[0] - 8, p[1] - 2)).toBeCloseTo(2, 5);
    expect(area(pts)).toBeGreaterThan(99);
    expect(area(pts)).toBeLessThan(100);
    expect(pointInPolygon([9.9, 0.1], pts)).toBe(false); // the corner that was rounded off
    expect(pointInPolygon([5, 5], pts)).toBe(true);
  });
});

describe("pads and the ratsnest", () => {
  it("puts pads where their part is, turned and flipped, with their nets", () => {
    let d = emptyDesign();
    const sheet = d.sheets[0]!.id;
    const r = placePart(d, sheet, resistor(), { x: 0, y: 0 });
    d = r.design;
    const j = placePart(d, sheet, header(2), { x: 10 * GRID, y: 0 });
    d = addWire(j.design, sheet, [0, 1.5 * GRID], [8 * GRID, 1.5 * GRID]); // R1.1 across…
    d = addWire(d, sheet, [8 * GRID, 1.5 * GRID], [8 * GRID, 0.5 * GRID]); // …and down to J1.1
    d = pushToBoard(d).design;
    const board = d.board!;
    d = {
      ...d,
      board: {
        ...board,
        placements: board.placements.map((p) => (p.ref === "R1" ? { ...p, x: 10, y: 10, rot: 90, side: "bottom" as const } : { ...p, x: 30, y: 10 })),
      },
    };
    const pads = boardPads(d);
    const r1 = pads.filter((p) => p.ref === "R1");
    // 0805 pads are at x = ∓0.95; on the bottom they mirror, then turn 90°.
    expect(r1.map((p) => [p.pad.number, p.at, p.net, p.side])).toEqual([
      ["1", [10, 10.95], "Net-(J1-1)", "bottom"],
      ["2", [10, 9.05], "", "bottom"],
    ]);
    const air = ratsnest(pads);
    expect(air).toEqual([{ net: "Net-(J1-1)", a: [30, 10], b: [10, 10.95] }]);
    // Once copper joins them there is nothing left to route.
    expect(ratsnest(pads, (p) => (p.net ? "one" : p.ref + p.pad.number))).toEqual([]);
  });
});

describe("placing a part from the PCB view", () => {
  it("puts its footprint where it was clicked and its symbol in a free spot on the schematic", () => {
    let d = emptyDesign();
    const sheet = d.sheets[0]!.id;
    d = placePart(d, sheet, resistor(), { x: 0, y: 0 }).design;
    d = pushToBoard(d).design;
    const placed = placePartOnBoard(d, sheet, header(2), { x: 12, y: 8, rot: 90, side: "bottom" })!;
    expect(placed.part.ref).toBe("J1");
    const at = placed.design.board!.placements.find((p) => p.part === placed.part.id)!;
    expect(at).toMatchObject({ x: 12, y: 8, rot: 90, side: "bottom", ref: "J1" });
    const sym = placed.design.sheets[0]!.symbols.find((s) => s.part === placed.part.id)!;
    // Clear of the resistor, on the grid.
    expect(sym.x).toBeGreaterThan(0);
    expect(Math.abs(sym.x / GRID - Math.round(sym.x / GRID))).toBeLessThan(1e-6);
    // The board already matches the schematic, so Push to PCB has nothing to do for it.
    expect(boardChanges(placed.design)).toEqual([]);
  });

  it("needs a board", () => {
    const d = emptyDesign();
    expect(placePartOnBoard(d, d.sheets[0]!.id, resistor(), { x: 0, y: 0 })).toBeNull();
  });
});
