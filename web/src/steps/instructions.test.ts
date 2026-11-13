import { describe, expect, it } from "vitest";
import { newSketch, type Sketch } from "@bettercad/sketch";
import { newDoc, type Feature, type ModelDoc } from "../state/document";
import { buildSteps, dimensionText, imageName, stepsMarkdown } from "./instructions";

function rectSketch(): Sketch {
  const s = newSketch({ kind: "world", plane: "XY", offset: 0 }, "Base sketch", "s1");
  const pts = [
    ["a", 0, 0],
    ["b", 40, 0],
    ["c", 40, 20],
    ["d", 0, 20],
  ] as const;
  for (const [id, x, y] of pts) s.entities.push({ id, kind: "point", x, y });
  s.entities.push(
    { id: "l1", kind: "line", a: "a", b: "b" },
    { id: "l2", kind: "line", a: "b", b: "c" },
    { id: "l3", kind: "line", a: "c", b: "d" },
    { id: "l4", kind: "line", a: "d", b: "a" },
  );
  s.constraints.push({ id: "k1", kind: "horizontal", refs: ["l1"] } as unknown as Sketch["constraints"][number]);
  s.dimensions.push(
    { id: "d1", kind: "length", refs: ["l1"], expression: "width", value: 40, driving: true, labelOffset: [0, -5] },
    { id: "d2", kind: "length", refs: ["l2"], expression: "20", value: 20, driving: true, labelOffset: [5, 0] },
  );
  return s;
}

function model(): ModelDoc {
  const doc = newDoc("Servo bracket");
  const features: Feature[] = [
    { id: "f1", type: "sketch", name: "Base sketch", sketch: rectSketch() },
    {
      id: "f2",
      type: "extrude",
      name: "Base",
      sketch: "f1",
      seeds: [[1, 1]],
      distance: 4,
      direction: "one",
      operation: "new",
      body: { id: "b1", name: "Bracket" },
      exprs: { distance: "thick" },
    } as Feature,
    { id: "f3", type: "fillet", name: "Round", part: "b1", refs: [1, 2], size: 2, suppressed: true },
    { id: "f4", type: "chamfer", name: "Bevel", part: "b1", refs: [3], size: 1 },
  ];
  return {
    ...doc,
    features,
    params: [
      { id: "p1", name: "width", expression: "40", unit: "mm", comment: "Across the servo" },
      { id: "p2", name: "thick", expression: "2 * 3", unit: "mm" },
    ],
  };
}

describe("build steps", () => {
  it("numbers the steps, skipping suppressed ones, with where each sits on the timeline", () => {
    const steps = buildSteps(model());
    expect(steps.map((s) => [s.n, s.at, s.title])).toEqual([
      [1, 1, "Base sketch"],
      [2, 2, "Base"],
      [3, 4, "Bevel"],
    ]);
  });

  it("says what a sketch draws, its constraints and its sizes", () => {
    const [sketch] = buildSteps(model());
    expect(sketch!.text).toBe("Start a sketch on the XY plane and draw 4 lines. Hold it with 1 constraint.");
    expect(sketch!.details).toEqual(["Length 40 mm (`width`)", "Length 20 mm"]);
  });

  it("gives a step's values as built from its expressions, and the expressions typed into it", () => {
    const steps = buildSteps(model());
    expect(steps[1]!.text).toBe("Extrude **Base sketch**: 6 mm, new body.");
    expect(steps[1]!.details).toEqual(["Distance: `thick`"]);
    expect(steps[2]!.text).toBe("Chamfer: 1 mm, 1 edge of Bracket.");
  });

  it("stops at the marker", () => {
    expect(buildSteps(model(), 1)).toHaveLength(1);
  });

  it("labels angles in degrees and driven sizes as for reference", () => {
    expect(dimensionText({ id: "a", kind: "angle", refs: [], expression: "30", value: 30, driving: true, labelOffset: [0, 0] })).toBe("Angle 30°");
    expect(dimensionText({ id: "r", kind: "radius", refs: [], expression: "", value: 2.456, driving: false, labelOffset: [0, 0] })).toBe(
      "Radius 2.46 mm, for reference",
    );
  });

  it("pads picture names so they sort", () => {
    expect(imageName(3, 12)).toBe("step-03.png");
    expect(imageName(7, 120)).toBe("step-007.png");
    expect(imageName(3, 12, "-sketch")).toBe("step-03-sketch.png");
  });

  it("writes Markdown with the parameters, each step's picture and what failed", () => {
    const doc = model();
    const steps = buildSteps(doc);
    const md = stepsMarkdown(doc, steps, {
      modelFile: "Servo bracket.bcad",
      images: new Map(steps.map((s) => [s.n, `images/${imageName(s.n, steps.length)}`])),
      diagrams: new Map([[1, "images/step-01-sketch.png"]]),
      finished: "images/finished.png",
      failed: new Map([["f4", "The edge is gone."]]),
    });
    expect(md).toContain('title: "Servo bracket"');
    expect(md).toContain("# How to build Servo bracket");
    expect(md).toContain("3 steps in BetterCad. Sizes are in millimetres. Open [Servo bracket.bcad](Servo%20bracket.bcad) in BetterCad to change it.");
    expect(md).toContain("| `width` | 40 mm | Across the servo |");
    expect(md).toContain("## Step 2: Base\n\n![Step 2: Base](images/step-02.png)\n\nExtrude **Base sketch**: 6 mm, new body.\n\n- Distance: `thick`");
    expect(md).toContain("| `thick` | `2 * 3`, 6 mm |  |");
    expect(md).toContain("> This step didn't build: The edge is gone.");
    expect(md).toContain("![Step 1: Base sketch](images/step-01.png)\n\n![Step 1: Base sketch, face on with its sizes](images/step-01-sketch.png)");
    expect(md).toContain("![Servo bracket, finished](images/finished.png)");
    expect(md).not.toContain("Parts to print");
  });

  it("lists the parts to print, one file per shape, with how many", () => {
    const doc = model();
    const md = stepsMarkdown(doc, buildSteps(doc), { prints: [{ name: "Track", file: "models/Rover-Track.stl", count: 32 }] });
    expect(md).toContain("## Parts to print\n\n| Part | How many | File |\n| --- | --- | --- |\n| Track | 32 | [Rover-Track.stl](models/Rover-Track.stl) |");
  });
});
