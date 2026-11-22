import { describe, expect, it } from "vitest";
import { drawArcCentre, drawCircle, drawEllipse, drawLine, drawRectangle, drawSlot } from "./draw";
import { sketchDxf } from "./dxf";
import { newSketch, type Sketch } from "./model";

/** The DXF's group code / value pairs. */
function pairs(text: string): [number, string][] {
  const lines = text.split("\r\n");
  const out: [number, string][] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) out.push([Number(lines[i]), lines[i + 1]!]);
  return out;
}

/** The entities, each as its type and its pairs. */
function entities(text: string): { type: string; values: [number, string][] }[] {
  const all = pairs(text);
  const start = all.findIndex(([c, v], i) => c === 2 && v === "ENTITIES" && all[i - 1]?.[1] === "SECTION");
  const out: { type: string; values: [number, string][] }[] = [];
  for (const [c, v] of all.slice(start + 1)) {
    if (c === 0) {
      if (v === "ENDSEC") break;
      out.push({ type: v, values: [] });
    } else out[out.length - 1]?.values.push([c, v]);
  }
  return out;
}

const get = (vals: [number, string][], code: number) => vals.filter(([c]) => c === code).map(([, v]) => Number(v));

describe("sketchDxf", () => {
  it("writes a rectangle as one closed polyline in mm", () => {
    const s = drawRectangle(newSketch(), [0, 0], [40, 20]).sketch;
    const dxf = sketchDxf(s);
    expect(dxf).toMatchObject({ shapes: 1, open: 0, note: "" });
    expect(dxf.text).toContain("$INSUNITS\r\n 70\r\n4");
    expect(dxf.text.endsWith("  0\r\nEOF\r\n")).toBe(true);
    const ents = entities(dxf.text);
    expect(ents.map((e) => e.type)).toEqual(["POLYLINE", "VERTEX", "VERTEX", "VERTEX", "VERTEX", "SEQEND"]);
    expect(get(ents[0]!.values, 70)).toEqual([1]);
    const corners = ents.filter((e) => e.type === "VERTEX").map((e) => `${get(e.values, 10)[0]},${get(e.values, 20)[0]}`);
    expect(new Set(corners)).toEqual(new Set(["0,0", "40,0", "40,20", "0,20"]));
  });

  it("writes a whole circle as a CIRCLE", () => {
    const s = drawCircle(newSketch(), [5, 6], 3).sketch;
    const ents = entities(sketchDxf(s).text);
    expect(ents).toHaveLength(1);
    expect(ents[0]!.type).toBe("CIRCLE");
    expect([get(ents[0]!.values, 10)[0], get(ents[0]!.values, 20)[0], get(ents[0]!.values, 40)[0]]).toEqual([5, 6, 3]);
  });

  it("keeps a slot's round ends exact as bulges", () => {
    const s = drawSlot(newSketch(), [0, 0], [30, 0], 10)!.sketch;
    const dxf = sketchDxf(s);
    expect(dxf.shapes).toBe(1);
    const verts = entities(dxf.text).filter((e) => e.type === "VERTEX");
    expect(verts).toHaveLength(4);
    // Two half circles: bulge ±1 (tan of 180° / 4).
    const bulges = verts.flatMap((v) => get(v.values, 42));
    expect(bulges.map((b) => Math.abs(b))).toEqual([1, 1]);
    // Both bulge the same way, out of the outline.
    expect(Math.sign(bulges[0]!)).toBe(Math.sign(bulges[1]!));
  });

  it("writes a hole inside an outline as a second closed shape", () => {
    let s: Sketch = drawRectangle(newSketch(), [0, 0], [40, 40]).sketch;
    s = drawCircle(s, [20, 20], 5).sketch;
    const dxf = sketchDxf(s);
    expect(dxf.shapes).toBe(2);
    expect(
      entities(dxf.text)
        .map((e) => e.type)
        .filter((t) => t !== "VERTEX"),
    ).toEqual(["POLYLINE", "SEQEND", "CIRCLE"]);
  });

  it("traces an ellipse as a closed polyline", () => {
    const s = drawEllipse(newSketch(), [0, 0], [10, 0], [0, 5])!.sketch;
    const dxf = sketchDxf(s);
    expect(dxf.shapes).toBe(1);
    const ents = entities(dxf.text);
    expect(ents[0]!.type).toBe("POLYLINE");
    expect(ents.filter((e) => e.type === "VERTEX").length).toBeGreaterThan(30);
    // The ellipse's axes are construction lines, left out.
    expect(ents.some((e) => e.type === "LINE")).toBe(false);
  });

  it("puts curves that don't close a shape on the OPEN layer", () => {
    let s = drawLine(newSketch(), [0, 0], [10, 0]).sketch;
    s = drawArcCentre(s, [20, 0], [25, 0], [20, 5]).sketch;
    const dxf = sketchDxf(s);
    expect(dxf).toMatchObject({ shapes: 0, open: 2, note: ". 2 curves don't close a shape, so a cutter treats them as lines." });
    const ents = entities(dxf.text);
    expect(ents.map((e) => e.type)).toEqual(["LINE", "ARC"]);
    expect(ents.every((e) => e.values.some(([c, v]) => c === 8 && v === "OPEN"))).toBe(true);
    expect([get(ents[1]!.values, 50)[0], get(ents[1]!.values, 51)[0]]).toEqual([0, 90]);
  });

  it("leaves construction lines out", () => {
    const s = drawLine(newSketch(), [0, 0], [10, 0], { construction: true }).sketch;
    expect(sketchDxf(s)).toMatchObject({ shapes: 0, open: 0 });
    expect(entities(sketchDxf(s).text)).toEqual([]);
  });
});
