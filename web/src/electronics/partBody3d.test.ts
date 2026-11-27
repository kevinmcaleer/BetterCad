import { beforeAll, describe, expect, it } from "vitest";
import { header, resistor, type PackageChoice } from "@bettercad/electronics";
import { blobHash, toBase64 } from "@bettercad/kernel";
import { newDoc, type Feature } from "@bettercad/kernel/document";
import { Exporter, ModelBuilder, loadOCCT, type OC } from "@bettercad/kernel/occt";
import { partMeshes, pinEnds, previewBox, previewDoc, snapPins } from "./partBody3d";

/** A flat patch at height z, as two triangles. */
function patch(x: number, y: number, w: number, h: number, z = 0) {
  return {
    positions: new Float32Array([x, y, z, x + w, y, z, x + w, y + h, z, x, y + h, z]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
  };
}

describe("where a body's pins end (#628)", () => {
  it("finds the middle of each flat patch at the lowest point, and nothing higher up", () => {
    const ends = pinEnds([patch(-3, -0.5, 1, 1), patch(2, -0.5, 1, 1), patch(-2, -1, 4, 2, 0.4)]);
    expect(ends.map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100]).sort()).toEqual([
      [-2.5, 0],
      [2.5, 0],
    ]);
    expect(pinEnds([])).toEqual([]);
  });

  it("moves the body so the most pin ends land on pads", () => {
    // Four pins in a row, 2.54 mm apart, a little off the pads and with a peg that has no pad.
    const pads = [0, 2.54, 5.08, 7.62].map((x): [number, number] => [x, 0]);
    const ends = [...pads.map(([x]): [number, number] => [x + 0.7, -0.4]), [3, 6] as [number, number]];
    expect(snapPins(ends, pads)).toEqual({ dx: -0.7, dy: 0.4, matched: 4, ends: 5 });
    expect(snapPins(pads, pads)).toMatchObject({ dx: 0, dy: 0, matched: 4 });
  });

  it("centres a body whose pins do not line up, and has nothing to say without pins or pads", () => {
    // One flat bottom over two pads.
    expect(
      snapPins(
        [[5, 5]],
        [
          [-1, 0],
          [1, 0],
        ],
      ),
    ).toEqual({ dx: -5, dy: -5, matched: 0, ends: 1 });
    expect(snapPins([], [[0, 0]])).toBeNull();
    expect(snapPins([[0, 0]], [])).toBeNull();
  });
});

describe("a part on a board of its own (#628)", () => {
  let oc: OC;
  beforeAll(async () => {
    oc = await loadOCCT();
  }, 60_000);

  it("builds the body where a board would put it, and finds its foot", () => {
    const def = resistor();
    // A footprint no true body is drawn for (#752), so the part is its simple box.
    const fp = { ...def.packages[0]!.footprint, name: "Custom" };
    const pkg: PackageChoice = { ...def.packages[0]!, footprint: fp, model: { source: { kind: "box", size: [1, 0.6, 0.5] }, offset: [0.4, 0.2, 0] } };
    const doc = previewDoc(def.symbol, pkg, () => undefined)!;
    const built = new ModelBuilder(oc).build(doc);
    expect(built.failed).toEqual([]);
    const meshes = partMeshes(built);
    expect(meshes).toHaveLength(1);
    // The box stands on the board's top face, its middle where the offset says.
    const ends = pinEnds(meshes);
    expect(ends).toHaveLength(1);
    expect(ends[0]![0]).toBeCloseTo(0.4, 3);
    expect(ends[0]![1]).toBeCloseTo(0.2, 3);
    const box = previewBox(pkg);
    expect(box.x1).toBeLessThan(-1);
    // Its one flat bottom is centred on the two pads.
    const pads = pkg.footprint.pads.map((p): [number, number] => [p.x, p.y]);
    expect(snapPins(ends, pads)).toMatchObject({ dx: -0.4, dy: -0.2, matched: 0 });
  });

  it("finds a real body's four pins and moves them onto the pads", () => {
    // A block on four round pins 2.54 mm apart, as a STEP file.
    const pins = [-3.81, -1.27, 1.27, 3.81];
    const part = (id: string, kind: "box" | "cylinder", size: [number, number, number], at: [number, number, number]): Feature => ({
      id: `f${id}`,
      type: "add",
      name: id,
      part: { id, name: id, kind, position: { x: at[0], y: at[1], z: at[2] }, size: { x: size[0], y: size[1], z: size[2] } },
    });
    const model = {
      ...newDoc("Socket"),
      features: [part("case", "box", [10.2, 2.5, 3], [0, 0, 2.5]), ...pins.map((x, i) => part(`pin${i}`, "cylinder", [0.6, 0.6, 3], [x, 0, 0]))],
    };
    const builder = new ModelBuilder(oc);
    const file = new Exporter(oc, builder).export({ doc: model, bodies: null, format: "step", deflection: 0, name: "Socket" }).files[0]!;
    const bytes = new Uint8Array(file.data);
    const blob = blobHash(bytes);
    const data = toBase64(bytes);
    const info = builder.inspect({ name: "socket.step", format: "step", blob, data });
    expect(info.bodies).toHaveLength(5);

    // On a four-pin header, whose pads run down the board: turned to match, but put down in the wrong place.
    const def = header(4);
    const pads = def.packages[0]!.footprint.pads.map((p): [number, number] => [p.x, p.y]);
    const at = (offset: [number, number, number]): PackageChoice => ({
      ...def.packages[0]!,
      model: { source: { kind: "step", blob, name: "socket.step", bodies: 5, size: info.size! }, offset, rotate: [0, 0, 90] },
    });
    const ends = (pkg: PackageChoice) => pinEnds(partMeshes(builder.build(previewDoc(def.symbol, pkg, () => data)!)));
    const before = ends(at([1.3, 0.8, 0]));
    expect(before).toHaveLength(4);
    const snap = snapPins(before, pads)!;
    expect(snap).toMatchObject({ matched: 4, ends: 4 });
    const after = ends(at([1.3 + snap.dx, 0.8 + snap.dy, 0]));
    for (const pad of pads) expect(Math.min(...after.map((e) => Math.hypot(e[0] - pad[0], e[1] - pad[1])))).toBeLessThan(0.02);
  });
});
