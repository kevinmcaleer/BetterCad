import { GRID, addWire, emptyDesign, netlist, placePart, power, pushToBoard, resistor, type CatalogueBody } from "@bettercad/electronics";
import { BcadError, loadBcad, saveBcad } from "./bcad";
import { boardSolid } from "@bettercad/electronics/pcb/solid";
import { cataloguePart } from "./catalogue/list";
import { addBoard, boardBodyId, boardParts, boardStep, onSketch } from "./board";
import { build, featureSummary, newDoc } from "./document";
import { fromPartLocal } from "./extrude";

const design = () => {
  let d = emptyDesign();
  const sheet = d.sheets[0]!.id;
  d = placePart(d, sheet, resistor(), { x: 0, y: 0 }).design;
  d = placePart(d, sheet, power("GND"), { x: 0, y: -3 * GRID }).design;
  d = addWire(d, sheet, [0, -1.5 * GRID], [0, -3 * GRID]);
  return pushToBoard(d).design;
};

/** The electronics design is saved in the model file (#615). */
describe("electronics in a .bcad file", () => {
  it("round-trips with its parts, nets and board", () => {
    const doc = { ...newDoc("Controller"), electronics: design() };
    const r = loadBcad(saveBcad(doc, { now: new Date("2026-11-24T00:00:00Z") }));
    if (r instanceof BcadError) throw r;
    expect(r.doc.electronics).toEqual(JSON.parse(JSON.stringify(doc.electronics)));
    expect(netlist(r.doc.electronics!).nets.map((n) => n.name)).toEqual(["GND"]);
    expect(r.doc.electronics!.board!.placements.map((p) => p.ref)).toEqual(["R1"]);
  });

  it("leaves a model without electronics exactly as it was", () => {
    const doc = newDoc("Plain");
    const text = saveBcad(doc, { now: new Date("2026-11-24T00:00:00Z") });
    expect(text).not.toContain("electronics");
    const r = loadBcad(text);
    if (r instanceof BcadError) throw r;
    expect(r.doc.electronics).toBeUndefined();
  });

  it("says when the electronics section is damaged", () => {
    const file = JSON.parse(saveBcad({ ...newDoc("Bad"), electronics: design() }));
    delete file.document.electronics.sheets;
    const r = loadBcad(JSON.stringify(file));
    expect(r).toBeInstanceOf(BcadError);
    expect((r as BcadError).message).toMatch(/damaged/);
  });
});

/** The Board step (#650): the board and its parts as one component, built from the design each time. */
describe("the Board step", () => {
  const doc = () => addBoard({ ...newDoc("Controller"), electronics: design() }, { position: { x: 10, y: 0, z: 5 } }, "pcb");

  it("builds the board and a body for each part, as one component", () => {
    const b = build(doc());
    expect([...b.failed]).toEqual([]);
    const board = b.parts.find((p) => p.id === boardBodyId("pcb"))!;
    expect(board).toMatchObject({
      name: "Board",
      kind: "solid",
      position: { x: 10, y: 0, z: 5 },
      size: { x: 50, y: 40, z: 1.6 },
      reference: true,
      link: "pcb",
    });
    expect(board.prism).toMatchObject({ from: 0, to: 1.6, pierced: true });
    expect(board.mass).toBeGreaterThan(5);
    const r1 = b.parts.find((p) => p.name === "R1")!;
    expect(r1).toMatchObject({ kind: "box", link: "pcb", reference: true });
    // It stands on the top face, where the layout put it.
    const at = doc().electronics!.board!.placements[0]!;
    expect(r1.position.z).toBeCloseTo(5 + 1.6, 6);
    expect(Math.hypot(r1.position.x - 10 - at.x, r1.position.y - at.y)).toBeLessThan(3);
    expect(b.links.find((l) => l.id === "pcb")).toMatchObject({ name: "Board", parts: [board.id, r1.id] });
    expect(b.boards).toEqual([{ id: "pcb", body: board.id, left: 0 }]);
    expect(featureSummary(doc(), doc().features[0]!)).toBe("1.6 mm thick, 1 part, one component");
  });

  it("follows the layout: a part on the bottom hangs under the board, and holes go through it", () => {
    const d = doc();
    const board = d.electronics!.board!;
    const next = {
      ...d,
      electronics: {
        ...d.electronics!,
        board: {
          ...board,
          placements: board.placements.map((p) => ({ ...p, x: 20, y: 20, side: "bottom" as const })),
          holes: [
            { id: "h1", x: 5, y: 5, drill: 3.2 },
            { id: "h2", x: 49.5, y: 5, drill: 3.2 },
          ],
          vias: [{ id: "v1", net: "GND", x: 30, y: 30, diameter: 0.6, drill: 0.3 }],
        },
      },
    };
    const b = build(next);
    const r1 = b.parts.find((p) => p.name === "R1")!;
    expect(r1.position.z).toBeCloseTo(5, 6);
    expect(fromPartLocal([0, 0, 1], r1, true)[2]).toBeCloseTo(-1, 6);
    const body = b.parts.find((p) => p.id === boardBodyId("pcb"))!;
    // One mounting hole is cut; the one over the edge and the via too small to matter are left out.
    expect(body.prism!.profiles[0]!.holes.length).toBe(1);
    expect(b.boards![0]!.left).toBe(2);
  });

  it("stands a part's STEP file on its footprint, a body for each solid in the file, lifted and turned (#628)", () => {
    const d = doc();
    const e = d.electronics!;
    const id = e.parts.find((p) => p.ref === "R1")!.def;
    const def = e.defs[id]!;
    const model = {
      source: { kind: "step" as const, blob: "abc", name: "r.step", bodies: 2, size: [3, 2, 1] as [number, number, number] },
      offset: [0, 0, 0.5] as [number, number, number],
      rotate: [0, 0, 90] as [number, number, number],
    };
    const withStep = { ...d, electronics: { ...e, defs: { ...e.defs, [id]: { ...def, packages: def.packages.map((k) => ({ ...k, model })) } } } };
    // Until the file is in the model, a box of the file's size stands in for it.
    const box = build(withStep).parts.filter((p) => p.name === "R1");
    expect(box).toHaveLength(1);
    expect(box[0]).toMatchObject({ kind: "box", size: { x: 3, y: 2, z: 1 } });
    const b = build({ ...withStep, blobs: { abc: "" } });
    expect([...b.failed]).toEqual([]);
    const made = b.parts.filter((p) => p.name === "R1");
    expect(made.map((p) => p.id)).toEqual(["pcb/" + e.parts.find((p) => p.ref === "R1")!.id, `pcb/${e.parts.find((p) => p.ref === "R1")!.id}.1`]);
    expect(made[1]).toMatchObject({
      kind: "solid",
      reference: true,
      pcb: true,
      link: "pcb",
      imported: { blob: "abc", format: "step", index: 1, mesh: false, keepLayout: true },
    });
    // On the top face, half a millimetre up, and a quarter turn on from where the layout turned the part.
    const at = e.board!.placements[0]!;
    expect(made[0]!.position).toMatchObject({ x: expect.closeTo(10 + at.x, 6), y: expect.closeTo(at.y, 6), z: expect.closeTo(5 + 1.6 + 0.5, 6) });
    const x = fromPartLocal([1, 0, 0], made[0]!, true);
    const turned = ((at.rot + 90) * Math.PI) / 180;
    expect(x[0]).toBeCloseTo(Math.cos(turned), 6);
    expect(x[1]).toBeCloseTo(Math.sin(turned), 6);
    expect(b.links.find((l) => l.id === "pcb")!.parts).toHaveLength(3);
  });

  it("stands a robot catalogue part on its footprint, the same model Insert part places (#624)", () => {
    const d = doc();
    const e = d.electronics!;
    const id = e.parts.find((p) => p.ref === "R1")!.def;
    const def = e.defs[id]!;
    const pico = cataloguePart("pico")!;
    const model = {
      source: { kind: "catalogue" as const, part: pico as unknown as CatalogueBody, size: [21, 52.3, 3.6] as [number, number, number] },
      offset: [0, 0, 0] as [number, number, number],
      rotate: [0, 0, -90] as [number, number, number],
    };
    const b = build({ ...d, electronics: { ...e, defs: { ...e.defs, [id]: { ...def, packages: def.packages.map((k) => ({ ...k, model })) } } } });
    expect([...b.failed]).toEqual([]);
    const made = b.parts.filter((p) => p.name === "R1");
    expect(made).toHaveLength(1);
    expect(made[0]).toMatchObject({ kind: "solid", reference: true, pcb: true, link: "pcb", catalogue: { id: "pico" } });
    // Its USB end, at -x in the catalogue, points up the footprint's +y, where pin 1 is.
    const at = e.board!.placements[0]!;
    const usb = fromPartLocal([-1, 0, 0], made[0]!, true);
    const up = ((at.rot + 90) * Math.PI) / 180;
    expect(usb[0]).toBeCloseTo(Math.cos(up), 6);
    expect(usb[1]).toBeCloseTo(Math.sin(up), 6);
    expect(made[0]!.position.z).toBeCloseTo(5 + 1.6, 6);
  });

  it("is one per model, and says so when there is no board yet", () => {
    const d = doc();
    expect(addBoard(d)).toBe(d);
    expect(boardStep(d)?.id).toBe("pcb");
    const bare = addBoard(newDoc("Empty"), {}, "pcb");
    expect(build(bare).failed.get("pcb")).toMatch(/There is no board yet/);
  });

  it("stands on the sketch its outline came from", () => {
    // A sketch on a wall: X along the world's Y, its normal along the world's X, 30 mm out.
    const on = onSketch({ origin: [30, 0, 0], x: [0, 1, 0], normal: [1, 0, 0] }, [4, 6]);
    const [board] = boardParts({ id: "pcb", position: { x: 0, y: 0, z: 2 } }, boardSolid(design())!, on);
    // Its corner is 4 along and 6 up the sketch, and the step's own 2 mm lifts it off the wall.
    expect(board!.position.x).toBeCloseTo(32, 6);
    expect(board!.position.y).toBeCloseTo(4, 6);
    expect(board!.position.z).toBeCloseTo(6, 6);
    expect(fromPartLocal([0, 0, 1], board!, true)[0]).toBeCloseTo(1, 6);
  });
});
