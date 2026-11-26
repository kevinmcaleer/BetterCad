import { describe, expect, it } from "vitest";
import { BASICS, emptyDesign, placePart, pushToBoard, type ElectronicsDesign } from "../index";
import { netRules } from "./copper";
import { addNetClass, changeNetClass, classOf, netFacts, newClassName, setNetClass, setNetWidth } from "./netclass";
import { addTrack, addVia, setTrackWidth } from "./route";

/** A board with two GND tracks, one VCC track and a GND via, all at the board's own sizes. */
function board(): ElectronicsDesign {
  const a = placePart(emptyDesign(), "sh1", BASICS.resistor!(), { x: 0, y: 0 });
  let d = pushToBoard(a.design).design;
  d = addTrack(d, "GND", "top", [
    [0, 0],
    [10, 0],
  ]);
  d = addTrack(d, "GND", "bottom", [
    [10, 0],
    [10, 5],
  ]);
  d = addTrack(d, "VCC", "top", [
    [0, 10],
    [3, 10],
  ]);
  return addVia(d, "GND", 10, 0);
}

describe("net classes from the inspector", () => {
  it("puts a net in a new class and its copper takes the class's sizes", () => {
    const d = board();
    const rule = d.board!.rules.trackWidth;
    const { design, id } = addNetClass(d, "GND");
    const k = classOf(design.board!, "GND")!;
    expect(k).toMatchObject({ id, name: "Power", nets: ["GND"] });
    expect(design.board!.tracks.filter((t) => t.net === "GND").every((t) => t.width === k.trackWidth)).toBe(true);
    expect(design.board!.tracks.find((t) => t.net === "VCC")!.width).toBe(rule);
    expect(newClassName(design.board!)).toBe("Class 2");
  });

  it("moves a net between classes and back out, keeping hand-sized tracks", () => {
    let d = addNetClass(board()).design;
    const power = d.board!.classes[0]!.id;
    d = addNetClass(d, undefined, "Signal").design;
    const signal = d.board!.classes[1]!.id;
    d = changeNetClass(d, signal, { trackWidth: 0.2 });
    const hand = d.board!.tracks.find((t) => t.net === "GND" && t.layer === "bottom")!.id;
    d = setTrackWidth(d, [hand], 1.2);
    d = setNetClass(d, "GND", power);
    expect(d.board!.tracks.find((t) => t.id === hand)!.width).toBe(1.2);
    expect(d.board!.tracks.find((t) => t.net === "GND" && t.layer === "top")!.width).toBe(0.5);
    d = setNetClass(d, "GND", signal);
    expect(d.board!.classes.map((c) => c.nets)).toEqual([[], ["GND"]]);
    expect(d.board!.tracks.find((t) => t.net === "GND" && t.layer === "top")!.width).toBe(0.2);
    d = setNetClass(d, "GND", null);
    expect(classOf(d.board!, "GND")).toBeUndefined();
    expect(netRules(d.board!, "GND").trackWidth).toBe(d.board!.rules.trackWidth);
  });

  it("changes a class's width and its tracks follow", () => {
    let d = addNetClass(board(), "GND").design;
    const id = d.board!.classes[0]!.id;
    d = changeNetClass(d, id, { trackWidth: 0.8, clearance: 0.3 });
    expect(d.board!.tracks.filter((t) => t.net === "GND").map((t) => t.width)).toEqual([0.8, 0.8]);
    expect(netRules(d.board!, "GND").clearance).toBe(0.3);
    expect(changeNetClass(d, id, { trackWidth: 0 })).toBe(d);
    expect(changeNetClass(d, id, { name: " " })).toBe(d);
  });

  it("sets every track on a net to one width and tells what is on it", () => {
    const d = setNetWidth(board(), "GND", 0.4);
    expect(d.board!.tracks.filter((t) => t.net === "GND").map((t) => t.width)).toEqual([0.4, 0.4]);
    expect(setNetWidth(d, "GND", 0.4)).toBe(d);
    expect(netFacts(d.board!, "GND", ["top", "bottom"])).toEqual({ tracks: 2, vias: 1, length: 15, layers: ["top", "bottom"], widths: [0.4] });
  });
});
