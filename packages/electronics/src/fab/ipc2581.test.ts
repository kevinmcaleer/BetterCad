import { describe, expect, it } from "vitest";
import { boardPads } from "../board";
import { netlist } from "../nets";
import { sampleBoard } from "../sample";
import { setStack } from "../pcb/stack";
import { holesOf } from "./drill";
import { gerberFiles } from "./gerber";
import { ipc2581 } from "./ipc2581";
import { readGerber } from "./read";

const NS = "http://webstds.ipc.org/2581";
const parse = (xml: string) => {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  expect(doc.getElementsByTagName("parsererror")).toHaveLength(0);
  return doc;
};
const all = (doc: Document, tag: string) => [...doc.getElementsByTagNameNS(NS, tag)];
const attr = (e: Element, a: string) => e.getAttribute(a) ?? "";

describe("IPC-2581 (#662)", () => {
  const d = sampleBoard();
  const xml = ipc2581(d, "Pico servo", new Date("2026-11-25T10:00:00Z"))!;
  const doc = parse(xml);

  it("is well formed revision C, with its sections in the order the standard lists them", () => {
    const root = doc.documentElement;
    expect(root.localName).toBe("IPC-2581");
    expect(attr(root, "revision")).toBe("C");
    expect([...root.children].map((e) => e.localName)).toEqual(["Content", "LogisticHeader", "HistoryRecord", "Bom", "Ecad"]);
    expect(attr(all(doc, "HistoryRecord")[0]!, "origination")).toBe("2026-11-25T10:00:00");
  });

  it("refers only to things it defines: shapes, line widths, layers, packages, parts and pins", () => {
    const defined = (tag: string, a = "id") => new Set(all(doc, tag).map((e) => attr(e, a)));
    const shapes = defined("EntryStandard");
    const lines = defined("EntryLineDesc");
    const layers = defined("Layer", "name");
    const packages = defined("Package", "name");
    const components = defined("Component", "refDes");
    expect(all(doc, "StandardPrimitiveRef").every((e) => shapes.has(attr(e, "id")))).toBe(true);
    expect(all(doc, "LineDescRef").every((e) => lines.has(attr(e, "id")))).toBe(true);
    for (const tag of ["LayerRef", "LayerFeature"]) for (const e of all(doc, tag)) expect(layers).toContain(attr(e, tag === "LayerRef" ? "name" : "layerRef"));
    for (const e of all(doc, "Component")) expect(packages).toContain(attr(e, "packageRef"));
    for (const e of all(doc, "PinRef")) expect(components).toContain(attr(e, "componentRef"));
    for (const e of all(doc, "StackupLayer")) expect(layers).toContain(attr(e, "layerOrGroupRef"));
  });

  it("carries every part, net, hole and the parts list", () => {
    const placed = d.board!.placements.length;
    expect(all(doc, "Component")).toHaveLength(placed);
    const nets = new Set(
      boardPads(d)
        .map((p) => p.net)
        .filter(Boolean),
    );
    expect(
      all(doc, "LogicalNet")
        .map((e) => attr(e, "name"))
        .sort(),
    ).toEqual([...nets].sort());
    expect(all(doc, "Hole")).toHaveLength(holesOf(d).length);
    expect(all(doc, "RefDes")).toHaveLength(d.parts.filter((p) => d.board!.placements.some((x) => x.part === p.id)).length);
    expect(all(doc, "Profile")[0]!.getElementsByTagNameNS(NS, "PolyStepSegment").length).toBeGreaterThan(3);
  });

  it("draws each layer as the Gerber writer does: the same objects, on the same nets", () => {
    const top = gerberFiles(d, netlist(d)).find((f) => f.layer === "copper-top")!;
    const ops = readGerber(top.text).ops;
    const feature = all(doc, "LayerFeature").find((e) => attr(e, "layerRef") === "TOP")!;
    const sets = [...feature.getElementsByTagNameNS(NS, "Set")];
    const drawn = sets.flatMap((s) => [...s.getElementsByTagNameNS(NS, "Features")[0]!.children]);
    const expected = ops.reduce((k, o) => k + (o.kind === "flash" && o.ap.kind === "macro" ? o.ap.prims.length : 1), 0);
    expect(drawn).toHaveLength(expected);
    // Pours take copper away again: those runs are negative.
    expect(sets.some((s) => attr(s, "polarity") === "NEGATIVE")).toBe(d.board!.pours.length > 0);
    const gnd = sets.filter((s) => attr(s, "net") === "GND");
    expect(gnd.length).toBeGreaterThan(0);
  });

  it("lists inner layers, the stack and blind vias' own drill layers on a four layer board", () => {
    const four = parse(ipc2581(setStack(d, "4"), "four")!);
    const names = all(four, "Layer").map((e) => `${attr(e, "name")} ${attr(e, "layerFunction")} ${attr(e, "side")}`);
    expect(names).toEqual(
      expect.arrayContaining(["TOP CONDUCTOR TOP", "IN1 CONDUCTOR INTERNAL", "IN2 CONDUCTOR INTERNAL", "BOTTOM CONDUCTOR BOTTOM", "DRILL_1_4 DRILL ALL"]),
    );
    const stack = all(four, "StackupLayer").map((e) => Number(attr(e, "thickness")));
    expect(stack).toHaveLength(7);
    expect(stack.reduce((a, b) => a + b, 0)).toBeCloseTo(d.board!.thickness, 3);
  });
});
