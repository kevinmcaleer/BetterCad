import { describe, expect, it } from "vitest";
import type { ElectronicsDesign } from "../model";
import { sampleBoard } from "../sample";
import { checkBoard } from "./drc";
import { MATCH_TOLERANCE, groupOf, matchLengths, pairSkew, unmatch } from "./match";
import { netLength, tuneLength } from "./shove";

const BUS = ["MOTOR_A1", "MOTOR_A2", "MOTOR_B2"];
const drift = (d: ElectronicsDesign) => checkBoard(d).filter((r) => r.rule === "length-match");

describe("length matching (#745)", () => {
  it("tunes each net to the longest, within the tolerance, and keeps them as a group", () => {
    const d = sampleBoard();
    const longest = Math.max(...BUS.map((n) => netLength(d, n)));
    const out = matchLengths(d, BUS);
    expect(out.target).toBeCloseTo(longest, 2);
    for (const r of out.results) {
      expect(r.why, r.net).toBeUndefined();
      expect(longest - netLength(out.design, r.net)).toBeLessThanOrEqual(MATCH_TOLERANCE + 1e-6);
    }
    expect(groupOf(out.design, "MOTOR_A1")).toMatchObject({ nets: BUS, tolerance: MATCH_TOLERANCE });
    // The wiggles keep their clearance, so the check finds nothing new.
    expect(checkBoard(out.design).map((r) => r.text)).toEqual(checkBoard(d).map((r) => r.text));
  });

  it("warns when a matched group drifts, and stops once it is taken apart", () => {
    const d = matchLengths(sampleBoard(), BUS).design;
    expect(drift(d)).toEqual([]);
    const longer = d.board!.tracks.find((t) => t.net === "MOTOR_A2")!;
    const out = tuneLength(d, longer.id, netLength(d, "MOTOR_A2") + 2);
    if (!("design" in out)) throw new Error(out.why);
    const found = drift(out.design);
    expect(found).toHaveLength(1);
    expect(found[0]!.text).toMatch(/shorter than MOTOR_A2\. They are matched to within 0\.1 mm\./);
    expect(drift(unmatch(out.design, "MOTOR_A1"))).toEqual([]);
    expect(unmatch(out.design, "MOTOR_A1").board!.matched).toBeUndefined();
  });

  it("moves a net from its old group when it is matched again", () => {
    const d = matchLengths(matchLengths(sampleBoard(), BUS).design, ["MOTOR_A1", "SERVO1"], 0.5).design;
    expect(groupOf(d, "MOTOR_A1")!.nets).toEqual(["MOTOR_A1", "SERVO1"]);
    expect(groupOf(d, "MOTOR_A2")!.nets).toEqual(["MOTOR_A2", "MOTOR_B2"]);
  });

  it("shows a pair's skew and matches it", () => {
    const base = sampleBoard();
    const name: Record<string, string> = { SERVO2: "LINK_P", MOTOR_B1: "LINK_N" };
    const d: ElectronicsDesign = { ...base, board: { ...base.board!, tracks: base.board!.tracks.map((t) => ({ ...t, net: name[t.net] ?? t.net })) } };
    const nets = ["LINK_P", "LINK_N", "5V"];
    const before = pairSkew(d, "LINK_P", nets)!;
    expect(before.mate).toBe("LINK_N");
    expect(before.skew).toBeGreaterThan(0.5);
    expect(pairSkew(d, "5V", nets)).toBeNull();
    // Matched on the real nets, whose copper the check knows, the pair's skew is gone.
    const out = matchLengths(base, ["SERVO2", "MOTOR_B1"]);
    expect(out.results.filter((r) => r.why)).toEqual([]);
    expect(Math.abs(netLength(out.design, "SERVO2") - netLength(out.design, "MOTOR_B1"))).toBeLessThanOrEqual(MATCH_TOLERANCE);
  });

  it("says why a net cannot be matched", () => {
    const out = matchLengths(sampleBoard(), ["MOTOR_A1", "NOWHERE"]);
    expect(out.results.find((r) => r.net === "NOWHERE")).toMatchObject({ length: 0 });
    const back = matchLengths(sampleBoard(), ["5V", "LED"]);
    expect(back.results.find((r) => r.net === "LED")!.why).toBeTruthy();
  });
});
