import { describe, expect, it } from "vitest";
import {
  addLink,
  addPart,
  addPattern,
  build,
  changeParts,
  dependsOn,
  featureParts,
  featureSummary,
  newDoc,
  setLook,
  updatePattern,
  withTrackMates,
  type ModelDoc,
} from "./document";
import { bodyRef } from "./construct";
import { movePoint, moveToLocal, patternCopyIds, patternProblem, undoMove, type CopyMove } from "./pattern";
import { layChain, layTrack, loopLength, trackLayoutOf, trackPitch, wrapLoop, type WorldCircle } from "./track";
import { insideReach, trackFitText } from "./trackFit";
import { mat4Apply } from "./pose";

type V3 = [number, number, number];
const wheels: WorldCircle[] = [
  { centre: [0, 0, 0], normal: [0, 1, 0], radius: 20 },
  { centre: [120, 0, 0], normal: [0, 1, 0], radius: 20 },
];
const piece = { start: [-5, 0, 0] as V3, end: [5, 0, 0] as V3, axis: [0, 1, 0] as V3 };
const at = (m: number[], p: V3) => mat4Apply(m, p);
const dist = (a: number[], b: number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

describe("track maths", () => {
  it("wraps two circles like a belt", () => {
    const loop = wrapLoop([
      { x: 0, y: 0, r: 10 },
      { x: 100, y: 0, r: 10 },
    ]);
    expect(loopLength(loop)).toBeCloseTo(200 + 2 * Math.PI * 10, 0);
  });

  it("lays pieces a pitch apart and counts how many fit", () => {
    const loop = wrapLoop([
      { x: 0, y: 0, r: 20 },
      { x: 150, y: 0, r: 20 },
    ]);
    const c = layChain(loop, 10, 10, 0);
    expect(c.pivots).toHaveLength(10);
    for (let i = 1; i < c.pivots.length; i++)
      expect(Math.hypot(c.pivots[i]![0] - c.pivots[i - 1]![0], c.pivots[i]![1] - c.pivots[i - 1]![1])).toBeCloseTo(10, 3);
    const L = 300 + 2 * Math.PI * 20;
    expect(c.fits).toBeGreaterThan(L / 10 - 0.5);
    expect(c.fits).toBeLessThan(L / 10 + 0.01);
  });

  it("measures the pitch across the pins", () => {
    expect(trackPitch({ start: [0, 0, 0], end: [12, 3, 0], axis: [0, 1, 0] })).toBeCloseTo(12);
  });

  it("puts each piece's end pin on the next one's start pin, round the wheels", () => {
    const lay = layTrack({ count: 30, offset: 0, lift: 0, side: 0 }, piece, wheels);
    expect(lay.pieces).toHaveLength(30);
    for (let i = 0; i + 1 < lay.pieces.length; i++) {
      const end = at(lay.pieces[i]!, piece.end);
      const next = at(lay.pieces[i + 1]!, piece.start);
      expect(dist(end, next)).toBeLessThan(1e-3);
      // In the wheels' plane, on the loop round them.
      expect(next[1]).toBeCloseTo(0, 4);
    }
    // Every pin is on the loop: 20 mm from a wheel's centre on the round ends, or on a straight run.
    for (const m of lay.pieces) {
      const p = at(m, piece.start);
      const d = p[0]! < 0 ? Math.hypot(p[0]!, p[2]!) : p[0]! > 120 ? Math.hypot(p[0]! - 120, p[2]!) : Math.abs(p[2]!);
      expect(d).toBeCloseTo(20, 1);
    }
  });

  it("finds the lift that sets the piece's inside on the wheels", () => {
    // Its inside is a × d (-Z here): a piece reaching 3 mm in and 1 mm out.
    const pos = [-5, 0, -3, 5, 0, 1, 0, 1, 0];
    expect(insideReach(pos, piece)).toBe(3);
    expect(insideReach(pos, piece, true)).toBe(1);
  });

  it("says how well the count fits", () => {
    expect(trackFitText(20, 20.02, 10)).toBe("20 pieces go round: a good fit.");
    expect(trackFitText(19, 20, 10)).toBe("20 pieces go round: 10 mm short of closing.");
    expect(trackFitText(21, 20, 10)).toBe("20 pieces go round: 10 mm too long, so it overlaps.");
  });

  it("moves points by a place, and undoes it", () => {
    const lay = layTrack({ count: 12, offset: 0, lift: 2, side: 0 }, piece, wheels);
    const m: CopyMove = { place: lay.pieces[7]! };
    const p = { x: 3, y: -2, z: 1 };
    const q = movePoint(movePoint(p, m), undoMove(m));
    expect(q.x).toBeCloseTo(3, 6);
    expect(q.y).toBeCloseTo(-2, 6);
    expect(q.z).toBeCloseTo(1, 6);
    // Seen from a part that isn't turned, a place is the same move.
    const local = moveToLocal(m, { position: { x: 0, y: 0, z: 0 } });
    const w = movePoint(p, local);
    const v = movePoint(p, m);
    expect(dist([w.x, w.y, w.z], [v.x, v.y, v.z])).toBeLessThan(1e-6);
  });
});

/** A 10 × 4 × 2 mm piece with pins 8 mm apart, beside two 40 mm wheels whose axles run along Z. */
function trackDoc(): ModelDoc {
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
  return addPattern(
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
}

describe("Track (Pattern's Track kind)", () => {
  it("makes the piece the first link and copies the rest round the wheels", () => {
    const doc = trackDoc();
    const f = doc.features.at(-1)!;
    expect(f.type === "pattern" && patternProblem(f)).toBeNull();
    const b = build(doc);
    expect(b.failed.size).toBe(0);
    const links = b.parts.filter((p) => p.id === "link" || p.id.startsWith("t."));
    expect(links).toHaveLength(20);
    expect(links[0]!.name).toBe("Box 1");
    expect(links[1]!.name).toBe("Box 1 2");
    // Each piece is a copy of the piece as it stood, placed on the loop: 22 mm out from a wheel's centre at the ends.
    for (const l of links) {
      const m = l.copy && "place" in l.copy.by ? l.copy.by.place : null;
      expect(m).not.toBeNull();
      const pin = mat4Apply(m!, [46, 60, 5]);
      expect(pin[2]).toBeCloseTo(5, 4);
      const d = pin[0]! < 0 ? Math.hypot(pin[0]!, pin[1]!) : pin[0]! > 100 ? Math.hypot(pin[0]! - 100, pin[1]!) : Math.abs(pin[1]!);
      expect(d).toBeCloseTo(22, 1);
    }
    expect(featureParts(f)).toEqual(["link", ...patternCopyIds(f as never)]);
    expect(featureSummary(doc, f)).toBe("Box 1, 20 pieces round 2 wheels");
  });

  it("colours every piece when one is coloured", () => {
    const doc = trackDoc();
    const copy = "t.link.4";
    const all = withTrackMates(doc, [copy]);
    expect(all).toHaveLength(20);
    expect(all).toContain("link");
    expect(withTrackMates(doc, ["w1"])).toEqual(["w1"]);
    const red = setLook(doc, all, () => ({ colour: "#c0392b", finish: "silk" }));
    const pieces = build(red).parts.filter((p) => p.id === "link" || p.id.startsWith("t."));
    expect(pieces.every((p) => p.colour === "#c0392b" && p.finish === "silk")).toBe(true);
    // Coloured before this (only the piece itself), the copies still wear it; one given its own keeps that.
    let old = setLook(doc, ["link"], () => ({ colour: "#2e86de" }));
    old = setLook(old, [copy], () => ({ colour: "#27ae60" }));
    const b = build(old).parts;
    expect(b.find((p) => p.id === "t.link.0")!.colour).toBe("#2e86de");
    expect(b.find((p) => p.id === copy)!.colour).toBe("#27ae60");
    expect(b.find((p) => p.id === "w1")!.colour).toBeUndefined();
  });

  it("mirrors a coloured track, as bodies or as a component, in its colours", () => {
    let doc = setLook(trackDoc(), ["link"], () => ({ colour: "#222222", finish: "rubber" }));
    doc = setLook(doc, ["w1"], () => ({ colour: "#888888" }));
    const pieces = (d: ModelDoc) => featureParts(d.features.find((f) => f.id === "t")!);
    const bodies = addPattern(doc, { parts: ["w1", ...pieces(doc)], kind: "mirror", plane: "XZ" }, "m");
    let b = build(bodies).parts;
    expect(b.find((p) => p.id === "m.link.0")!.colour).toBe("#222222");
    expect(b.find((p) => p.id === "m.t.link.7.0")!).toMatchObject({ colour: "#222222", finish: "rubber" });
    expect(b.find((p) => p.id === "m.w1.0")!.colour).toBe("#888888");
    expect(b.find((p) => p.id === "w2")!.colour).toBeUndefined();
    // A copy given its own colour keeps it.
    b = build(setLook(bodies, ["m.link.0"], () => ({ colour: "#ffffff" }))).parts;
    expect(b.find((p) => p.id === "m.link.0")!).toMatchObject({ colour: "#ffffff", finish: "rubber" });
    const comp = addPattern(addLink(doc, ["w1", "w2", ...pieces(doc)], "L1"), { parts: [], kind: "mirror", of: "component", link: "L1", plane: "XZ" }, "m");
    b = build(comp).parts;
    expect(b.filter((p) => p.link === "m" && p.id.includes("link")).every((p) => p.colour === "#222222")).toBe(true);
    expect(b.find((p) => p.id === "m.w2.0")!.colour).toBeUndefined();
  });

  it("follows the wheels when they move, and needs the steps that made them", () => {
    let doc = trackDoc();
    const lay = (d: ModelDoc) => {
      const f = d.features.at(-1)!;
      const parts = build(d, d.features.length - 1).parts;
      if (f.type !== "pattern" || !f.track) throw new Error("no track");
      return trackLayoutOf(f.track, (r) => {
        if (!("body" in r)) return "gone";
        const p = parts.find((q) => q.id === r.body);
        return p ? r.geo : "gone";
      });
    };
    expect(typeof lay(doc)).not.toBe("string");
    expect(dependsOn(doc, "t").length).toBeGreaterThanOrEqual(3);
    const f = doc.features.at(-1)!;
    if (f.type !== "pattern") throw new Error();
    doc = updatePattern(doc, "t", { track: { ...f.track!, count: 1 } });
    expect(build(doc).failed.get("t")).toBe("Give it 2 or more pieces");
  });

  it("says when a wheel is gone", () => {
    const doc = trackDoc();
    const f = doc.features.at(-1)!;
    if (f.type !== "pattern") throw new Error();
    const gone = updatePattern(doc, "t", {
      track: {
        ...f.track!,
        wheels: [f.track!.wheels[0]!, { body: "nope", kind: "edge", index: 0, geo: { t: "circle", centre: [0, 0, 0], axis: [0, 0, 1], radius: 3 } }],
      },
    });
    expect(build(gone).failed.get("t")).toBe("A wheel it goes round is gone");
  });
});
