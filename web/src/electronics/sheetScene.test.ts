import { describe, expect, it } from "vitest";
import { BASICS, addLabel, addNoConnect, addWire, emptyDesign, placePart } from "@bettercad/electronics";
import { sceneSvg } from "../drawing/export/svg";
import { schematicScene } from "./sheetScene";

function circuit() {
  let d = emptyDesign();
  d = placePart(d, "sh1", BASICS.resistor!(), { x: -25.4, y: 0 }).design;
  d = placePart(d, "sh1", BASICS.led!(), { x: 0, y: 0, rot: 90 }).design;
  d = placePart(d, "sh1", BASICS.gnd!(), { x: 0, y: -10.16 }).design;
  d = addWire(d, "sh1", [-25.4, 3.81], [0, 3.81]);
  d = addLabel(d, "sh1", "LED_A", -12.7, 3.81);
  return addNoConnect(d, "sh1", -25.4, -3.81);
}

describe("a schematic on paper", () => {
  const d = circuit();
  const scene = schematicScene(d, d.sheets[0]!, { size: "A4", title: { title: "Blinky", author: "Ada", date: "2026-11-24" } });

  it("is a sheet at its true size with the title block filled in", () => {
    expect([scene.w, scene.h]).toEqual([297, 210]);
    const words = scene.labels.map((l) => l.text);
    expect(words).toEqual(expect.arrayContaining(["Blinky", "Ada", "Schematic", "2:1"]));
  });

  it("draws the parts' names and values, the net label and the wires inside the frame", () => {
    const words = scene.labels.filter((l) => l.layer === "visible").map((l) => l.text);
    expect(words).toEqual(expect.arrayContaining(["R1", "D1", "LED_A", "GND", BASICS.resistor!().value]));
    const lines = scene.strokes.filter((s) => s.layer === "visible");
    expect(lines.length).toBeGreaterThan(10);
    for (const s of lines) {
      const pts = s.curve.kind === "line" ? [s.curve.a, s.curve.b] : s.curve.kind === "poly" ? s.curve.pts : [s.curve.c];
      for (const p of pts) {
        expect(p[0]).toBeGreaterThan(10);
        expect(p[0]).toBeLessThan(287);
        expect(p[1]).toBeGreaterThan(10);
        expect(p[1]).toBeLessThan(200);
      }
    }
  });

  it("steps the scale down when the diagram is bigger than the page", () => {
    let big = d;
    big = placePart(big, "sh1", BASICS.resistor!(), { x: 400, y: 300 }).design;
    const small = schematicScene(big, big.sheets[0]!, { size: "A4", title: {} });
    expect(small.labels.map((l) => l.text)).toContain("1:4");
  });

  it("writes an SVG whose text is still text", () => {
    const svg = sceneSvg(scene);
    expect(svg).toContain('width="297mm" height="210mm"');
    expect(svg).toMatch(/<text class="visible"[^>]*>LED_A<\/text>/);
    expect(svg).toMatch(/<text class="visible"[^>]*>R1<\/text>/);
  });
});
