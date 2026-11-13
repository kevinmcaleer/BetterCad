import { beforeAll, describe, expect, it } from "vitest";
import { drawRectangle, type Sketch } from "@bettercad/sketch";
import { loadOCCT, type OC } from "./oc";
import { ModelBuilder } from "./model";
import { Exporter } from "./exporter";
import { DEFLECTION, readStep } from "./export";
import { addExtrude, addJoint, addLink, addPart, addSketch, changeParts, newDoc, setLook, setPose, updateSketch, type ModelDoc } from "../document";
import { unzip } from "../export/zip";
import { meshVolume, read3mf, readStl } from "../export/mesh";
import { measure } from "./shapes";
import { readGlb } from "../export/gltf";
import { DEFAULT_COLOUR, linearRgb } from "../looks";

let oc: OC;
let m: ModelBuilder;
let x: Exporter;
beforeAll(async () => {
  oc = await loadOCCT();
  m = new ModelBuilder(oc);
  x = new Exporter(oc, m);
}, 60_000);

/** The timeline test model (#78): ten 10 mm blocks joined into one 10 × 10 × 100 tower. */
function tower(): ModelDoc {
  const square = (d: ModelDoc, id: string, up: number) => {
    const s = addSketch(d, { kind: "world", plane: "XY", offset: up }, id);
    return updateSketch(s, id, (k: Sketch) => drawRectangle(k, [0, 0], [10, 10]).sketch);
  };
  let d = square(newDoc("Tower"), "s0", 0);
  d = addExtrude(d, { sketch: "s0", seeds: [[5, 5]], distance: 10, direction: "one", operation: "new" }, "x0", "body");
  for (let k = 1; k < 10; k++) {
    d = square(d, `s${k}`, 10 * k);
    d = addExtrude(d, { sketch: `s${k}`, seeds: [[5, 5]], distance: 10, direction: "one", operation: "join", target: "body" }, `x${k}`);
  }
  return d;
}

describe("exports of the model (#80, #81, #86)", () => {
  it("exports the timeline test model to STL with the B-rep's volume, on the bed", () => {
    const d = tower();
    const r = x.export({ doc: d, bodies: null, format: "stl", deflection: DEFLECTION.normal, name: "Tower" });
    expect(r.files.map((f) => f.name)).toEqual(["Tower.stl"]);
    const t = readStl(r.files[0]!.data);
    expect(Math.abs(meshVolume(t) - 10_000) / 10_000).toBeLessThan(0.005);
    expect(Math.min(...[...t].filter((_, i) => i % 3 === 2))).toBe(0);
  });

  it("matches a curved body's volume to 0.5% at Normal and 0.1% at Fine", () => {
    const d = addPart(newDoc("Can"), "cylinder", "c");
    const exact = m.build(d).bodies[0]!.measure.volume;
    for (const [q, tol] of [
      [DEFLECTION.normal, 0.005],
      [DEFLECTION.fine, 0.001],
    ] as const) {
      const t = readStl(x.export({ doc: d, bodies: null, format: "stl", deflection: q, name: "Can" }).files[0]!.data);
      expect(Math.abs(meshVolume(t) - exact) / exact).toBeLessThan(tol);
    }
  });

  it("estimates more triangles at Fine than at Draft, and the export matches the estimate", () => {
    const d = addPart(newDoc("Ball"), "sphere", "s");
    const draft = x.estimate({ doc: d, bodies: null, format: "stl", deflection: DEFLECTION.draft });
    const fine = x.estimate({ doc: d, bodies: null, format: "stl", deflection: DEFLECTION.fine });
    expect(fine.triangles).toBeGreaterThan(draft.triangles);
    const r = x.export({ doc: d, bodies: null, format: "stl", deflection: DEFLECTION.fine, name: "Ball" });
    expect(r.triangles).toBe(fine.triangles);
    expect(r.files[0]!.data.byteLength).toBe(fine.bytes);
  });

  it("writes one 3MF object per body, or one file per body, and skips hole shapes", () => {
    let d = addPart(newDoc("Kit"), "box", "a");
    d = addPart(d, "cylinder", "b");
    d = addPart(d, "sphere", "h");
    d = setLook(d, ["h"], () => ({ hole: true }));
    const r = x.export({ doc: d, bodies: null, format: "3mf", deflection: DEFLECTION.draft, name: "Kit" });
    expect(r.skipped).toBe(1);
    expect(read3mf(r.files[0]!.data).map((b) => b.name)).toEqual(["Box 1", "Cylinder 1"]);
    const each = x.export({ doc: d, bodies: null, format: "stl", deflection: DEFLECTION.draft, separate: true, name: "Kit" });
    expect(each.files.map((f) => f.name)).toEqual(["Kit-Box 1.stl", "Kit-Cylinder 1.stl"]);
    expect(() => x.estimate({ doc: d, bodies: ["h"], format: "stl", deflection: 0.1 })).toThrow("Only hole shapes are chosen");
  });

  it("prints bodies of the same shape from one file, saying where each copy goes and how it's turned", () => {
    let d = addPart(newDoc("Kit"), "box", "a");
    d = changeParts(d, ["a"], "size", { x: 30, y: 20, z: 10 });
    d = addPart(d, "box", "b");
    d = changeParts(d, ["b"], "size", { x: 30, y: 20, z: 10 });
    d = changeParts(d, ["b"], "rotation", { z: 90 });
    d = addPart(d, "cylinder", "c");
    const r = x.export({ doc: d, bodies: null, format: "stl", deflection: DEFLECTION.draft, separate: true, same: true, name: "Kit" });
    expect(r.files.map((f) => f.name)).toEqual(["Kit-Box 1.stl", "Kit-Cylinder 1.stl"]);
    const [boxes] = r.files;
    expect(boxes!.copies!.map((c) => c.part)).toEqual(["a", "b"]);
    const each = x.export({ doc: d, bodies: null, format: "stl", deflection: DEFLECTION.draft, separate: true, name: "Kit" });
    // Each copy's middle is where that body's own file says it is.
    each.files.slice(0, 2).forEach((f, i) => f.centre!.forEach((v, k) => expect(boxes!.copies![i]!.centre[k]).toBeCloseTo(v, 2)));
    expect(boxes!.copies![0]!.rotation).toEqual([0, 0, 0]);
    const yaw = boxes!.copies![1]!.rotation;
    expect(Math.abs(yaw[2]) % 180).toBeCloseTo(90, 1);
  });

  it("says where each file's bodies sit in the model, though the file is on the bed", () => {
    let d = addPart(newDoc("Kit"), "box", "a");
    d = addPart(d, "box", "b");
    d = changeParts(d, ["b"], "position", { z: 40 });
    const each = x.export({ doc: d, bodies: null, format: "stl", deflection: DEFLECTION.draft, separate: true, name: "Kit" });
    expect(each.files.map((f) => f.parts)).toEqual([["a"], ["b"]]);
    const [a, b] = each.files.map((f) => f.centre!);
    expect(b![0] - a![0]).toBeCloseTo(25, 3);
    expect(b![2] - a![2]).toBeCloseTo(40, 3);
    // The file itself still sits on the bed.
    const zs = [...readStl(each.files[1]!.data)].filter((_, i) => i % 3 === 2);
    expect(Math.min(...zs)).toBeCloseTo(0, 3);
  });

  it("leaves reference bodies out (#185)", () => {
    let d = addPart(newDoc("Mount"), "box", "a");
    d = addPart(d, "cylinder", "servo");
    d = setLook(d, ["servo"], () => ({ reference: true }));
    const r = x.export({ doc: d, bodies: null, format: "3mf", deflection: DEFLECTION.draft, name: "Mount" });
    expect(r.skipped).toBe(1);
    expect(read3mf(r.files[0]!.data).map((b) => b.name)).toEqual(["Box 1"]);
    expect(() => x.estimate({ doc: d, bodies: ["servo"], format: "stl", deflection: 0.1 })).toThrow("Reference bodies aren't exported");
  });

  it("round-trips the timeline test model through STEP with the same volume and faces", () => {
    const d = tower();
    const built = m.build(d).bodies[0]!.measure;
    const r = x.export({ doc: d, bodies: null, format: "step", deflection: 0, name: "Tower" });
    expect(r.files[0]!.name).toBe("Tower.step");
    const back = readStep(oc, r.files[0]!.data);
    expect(back).toHaveLength(1);
    const got = measure(oc, back[0]!.shape);
    expect(Math.abs(got.volume - built.volume)).toBeLessThan(1e-6 * built.volume);
    expect(got.faces).toBe(built.faces);
    expect(x.estimate({ doc: d, bodies: null, format: "step", deflection: 0 })).toMatchObject({ solids: 1, triangles: 0 });
  });

  it("exports GLB and glTF (#195): a node per body, metres, Y up, on the bed", () => {
    let d = addPart(newDoc("Kit"), "box", "a");
    d = addPart(d, "cylinder", "c");
    const r = x.export({ doc: d, bodies: null, format: "glb", deflection: DEFLECTION.draft, name: "Kit" });
    expect(r.files.map((f) => f.name)).toEqual(["Kit.glb"]);
    const { json } = readGlb(r.files[0]!.data);
    const root = json.nodes[json.scenes[0]!.nodes[0]!]!;
    expect(root.name).toBe("Kit");
    expect(root.children!.map((i) => json.nodes[i]!.name)).toEqual(["Box 1", "Cylinder 1"]);
    // On the bed: the lowest point is at glTF Y = 0, and a 20 mm box is 0.02 m tall.
    const box = json.accessors[json.meshes[0]!.primitives[0]!.attributes.POSITION!]!;
    expect(Math.abs(box.min![1]!)).toBeLessThan(1e-9);
    expect(box.max![1]! - box.min![1]!).toBeCloseTo(0.02, 6);

    const est = x.estimate({ doc: d, bodies: null, format: "glb", deflection: DEFLECTION.draft });
    expect(est.bytes / r.files[0]!.data.byteLength).toBeGreaterThan(0.5);
    expect(est.bytes / r.files[0]!.data.byteLength).toBeLessThan(2);

    const g = x.export({ doc: d, bodies: null, format: "gltf", deflection: DEFLECTION.draft, separate: true, name: "Kit" });
    expect(g.files.map((f) => f.name)).toEqual(["Kit-Box 1.gltf", "Kit-Box 1.bin", "Kit-Cylinder 1.gltf", "Kit-Cylinder 1.bin"]);
  });

  it("carries each body's colour and finish into the glTF materials (#196)", () => {
    let d = addPart(newDoc("Kit"), "box", "a");
    d = addPart(d, "cylinder", "c");
    d = setLook(d, ["c"], () => ({ colour: "#2d6fd0", finish: "metal" }));
    const { json } = readGlb(x.export({ doc: d, bodies: null, format: "glb", deflection: DEFLECTION.draft, name: "Kit" }).files[0]!.data);
    const [plain, blue] = json.materials.map((m) => m.pbrMetallicRoughness);
    expect(plain).toEqual({ baseColorFactor: [...linearRgb(DEFAULT_COLOUR), 1], roughnessFactor: 0.85, metallicFactor: 0 });
    expect(blue).toEqual({ baseColorFactor: [...linearRgb("#2d6fd0"), 1], roughnessFactor: 0.3, metallicFactor: 1 });
  });
});

describe("exporting as posed (#173)", () => {
  // A box made a link on a slider along +Z, posed 30 mm up.
  function posed(): ModelDoc {
    let d = addPart(newDoc("Arm"), "box", "a");
    d = addLink(d, ["a"], "l1");
    d = addJoint(d, { kind: "prismatic", child: "l1", parent: null, origin: [0, 0, 0], axis: [0, 0, 1], lower: 0, upper: 50 }, "j1");
    return setPose(d, "j1", 30);
  }

  it("exports the home pose unless asked, and the posed one when asked, as STL", () => {
    const d = posed();
    const zs = (posedToo: boolean) => {
      const t = readStl(
        x.export({ doc: d, bodies: null, format: "stl", deflection: DEFLECTION.normal, name: "Arm", keepPosition: true, posed: posedToo }).files[0]!.data,
      );
      return [...t].filter((_, i) => i % 3 === 2);
    };
    const home = Math.min(...zs(false));
    expect(Math.min(...zs(true)) - home).toBeCloseTo(30, 3);
  });

  it("moves the exact solid in STEP", () => {
    const d = posed();
    const at = (posedToo: boolean) => {
      const r = x.export({ doc: d, bodies: null, format: "step", deflection: 0, name: "Arm", posed: posedToo });
      return measure(oc, readStep(oc, r.files[0]!.data)[0]!.shape);
    };
    const home = at(false);
    const moved = at(true);
    expect(moved.bbox.min[2] - home.bbox.min[2]).toBeCloseTo(30, 3);
    expect(moved.volume).toBeCloseTo(home.volume, 1);
  });
});

describe("exporting a robot as URDF (#175)", () => {
  // A 30 mm base cube, and a 20 mm cube 40 mm up made a link on a hinge at (0, 0, 40).
  function arm(): ModelDoc {
    let d = addPart({ ...newDoc("Arm bot"), print: { material: "pla", infill: 20 } }, "box", "b");
    d = changeParts(d, ["b"], "size", { x: 30, y: 30, z: 30 });
    d = addPart(d, "box", "a");
    d = changeParts(d, ["a"], "position", { x: 0, y: 0, z: 40 });
    d = addLink(d, ["a"], "l1");
    return addJoint(d, { kind: "revolute", child: "l1", parent: null, origin: [0, 0, 40], axis: [1, 0, 0], lower: -90, upper: 90 }, "j1");
  }

  it("zips the .urdf and one STL per link, in metres and in each link's frame", () => {
    const r = x.export({ doc: setPose(arm(), "j1", 45), bodies: null, format: "urdf", deflection: DEFLECTION.draft, name: "Arm bot" });
    expect(r.files.map((f) => f.name)).toEqual(["Arm bot.zip"]);
    const files = unzip(new Uint8Array(r.files[0]!.data));
    expect([...files.keys()]).toEqual(["Arm_bot/Arm_bot.urdf", "Arm_bot/meshes/base_link.stl", "Arm_bot/meshes/Component_1.stl"]);
    const urdf = new TextDecoder().decode(files.get("Arm_bot/Arm_bot.urdf"));
    expect(urdf).toContain('<origin xyz="0 0 0.04" rpy="0 0 0"/>');
    expect(urdf).toContain('<axis xyz="1 0 0"/>');
    // The link's cube sits at its joint's origin, so its mesh starts there, at home whatever the pose.
    const link = readStl(files.get("Arm_bot/meshes/Component_1.stl")!.slice().buffer);
    const zs = [...link].filter((_, i) => i % 3 === 2);
    expect(Math.min(...zs)).toBeCloseTo(0, 6);
    expect(Math.max(...zs)).toBeCloseTo(0.02, 6);
    const base = readStl(files.get("Arm_bot/meshes/base_link.stl")!.slice().buffer);
    expect(Math.max(...base)).toBeCloseTo(0.03, 6);
  });

  it("weighs each link as printed", () => {
    const r = x.export({ doc: arm(), bodies: null, format: "urdf", deflection: DEFLECTION.draft, name: "Arm bot" });
    const urdf = new TextDecoder().decode(unzip(new Uint8Array(r.files[0]!.data)).get("Arm_bot/Arm_bot.urdf"));
    const masses = [...urdf.matchAll(/<mass value="([^"]+)"/g)].map((m) => Number(m[1]));
    const [base] = m.mass(arm()).filter((b) => b.id === "b");
    expect(masses[0]! / (base!.mass / 1000)).toBeCloseTo(1, 5);
    expect(masses).toHaveLength(2);
  });

  it("estimates the meshes, and needs a joint", () => {
    const est = x.estimate({ doc: arm(), bodies: null, format: "urdf", deflection: DEFLECTION.draft });
    expect(est.solids).toBe(2);
    expect(est.triangles).toBe(24);
    expect(() => x.estimate({ doc: addPart(newDoc("Box"), "box", "b"), bodies: null, format: "urdf", deflection: DEFLECTION.draft })).toThrow(
      "Add a joint first to export a robot.",
    );
  });
});
