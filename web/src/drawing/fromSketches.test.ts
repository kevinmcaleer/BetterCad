import { describe, expect, it, vi } from "vitest";
import { sketchView } from "@bettercad/kernel/sketch-view";
import type { Sketch } from "@bettercad/sketch";
import { newDoc, type ModelDoc } from "../state/document";
import { dimArt } from "./dimensions";
import { contextOf } from "./arrange";
import { makeFromSketches, sketchDrawings, sketchSizes, type ListedSketch } from "./fromSketches";
import type { ViewCall } from "./useModelViews";

/** A 40 × 20 plate with a 10 mm hole 12 mm in, each size as a sketch would give it. */
function plate(id: string, name: string, plane: Sketch["plane"] = { kind: "world", plane: "XZ", offset: 0 }): Sketch {
  const dim = (did: string, kind: Sketch["dimensions"][number]["kind"], refs: string[], value: number, more = {}) => ({
    id: did,
    kind,
    refs,
    expression: String(value),
    value,
    driving: true,
    labelOffset: [0, 0] as [number, number],
    ...more,
  });
  return {
    id,
    name,
    plane,
    entities: [
      { id: "p1", kind: "point", x: 0, y: 0 },
      { id: "p2", kind: "point", x: 40, y: 0 },
      { id: "p3", kind: "point", x: 40, y: 20 },
      { id: "p4", kind: "point", x: 0, y: 20 },
      { id: "h", kind: "point", x: 12, y: 10 },
      { id: "l1", kind: "line", a: "p1", b: "p2" },
      { id: "l2", kind: "line", a: "p2", b: "p3" },
      { id: "l3", kind: "line", a: "p3", b: "p4" },
      { id: "l4", kind: "line", a: "p4", b: "p1" },
      { id: "hole", kind: "circle", c: "h", r: 5 },
    ],
    constraints: [],
    dimensions: [
      dim("d1", "length", ["l1"], 40),
      dim("d2", "distanceY", ["p1", "p4"], 20),
      dim("d3", "diameter", ["hole"], 10),
      dim("d4", "distanceX", ["l4", "hole"], 12),
      // Left out: a size to a circle's edge, a pattern's count, a turned-off size.
      dim("d5", "distance", ["p1", "hole"], 8, { edges: true }),
      dim("d6", "pattern", ["pat"], 3, { role: "count" }),
      dim("d7", "length", ["l3"], 40, { suppressed: true }),
    ],
  };
}

// The kernel's answer, worked out here as the worker would.
const listed = (s: Sketch): ListedSketch => ({ id: s.id, name: s.name, sketch: s });
const sketches: ListedSketch[] = [listed(plate("s1", "Base plate")), listed(plate("s2", "Lid", { kind: "world", plane: "XY", offset: 10 }))];
const call = vi.fn<ViewCall>((p) => {
  const id = "sketch" in p.shows ? p.shows.sketch : "";
  return Promise.resolve(sketchView(sketches.find((s) => s.id === id)?.sketch, p.frame, id));
});
let n = 0;
const newId = (kind: string) => `${kind}${++n}`;

describe("Drawing from sketches", () => {
  it("turns the sketch's own sizes into drawing dimensions on its curves", () => {
    const s = sketches[0]!.sketch;
    const v = sketchView(s, { toEye: [0, -1, 0], up: [0, 0, 1] }, s.id);
    const dims = sketchSizes(s, "vw", v, () => "dm");
    expect(dims.map((d) => [d.kind, d.refs.map((r) => `${r.name}${r.at ? `@${r.at}` : ""}`).join(" "), d.across])).toEqual([
      ["linear", "l1", "aligned"],
      ["linear", "p:p1@start p:p4@start", "y"],
      ["diameter", "hole", undefined],
      ["linear", "l4 hole@centre", "x"],
    ]);
  });

  it("makes one drawing with a page for each sketch, face on, with its sizes reading what the sketch says", async () => {
    const doc = { ...newDoc(), name: "Robot" };
    const r = await sketchDrawings(doc, sketches, call, undefined, { author: "Kev", newId });
    expect(r.made).toEqual(["Base plate", "Lid"]);
    expect(r.doc.drawings!.map((d) => d.name)).toEqual(["Sketches"]);
    const [base, lid] = r.doc.drawings![0]!.sheets;
    expect(base!.title).toMatchObject({ title: "Base plate", author: "Kev", type: "Sketch" });
    expect(base!.views).toHaveLength(1);
    const view = base!.views[0]!;
    expect(view.shows).toEqual({ sketch: "s1" });
    // Face on: the XZ plane is seen from the front, the XY plane from the top.
    expect(view.direction).toEqual({ toEye: [0, -1, 0], up: [0, 0, 1] });
    expect(lid!.views[0]!.direction).toEqual({ toEye: [0, 0, 1], up: [0, 1, 0] });
    // Each size reads the sketch's value.
    const model = await call({ doc, shows: view.shows, frame: { toEye: [0, -1, 0], up: [0, 0, 1] } })!;
    const ctx = contextOf(base!, view.id, model, 2)!;
    expect(base!.dimensions.map((d) => dimArt(d, ctx)?.text.text)).toEqual(["40", "20", "Ø10", "12"]);
    // Set out round the sketch, clear of it.
    const half = [(40 * base!.scale) / 2, (20 * base!.scale) / 2];
    const level = base!.dimensions.find((d) => d.refs[0]!.name === "l1")!;
    expect(Math.abs(level.at[1])).toBeGreaterThan(half[1]!);
    // Run again: nothing new.
    const again = await sketchDrawings(r.doc, sketches, call, undefined, { newId });
    expect([again.made, again.had]).toEqual([[], 2]);
    expect(again.doc).toBe(r.doc);
  });

  it("as the editor runs it: one step in Undo, opens the drawing, says how it went, and skips sketches with nothing in them", async () => {
    let doc: ModelDoc = { ...newDoc(), name: "Robot" };
    const edits: string[] = [];
    const store = {
      get: () => doc,
      edit: (change: (d: ModelDoc) => ModelDoc, label: string) => {
        doc = change(doc);
        edits.push(label);
      },
    };
    const said: string[] = [];
    const empty: ListedSketch = { id: "s3", name: "Empty", sketch: { ...plate("s3", "Empty"), entities: [], dimensions: [] } };
    const opened = await makeFromSketches(store, [...sketches, empty], call, undefined, (t) => said.push(t));
    expect(edits).toEqual(["Drawing from sketches"]);
    expect(opened).toBe(doc.drawings![0]!.id);
    expect(doc.drawings![0]!.sheets.map((s) => s.name)).toEqual(["Base plate", "Lid"]);
    expect(said).toEqual(["Making a drawing from your sketches.", "Added 2 pages to Sketches, one for each sketch."]);
    await makeFromSketches(store, sketches, call, undefined, (t) => said.push(t));
    expect(said.at(-1)).toBe("Every sketch already has a page.");
    await makeFromSketches(store, [], call, undefined, (t) => said.push(t));
    expect(said.at(-1)).toBe("There are no sketches to draw yet.");
    expect(edits).toHaveLength(1);
  });
});
