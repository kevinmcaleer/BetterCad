import { describe, expect, it } from "vitest";
import { drawCircle, drawLine, newSketch } from "@bettercad/sketch";
import { pickLabel } from "./SketchUI";
import { ORIGIN } from "./snap";

describe("pickLabel", () => {
  it("names each item with its size, so lines on top of each other can be told apart", () => {
    const a = drawLine(newSketch(), [0, 0], [40, 0]);
    const b = drawLine(a.sketch, [10, 0], [30, 0], { construction: true });
    const c = drawCircle(b.sketch, [0, 0], 5);
    const s = c.sketch;
    const kind = (k: string, ids: string[]) => ids.find((id) => s.entities.find((e) => e.id === id)?.kind === k)!;
    expect(pickLabel(s, kind("line", a.ids))).toBe("Line 40 mm");
    expect(pickLabel(s, kind("line", b.ids))).toBe("Construction line 20 mm");
    expect(pickLabel(s, kind("circle", c.ids))).toBe("Circle ⌀ 10 mm");
    const line = s.entities.find((e) => e.id === kind("line", a.ids));
    expect(pickLabel(s, line?.kind === "line" ? line.a : "")).toBe("End point");
    expect(pickLabel(s, ORIGIN)).toBe("Origin");
  });
});
