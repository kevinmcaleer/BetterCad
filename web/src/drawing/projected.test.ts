import { describe, expect, it } from "vitest";
import { newSheet, removeView, viewScale, type DrawingSheet, type DrawingView } from "@bettercad/kernel/drawing";
import {
  descendants,
  flipAngle,
  followParent,
  frameFrom,
  moveWithChildren,
  placeProjected,
  projectedDirection,
  relationOf,
  sideAt,
  slides,
  spotAt,
  spotBeside,
} from "./projected";
import { editView, viewName } from "./views";

const front: DrawingView = { id: "f", kind: "base", shows: { all: true }, direction: "front", hidden: true, tangent: false, at: [100, 100] };
const sheet = (standard: "iso" | "asme", views: DrawingView[] = [front]): DrawingSheet => ({ ...newSheet("Sheet 1", { size: "A3", standard }), views });
const angle = (s: DrawingSheet) => (s.standard === "iso" ? "first" : "third");
/** Front, with a view above it and one to its right, as each standard lays them out. */
function three(standard: "iso" | "asme") {
  let s = sheet(standard);
  s = placeProjected(s, "a", "f", [0, 1], angle(s), [130, 160]);
  s = placeProjected(s, "r", "f", [1, 0], angle(s), [180, 90]);
  return s;
}
const by = (s: DrawingSheet, id: string) => s.views.find((v) => v.id === id)!;

describe("which view a side gives", () => {
  it("third angle shows what you see from that side: top above, right on the right", () => {
    expect(projectedDirection("front", [0, 1], "third")).toBe("top");
    expect(projectedDirection("front", [0, -1], "third")).toBe("bottom");
    expect(projectedDirection("front", [1, 0], "third")).toBe("right");
    expect(projectedDirection("front", [-1, 0], "third")).toBe("left");
  });

  it("first angle shows the far side: top below, left on the right", () => {
    expect(projectedDirection("front", [0, -1], "first")).toBe("top");
    expect(projectedDirection("front", [0, 1], "first")).toBe("bottom");
    expect(projectedDirection("front", [1, 0], "first")).toBe("left");
    expect(projectedDirection("front", [-1, 0], "first")).toBe("right");
  });

  it("a diagonal is the isometric over that corner, in both", () => {
    expect(projectedDirection("front", [1, 1], "third")).toBe("iso");
    expect(projectedDirection("front", [1, 1], "first")).toBe("iso");
    expect(projectedDirection("front", [-1, 1], "third")).toEqual({ toEye: [-1, -1, 1], up: [0, 0, 1] });
    expect(projectedDirection("front", [1, -1], "third")).toEqual({ toEye: [1, -1, -1], up: [0, 0, 1] });
  });

  it("works from any view, and names what it finds", () => {
    // Beside a top view, third angle: the model from its right, turned so the top view's up stays up.
    const d = projectedDirection("top", [1, 0], "third");
    expect(d).toEqual({ toEye: [1, 0, 0], up: [0, 1, 0] });
    expect(viewName({ direction: d })).toBe("Right view");
    expect(projectedDirection("right", [1, 0], "third")).toBe("back");
    expect(relationOf("front", "top")).toEqual([0, 1]);
    expect(relationOf("front", "back")).toBeUndefined();
    expect(frameFrom({ toEye: [0, -1, 0], up: [0, 0, 1] }, [0, 1])).toEqual({ toEye: [0, 0, 1], up: [0, 1, 0] });
  });

  it("the pointer's side: straight within 30°, diagonal between", () => {
    expect(sideAt([50, 10])).toEqual([1, 0]);
    expect(sideAt([-50, -10])).toEqual([-1, 0]);
    expect(sideAt([5, -40])).toEqual([0, -1]);
    expect(sideAt([-40, 40])).toEqual([-1, 1]);
  });
});

describe("where projected views sit", () => {
  it.each(["asme", "iso"] as const)("front, top and right land in the right places (%s)", (standard) => {
    const s = three(standard);
    const top = s.views.find((v) => v.direction === "top")!;
    const right = s.views.find((v) => v.direction === "right")!;
    if (standard === "asme") {
      expect(top.id).toBe("a");
      expect(right.id).toBe("r");
    } else {
      // First angle: what went above is the view from below, and the right view belongs on the left.
      expect(by(s, "a").direction).toBe("bottom");
      expect(by(s, "r").direction).toBe("left");
      expect(top).toBeUndefined();
      expect(right).toBeUndefined();
    }
    // Lined up with the front view whichever they are.
    expect(by(s, "a").at).toEqual([100, 160]);
    expect(by(s, "r").at).toEqual([180, 100]);
    expect(by(s, "a")).toMatchObject({ kind: "projected", parent: "f", shows: { all: true }, hidden: true });
    expect(slides(s, by(s, "a"))).toBe("y");
    expect(slides(s, by(s, "r"))).toBe("x");
  });

  it("first angle puts the top view below the front and the right view on its left", () => {
    let s = sheet("iso");
    s = placeProjected(s, "t", "f", [0, -1], "first", [100, 40]);
    s = placeProjected(s, "r", "f", [-1, 0], "first", [30, 100]);
    expect(by(s, "t").direction).toBe("top");
    expect(by(s, "r").direction).toBe("right");
  });

  it("an orthographic view slides one way only; an isometric moves freely", () => {
    let s = three("asme");
    s = placeProjected(s, "i", "f", [1, 1], "third", [190, 170]);
    expect(moveWithChildren(s, "a", [150, 200]).views.find((v) => v.id === "a")!.at).toEqual([100, 200]);
    expect(moveWithChildren(s, "r", [150, 200]).views.find((v) => v.id === "r")!.at).toEqual([150, 100]);
    expect(moveWithChildren(s, "i", [150, 200]).views.find((v) => v.id === "i")!.at).toEqual([150, 200]);
    expect(slides(s, by(s, "i"))).toBeUndefined();
  });

  it("moving the parent carries its views, and theirs", () => {
    let s = three("asme");
    s = placeProjected(s, "b", "r", [1, 0], "third", [250, 0]);
    expect(descendants(s, "f").map((v) => v.id)).toEqual(["a", "r", "b"]);
    const moved = moveWithChildren(s, "f", [110, 80]);
    expect(moved.views.map((v) => v.at)).toEqual([
      [110, 80],
      [110, 140],
      [190, 80],
      [260, 80],
    ]);
    // Moving a child along its line carries only its own.
    expect(moveWithChildren(s, "r", [200, 300]).views.map((v) => v.at[0])).toEqual([100, 100, 200, 270]);
  });

  it("puts a view from the keyboard just clear of its parent, and by the pointer in line with it", () => {
    expect(spotBeside({ at: [100, 100], w: 40, h: 20 }, { w: 10, h: 20 }, [1, 0])).toEqual([140, 100]);
    expect(spotBeside({ at: [100, 100], w: 40, h: 20 }, { w: 10, h: 20 }, [0, -1])).toEqual([100, 65]);
    expect(spotAt([100, 100], [170, 104], [1, 0])).toEqual([170, 100]);
    expect(spotAt([100, 100], [103, 30], [0, -1])).toEqual([100, 30]);
    expect(spotAt([100, 100], [170, 160], [1, 1])).toEqual([170, 160]);
  });

  it("switching the standard swaps each orthographic view to the other side of its parent", () => {
    let s = three("asme");
    s = placeProjected(s, "i", "f", [1, 1], "third", [190, 170]);
    s = placeProjected(s, "b", "r", [1, 0], "third", [250, 0]);
    const f = flipAngle(s);
    expect(by(f, "a").at).toEqual([100, 40]);
    expect(by(f, "r").at).toEqual([20, 100]);
    // The back view, off the right view, ends up further left still; the isometric stays put.
    expect(by(f, "b").at).toEqual([-50, 100]);
    expect(by(f, "i").at).toEqual([190, 170]);
    expect(by(f, "a").direction).toBe("top");
  });
});

describe("projected views follow their parent", () => {
  it("take its scale until given their own", () => {
    let s = three("asme");
    s = editView(s, "f", { shows: { all: true }, direction: "front", hidden: true, tangent: false }, 2);
    expect(s.scale).toBe(2);
    expect(viewScale(s, by(s, "a"))).toBe(2);
    s = editView(s, "a", { shows: { all: true }, direction: "top", hidden: true, tangent: false }, 5);
    expect(by(s, "a").scale).toBe(5);
    // Back to its parent's: nothing of its own is kept.
    s = editView(s, "a", { shows: { all: true }, direction: "top", hidden: true, tangent: false }, 2);
    expect(by(s, "a").scale).toBeUndefined();
  });

  it("show what it shows, from the same side of its new direction, in its line style unless they have their own", () => {
    let s = three("asme");
    s = { ...s, views: s.views.map((v) => (v.id === "r" ? { ...v, hidden: false } : v)) };
    s = editView(s, "f", { shows: { bodies: ["b2"] }, direction: "right", hidden: false, tangent: true }, 1);
    expect(by(s, "a")).toMatchObject({ shows: { bodies: ["b2"] }, hidden: false, tangent: true });
    expect(viewName(by(s, "a"))).toBe("Top view");
    expect(by(s, "r")).toMatchObject({ direction: "back", hidden: false, tangent: true });
    expect(followParent(s, by(s, "f"))).toEqual(s);
  });

  it("deleting a parent keeps them as base views at the scale they had", () => {
    let s = three("asme");
    s = { ...s, views: s.views.map((v) => (v.id === "f" ? { ...v, scale: 2 } : v)) };
    const left = removeView(s, "f");
    expect(left.views.map((v) => [v.id, v.kind, v.parent, v.scale])).toEqual([
      ["a", "base", undefined, 2],
      ["r", "base", undefined, 2],
    ]);
  });
});
