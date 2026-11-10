// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  GEAR_DEFAULTS,
  addDrive,
  addGear,
  addJoint,
  addLink,
  addMatingGear,
  addRack,
  build,
  featureSummary,
  newDoc,
  resolvePose,
  setPose,
  updateDrive,
  type GearParamsStep,
  type JointParams,
  type ModelDoc,
} from "./document";
import { driveRatioText, driveTo, togetherMultiplier, type PoseDrive } from "./drivelinks";
import { buildUrdf } from "./export/urdf";
import type { PoseJoint } from "./pose";

const flat = { origin: [0, 0, 0] as [number, number, number], x: [1, 0, 0] as [number, number, number], normal: [0, 0, 1] as [number, number, number] };
const step = (change: Partial<GearParamsStep> = {}): GearParamsStep => ({
  gear: GEAR_DEFAULTS,
  width: 4,
  bore: { kind: "none", diameter: 0 },
  frame: flat,
  ...change,
});
const hinge = (child: string, origin: [number, number, number], change: Partial<JointParams> = {}): JointParams => ({
  kind: "continuous",
  child,
  parent: null,
  origin,
  axis: [0, 0, 1],
  lower: 0,
  upper: 0,
  ...change,
});

/** Two gears, each its own link on a wheel about Z through its centre, and a drive from the first to the second. */
function pair(a: number, b: number, kind: "gear" | "belt" = "gear"): ModelDoc {
  let d = newDoc("Pair");
  if (kind === "gear") {
    d = addGear(d, step({ gear: { ...GEAR_DEFAULTS, teeth: a } }), "ga", "A");
    d = addMatingGear(d, "ga", b, 0, "gb", "B");
  } else {
    d = addGear(d, step({ form: "gt2", gear: { ...GEAR_DEFAULTS, teeth: a } }), "ga", "A");
    d = addGear(d, step({ form: "gt2", gear: { ...GEAR_DEFAULTS, teeth: b }, belt: { pulley: "ga", angle: 0, length: 200 } }), "gb", "B");
  }
  d = addLink(d, ["A"], "la");
  d = addLink(d, ["B"], "lb");
  const at = build(d).parts.find((p) => p.id === "B")!.prism!.frame.origin;
  d = addJoint(d, hinge("la", [0, 0, 0]), "ja");
  d = addJoint(d, hinge("lb", at), "jb");
  return addDrive(d, { kind, driver: "ja", driven: "jb", ratio: 1 }, "d1");
}

describe("drive links (#194)", () => {
  it("turns a 36-tooth gear −1/3 for a 12-tooth one, from the teeth", () => {
    const b = build(pair(12, 36));
    expect(b.failed.size).toBe(0);
    const [d] = b.drives;
    expect(d!.fromTeeth).toBe(true);
    expect(d!.multiplier).toBeCloseTo(-1 / 3, 9);
    expect(resolvePose(b.drives, { ja: 90 })!.jb).toBeCloseTo(-30, 9);
    expect(driveRatioText(d!.multiplier, "continuous", "continuous")).toBe("-0.333×, the other way");
  });

  it("keeps the direction on a belt", () => {
    const b = build(pair(20, 40, "belt"));
    expect(b.failed.size).toBe(0);
    expect(b.drives[0]!.multiplier).toBeCloseTo(0.5, 9);
  });

  it("slides a rack of module 1 on a 20-tooth gear 62.83 mm a turn", () => {
    let d = addGear(newDoc("Rack"), step(), "g", "G");
    d = addRack(d, "g", -90, "r", "R");
    d = addLink(d, ["G"], "lg");
    d = addLink(d, ["R"], "lr");
    d = addJoint(d, hinge("lg", [0, 0, 0]), "jg");
    d = addJoint(d, { kind: "prismatic", child: "lr", parent: null, origin: [0, 0, 0], axis: [1, 0, 0], lower: -100, upper: 100 }, "jr");
    d = addDrive(d, { kind: "rack", driver: "jg", driven: "jr", ratio: 1 }, "d1");
    const b = build(d);
    expect(b.failed.size).toBe(0);
    expect(b.drives[0]!.multiplier * 360).toBeCloseTo(62.83, 2);
    expect(driveRatioText(b.drives[0]!.multiplier, "continuous", "prismatic")).toBe("Slides 62.832 mm a turn");
  });

  it("uses the typed ratio for a custom drive, or when the gears aren't there, and reverses", () => {
    let d = updateDrive(pair(12, 36), "d1", { kind: "custom", ratio: 2 });
    expect(build(d).drives[0]).toMatchObject({ multiplier: 2, fromTeeth: false });
    d = updateDrive(d, "d1", { reverse: true });
    expect(build(d).drives[0]!.multiplier).toBe(-2);
    // Gears asked for, but the links have pulleys: the typed ratio stands.
    d = updateDrive(pair(20, 40, "belt"), "d1", { kind: "gear", ratio: 3 });
    expect(build(d).drives[0]).toMatchObject({ multiplier: 3, fromTeeth: false });
    expect(build(updateDrive(d, "d1", { ratio: 0 })).failed.get("d1")).toBe("Give it a ratio other than 0");
  });

  it("refuses a joint driving itself, one driven twice and a loop", () => {
    let d = pair(12, 36);
    d = addDrive(d, { kind: "custom", driver: "ja", driven: "jb", ratio: 1 }, "d2");
    d = addDrive(d, { kind: "custom", driver: "jb", driven: "ja", ratio: 1 }, "d3");
    d = addDrive(d, { kind: "custom", driver: "ja", driven: "ja", ratio: 1 }, "d4");
    const b = build(d);
    expect(b.failed.get("d2")).toBe("That joint is already driven");
    expect(b.failed.get("d3")).toBe("Those drives would go round in a loop");
    expect(b.failed.get("d4")).toBe("A joint can't drive itself");
    expect(b.drives.map((x) => x.id)).toEqual(["d1"]);
  });

  it("moves the driver when the driven joint is moved, and keeps only the driver in the pose", () => {
    let d = setPose(pair(12, 36), "jb", 30);
    expect(d.pose).toEqual({ ja: -90 });
    d = setPose(d, "ja", 0);
    expect(d.pose).toBeUndefined();
  });

  it("stops both at either side's limits", () => {
    const joints: PoseJoint[] = [
      { id: "a", kind: "revolute", child: "la", parent: null, origin: [0, 0, 0], axis: [0, 0, 1], lower: -90, upper: 90 },
      { id: "b", kind: "revolute", child: "lb", parent: null, origin: [0, 0, 0], axis: [0, 0, 1], lower: -45, upper: 45 },
    ];
    const drives: PoseDrive[] = [{ id: "d", driver: "a", driven: "b", multiplier: -1, offset: 0 }];
    // The driven side stops first.
    expect(driveTo(joints, drives, {}, "a", 80)).toEqual({ id: "a", value: 45 });
    expect(driveTo(joints, drives, {}, "b", 20)).toEqual({ id: "a", value: -20 });
    // Halved, the driver's own limit stops first.
    const half = [{ ...drives[0]!, multiplier: 0.25 }];
    expect(driveTo(joints, half, {}, "b", 40)).toEqual({ id: "a", value: 90 });
  });

  it("takes a wheel the short way round, so the joints it drives don't jump at 180°", () => {
    const joints: PoseJoint[] = ["a", "b"].map((id) => ({
      id,
      kind: "continuous",
      child: `l${id}`,
      parent: null,
      origin: [0, 0, 0],
      axis: [0, 0, 1],
      lower: 0,
      upper: 0,
    }));
    const drives: PoseDrive[] = [{ id: "d", driver: "a", driven: "b", multiplier: 1 / 3, offset: 0 }];
    // At 170°, a move to -170° (the joint's wrapped value) is 20° further on, not 340° back.
    expect(driveTo(joints, drives, { a: 170 }, "a", -170).value).toBeCloseTo(190, 9);
  });

  it("writes the driven joint as a mimic in the URDF, in radians and metres", () => {
    const tri = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const links = [
      { id: "la", name: "Gear" },
      { id: "lr", name: "Rack" },
    ];
    const joints = [
      {
        type: "joint" as const,
        id: "jg",
        name: "Pinion",
        kind: "continuous" as const,
        child: "la",
        parent: null,
        origin: [0, 0, 0] as [number, number, number],
        axis: [0, 0, 1] as [number, number, number],
        lower: 0,
        upper: 0,
      },
      {
        type: "joint" as const,
        id: "jr",
        name: "Slide",
        kind: "prismatic" as const,
        child: "lr",
        parent: null,
        origin: [0, 0, 0] as [number, number, number],
        axis: [1, 0, 0] as [number, number, number],
        lower: -100,
        upper: 100,
      },
    ];
    const bodies = [
      { id: "g", name: "G", link: "la", triangles: tri },
      { id: "r", name: "R", link: "lr", triangles: tri },
    ];
    // 62.83 mm a turn is 0.01 m a radian (m·z/2 with module 1 and 20 teeth).
    const drives = [{ id: "d", driver: "jg", driven: "jr", multiplier: (Math.PI * 20) / 360, offset: 0 }];
    const xml = new DOMParser().parseFromString(buildUrdf(bodies, links, joints, { name: "r", drives }).urdf, "application/xml");
    const mimic = xml.querySelector('joint[name="Slide"] mimic')!;
    expect(mimic.getAttribute("joint")).toBe("Pinion");
    expect(Number(mimic.getAttribute("multiplier"))).toBeCloseTo(0.01, 9);
    expect(mimic.getAttribute("offset")).toBe("0");
    expect(xml.querySelector('joint[name="Pinion"] mimic')).toBeNull();
  });
});

/** Four wheels on a rover, two each side: the left ones turn about +Y, the right ones about −Y, all on the base. */
function rover(): ModelDoc {
  let d = newDoc("Rover");
  const at: [number, number, number][] = [
    [0, 40, 0],
    [60, 40, 0],
    [0, -40, 0],
    [60, -40, 0],
  ];
  at.forEach((o, i) => {
    d = addGear(d, step({ frame: { ...flat, origin: o } }), `g${i}`, `W${i}`);
    d = addLink(d, [`W${i}`], `l${i}`);
    d = addJoint(d, hinge(`l${i}`, o, { axis: [0, i < 2 ? 1 : -1, 0] }), `j${i}`);
  });
  return d;
}

describe("motion links", () => {
  it("turns every wheel with the lead, the far side the other way round its own axis so the rover rolls straight", () => {
    const d = addDrive(rover(), { kind: "together", driver: "j0", driven: "j1", more: ["j2", "j3"], ratio: 1 }, "m1");
    const b = build(d);
    expect(b.failed.size).toBe(0);
    expect(d.features.find((f) => f.id === "m1")!.name).toBe("Motion link 1");
    expect(b.drives.map((x) => [x.driven, x.multiplier])).toEqual([
      ["j1", 1],
      ["j2", -1],
      ["j3", -1],
    ]);
    expect(resolvePose(b.drives, { j0: 30 })).toEqual({ j0: 30, j1: 30, j2: -30, j3: -30 });
    // Moving a follower moves the lead, so every wheel stays in step.
    expect(setPose(d, "j3", 45).pose).toEqual({ j0: -45 });
    expect(
      featureSummary(
        d,
        d.features.find((f) => f.id === "m1")!,
      ),
    ).toBe("Joint 1 moves Joint 2, Joint 3 and Joint 4 with it");
  });

  it("turns a joint ticked Other way back, and drops the followers from the pose", () => {
    let d = setPose(setPose(rover(), "j1", 20), "j2", 10);
    d = addDrive(d, { kind: "together", driver: "j0", driven: "j1", more: ["j2"], against: ["j2"], ratio: 1 }, "m1");
    expect(d.pose).toBeUndefined();
    expect(build(d).drives.find((x) => x.driven === "j2")!.multiplier).toBe(1);
    expect(togetherMultiplier({ axis: [0, 0, 1] }, { axis: [0, 0, 1] }, true)).toBe(-1);
  });

  it("leaves out a deleted joint, and fails when one is already driven or slides", () => {
    let d = addDrive(rover(), { kind: "together", driver: "j0", driven: "j1", more: ["gone"], ratio: 1 }, "m1");
    expect(build(d).drives.map((x) => x.driven)).toEqual(["j1"]);
    d = addDrive(d, { kind: "together", driver: "j2", driven: "j1", ratio: 1 }, "m2");
    expect(build(d).failed.get("m2")).toBe("That joint is already driven");
    let s = addGear(rover(), step(), "gs", "S");
    s = addLink(s, ["S"], "ls");
    s = addJoint(s, { kind: "prismatic", child: "ls", parent: null, origin: [0, 0, 0], axis: [1, 0, 0], lower: 0, upper: 10 }, "js");
    s = addDrive(s, { kind: "together", driver: "j0", driven: "js", ratio: 1 }, "m1");
    expect(build(s).failed.get("m1")).toBe("A joint that turns can't move with one that slides");
  });

  it("writes every follower as a mimic of the lead in the URDF", () => {
    const b = build(addDrive(rover(), { kind: "together", driver: "j0", driven: "j1", more: ["j2"], ratio: 1 }, "m1"));
    const tri = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const bodies = b.parts.map((p) => ({ id: p.id, name: p.name, link: p.link, triangles: tri }));
    const xml = new DOMParser().parseFromString(buildUrdf(bodies, b.links, b.joints, { name: "r", drives: b.drives }).urdf, "application/xml");
    expect(xml.querySelector('joint[name="Joint_2"] mimic')!.getAttribute("joint")).toBe("Joint_1");
    expect(xml.querySelector('joint[name="Joint_3"] mimic')!.getAttribute("multiplier")).toBe("-1");
    expect(xml.querySelector('joint[name="Joint_1"] mimic')).toBeNull();
  });
});
