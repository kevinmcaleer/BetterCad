import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { PerfOverlay, graphPoints } from "./PerfOverlay";

const frame = { ms: 4.2, fps: 60, triangles: 12000, calls: 9, bodies: 3, history: [4, 8, 40], idPasses: 2 };

describe("performance overlay (#42)", () => {
  it("shows the frame, its draw calls and ID passes", () => {
    const { container } = render(<PerfOverlay frame={frame} />);
    expect(container.textContent).toMatch(/4\.2 ms · 60 fps · 12,000 triangles · 9 draws · 2 ID passes · 3 bodies/);
  });

  it("graphs each frame, capping slow ones at the top", () => {
    expect(graphPoints([0, 16.7, 100])).toBe("0,28.0 1,14.0 2,0.0");
  });

  it("lists the last build's slowest steps and the cache", () => {
    const kernel = {
      ms: 120,
      made: 2,
      timings: [
        { feature: "a", ms: 1, cached: true },
        { feature: "b", ms: 80, cached: false },
        { feature: "c", ms: 30, cached: false },
      ],
      cache: { bodies: 4, steps: 10, bytes: 3 * 1024 * 1024 },
      nameOf: (id: string) => ({ a: "Sketch 1", b: "Extrude 1", c: "Fillet 1" })[id] ?? id,
    };
    const { container } = render(<PerfOverlay frame={frame} kernel={kernel} />);
    const text = container.textContent!;
    expect(text).toMatch(/Build 120 ms · 2 made · cache 4 bodies, 10 steps, 3\.0 MB/);
    expect(text.indexOf("Extrude 1 80.0 ms")).toBeLessThan(text.indexOf("Fillet 1 30.0 ms"));
    expect(text).toContain("Sketch 1 1.0 ms (cached)");
  });
});
