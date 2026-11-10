import { describe, expect, it } from "vitest";
import { bodyRef } from "./construct";
import { addJoint, addLink, addPart, addPattern, build, changeParts, newDoc, type BuiltTrack, type ModelDoc } from "./document";
import { IDENTITY, linkTransforms, mat4Apply, type Mat4, type PoseJoint } from "./pose";
import { layTrack, type WorldCircle } from "./track";
import { slideTrack, trackDrive, trackMoves, trackStep, WheelTurns } from "./trackMotion";

type V3 = [number, number, number];
const wheels: WorldCircle[] = [
  { centre: [0, 0, 0], normal: [0, 1, 0], radius: 20 },
  { centre: [120, 0, 0], normal: [0, 1, 0], radius: 20 },
];
const piece = { start: [-5, 0, 0] as V3, end: [5, 0, 0] as V3, axis: [0, 1, 0] as V3 };
const spec = { count: 30, offset: 0, lift: 0, side: 0, wheels: [] };
const track: BuiltTrack = { id: "t", parts: Array.from({ length: 30 }, (_, i) => `p${i}`), track: spec, piece, wheels };
const home = layTrack(spec, piece, wheels).pieces;
/** Where piece i's start pin is drawn after its move `m`. */
const pin = (i: number, m: Mat4) => mat4Apply(m, mat4Apply(home[i]!, piece.start));
const dist = (a: number[], b: number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

describe("track running round", () => {
  it("leaves the pieces where they are when it hasn't moved", () => {
    slideTrack(track, 0).forEach((m, i) => expect(dist(pin(i, m), pin(i, IDENTITY))).toBeLessThan(1e-6));
  });

  it("keeps every piece joined to the next as it runs", () => {
    for (const s of [0.7, 3, 11.2, 57, -9]) {
      const moves = slideTrack(track, s);
      let apart = 0;
      for (let i = 0; i + 1 < moves.length; i++) {
        const end = mat4Apply(moves[i]!, mat4Apply(home[i]!, piece.end));
        const next = mat4Apply(moves[i + 1]!, mat4Apply(home[i + 1]!, piece.start));
        // Each joint but the one where the ends of the loop meet.
        if (dist(end, next) > 1e-3) apart += 1;
      }
      expect(apart).toBeLessThanOrEqual(1);
    }
  });

  it("moves smoothly from one piece's place to the next", () => {
    // Piece 0 sits on the first straight run; nudged on a hair either side of a whole step it barely moves.
    const step = trackStep(track);
    expect(step).toBeGreaterThanOrEqual(10);
    expect(step).toBeLessThan(10.2);
    const before = pin(0, slideTrack(track, step - 1e-6)[0]!);
    const after = pin(0, slideTrack(track, step + 1e-6)[0]!);
    expect(dist(before, after)).toBeLessThan(0.05);
    // And a whole step on, it's (near enough) where the next piece was.
    expect(dist(after, pin(1, IDENTITY))).toBeLessThan(0.05);
  });

  it("counts whole turns of a wheel past 180°", () => {
    const j: PoseJoint = { id: "j", kind: "continuous", child: "W", parent: null, origin: [0, 0, 0], axis: [0, 1, 0], lower: 0, upper: 0 };
    const turns = new WheelTurns();
    expect(turns.of(j, { j: 170 })).toBe(170);
    expect(turns.of(j, { j: 190 })).toBeCloseTo(190);
    expect(turns.of(j, { j: 350 })).toBeCloseTo(350);
    expect(turns.of(j, { j: 10 })).toBeCloseTo(370);
    expect(turns.of(j, { j: 0 })).toBe(0);
  });
});

/** Two wheels, each its own component on a wheel joint about Z, and a track of 20 pieces round them. */
function rover(axis: V3 = [0, 0, 1]): ModelDoc {
  let doc = addPart(newDoc(), "cylinder", "w1");
  doc = changeParts(doc, ["w1"], "size", { x: 40, y: 40, z: 10 });
  doc = addPart(doc, "cylinder", "w2");
  doc = changeParts(doc, ["w2"], "size", { x: 40, y: 40, z: 10 });
  doc = changeParts(doc, ["w2"], "position", { x: 100, y: 0, z: 0 });
  doc = addPart(doc, "box", "link");
  doc = changeParts(doc, ["link"], "size", { x: 10, y: 4, z: 2 });
  doc = changeParts(doc, ["link"], "position", { x: 50, y: 60, z: 4 });
  const parts = build(doc).parts;
  const p = (id: string) => parts.find((q) => q.id === id)!;
  const circle = (centre: V3, radius: number) => ({ t: "circle" as const, centre, axis: [0, 0, 1] as V3, radius });
  doc = addPattern(
    doc,
    {
      kind: "track",
      parts: ["link"],
      track: {
        count: 20,
        start: bodyRef(p("link"), "edge", 0, circle([46, 60, 5], 1)),
        end: bodyRef(p("link"), "edge", 1, circle([54, 60, 5], 1)),
        wheels: [bodyRef(p("w1"), "edge", 0, circle([0, 0, 5], 20)), bodyRef(p("w2"), "edge", 0, circle([100, 0, 5], 20))],
        offset: 0,
        lift: 2,
        side: 0,
      },
    },
    "t",
  );
  doc = addLink(doc, ["w1"], "W1");
  return addJoint(doc, { kind: "continuous", child: "W1", parent: null, origin: [0, 0, 5], axis, lower: 0, upper: 0 }, "J");
}

describe("tracks in a model", () => {
  it("lists the track's pieces in order as built", () => {
    const b = build(rover());
    expect(b.tracks).toHaveLength(1);
    expect(b.tracks![0]!.parts).toHaveLength(20);
    expect(b.tracks![0]!.parts[0]).toBe("link");
    expect(b.tracks![0]!.wheels).toHaveLength(2);
  });

  it("runs the pieces round as far as the wheel's rim turns, whichever way its axle points", () => {
    for (const [axis, way] of [
      [[0, 0, 1], 1],
      [[0, 0, -1], -1],
    ] as [V3, number][]) {
      const b = build(rover(axis));
      const t = b.tracks![0]!;
      const joint = b.joints.find((j) => j.child === b.links.find((l) => l.parts.includes("w1"))!.id)!;
      const drive = trackDrive(t, b.joints, b.links)!;
      expect(drive.joint.id).toBe(joint.id);
      expect(drive.sign).toBe(way);
      expect(drive.radius).toBe(22);
      // A tenth of a turn: the rim (22 mm out) runs 2π·22/10 mm.
      const pose = { [joint.id]: 36 };
      const moves = trackMoves(b.tracks!, b.joints, b.links, pose, linkTransforms(b.joints, pose, b.components), new WheelTurns());
      expect(moves.size).toBe(20);
      const lay = layTrack(t.track, t.piece, t.wheels);
      // A piece on the straight under the wheels (y = -22, the loop running +x there, anticlockwise) moves along it.
      const top = lay.pieces.findIndex((m) => {
        const q = mat4Apply(m, t.piece.start);
        return q[1]! < -21 && q[0]! > 30 && q[0]! < 50;
      });
      expect(top).toBeGreaterThanOrEqual(0);
      const was = mat4Apply(lay.pieces[top]!, t.piece.start);
      const now = mat4Apply(moves.get(t.parts[top]!)!, was);
      expect(now[0]! - was[0]!).toBeCloseTo((way * 2 * Math.PI * 22) / 10, 0);
      expect(now[1]).toBeCloseTo(was[1]!, 3);
    }
  });

  it("leaves a track alone when no wheel it goes round turns", () => {
    let d = rover();
    d = { ...d, features: d.features.filter((f) => f.type !== "joint") };
    const b = build(d);
    expect(trackDrive(b.tracks![0]!, b.joints, b.links)).toBeNull();
    expect(trackMoves(b.tracks!, b.joints, b.links, {}, new Map(), new WheelTurns()).size).toBe(0);
  });
});
