// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { buildUrdf, urdfName, type UrdfBody } from "./urdf";
import type { JointFeature } from "../document";

const joint = (j: Partial<JointFeature> & Pick<JointFeature, "id" | "child">): JointFeature => ({
  type: "joint",
  name: j.id,
  kind: "revolute",
  parent: null,
  origin: [0, 0, 0],
  axis: [0, 0, 1],
  lower: -90,
  upper: 90,
  ...j,
});

// One triangle with a corner at `p`, mm.
const tri = (p: [number, number, number]) => new Float32Array([...p, p[0] + 1, p[1], p[2], p[0], p[1] + 1, p[2]]);

const parse = (s: string) => new DOMParser().parseFromString(s, "application/xml");

describe("URDF export (#175)", () => {
  // A base plate, an arm on a hinge at (0, 0, 20) mm, and a gripper sliding along X at the arm's tip, (100, 0, 20).
  const bodies: UrdfBody[] = [
    { id: "b", name: "Plate", triangles: tri([0, 0, 0]), colour: "#ff0000", mass: { mass: 200, com: [0, 0, 5], inertia: [1e6, 1e6, 2e6, 0, 0, 0] } },
    { id: "a", name: "Arm", link: "l1", triangles: tri([10, 0, 20]), mass: { mass: 50, com: [50, 0, 20], inertia: [1000, 2000, 3000, -10, 0, 0] } },
    { id: "g", name: "Finger", link: "l2", triangles: tri([100, 0, 20]) },
  ];
  const links = [
    { id: "l1", name: "Arm" },
    { id: "l2", name: "Gripper" },
    { id: "l3", name: "Loose" },
  ];
  const joints = [
    joint({ id: "j1", name: "Shoulder", child: "l1", origin: [0, 0, 20], axis: [0, 2, 0], lower: 45, upper: -30 }),
    joint({ id: "j2", name: "Grip", kind: "prismatic", child: "l2", parent: "l1", origin: [100, 0, 20], axis: [1, 0, 0], lower: 0, upper: 25 }),
  ];
  const out = buildUrdf(bodies, links, joints, { name: "My arm" });
  const xml = parse(out.urdf);
  const joint1 = (name: string) => xml.querySelector(`joint[name="${name}"]`)!;

  it("writes well-formed XML with a link per link step and a tree of joints", () => {
    expect(xml.querySelector("parsererror")).toBeNull();
    expect(xml.documentElement.getAttribute("name")).toBe("My_arm");
    expect([...xml.querySelectorAll("link")].map((l) => l.getAttribute("name"))).toEqual(["base_link", "Arm", "Gripper", "Loose"]);
    const tree = [...xml.querySelectorAll("joint")].map((j) => [
      j.getAttribute("name"),
      j.getAttribute("type"),
      j.querySelector("parent")!.getAttribute("link"),
      j.querySelector("child")!.getAttribute("link"),
    ]);
    expect(tree).toEqual([
      ["Shoulder", "revolute", "base_link", "Arm"],
      ["Grip", "prismatic", "Arm", "Gripper"],
      ["Loose_fixed", "fixed", "base_link", "Loose"],
    ]);
  });

  it("puts each joint where it sits relative to its parent's, in metres, with a unit axis", () => {
    expect(joint1("Shoulder").querySelector("origin")!.getAttribute("xyz")).toBe("0 0 0.02");
    expect(joint1("Grip").querySelector("origin")!.getAttribute("xyz")).toBe("0.1 0 0");
    expect(joint1("Shoulder").querySelector("axis")!.getAttribute("xyz")).toBe("0 1 0");
    expect(joint1("Loose_fixed").querySelector("axis")).toBeNull();
  });

  it("gives limits in radians and metres, low to high, with effort and velocity", () => {
    const hinge = joint1("Shoulder").querySelector("limit")!;
    expect(Number(hinge.getAttribute("lower"))).toBeCloseTo((-30 * Math.PI) / 180, 8);
    expect(Number(hinge.getAttribute("upper"))).toBeCloseTo((45 * Math.PI) / 180, 8);
    expect(hinge.getAttribute("effort")).toBe("10");
    expect(joint1("Grip").querySelector("limit")!.getAttribute("upper")).toBe("0.025");
  });

  it("gives a wheel no limits but its effort and velocity", () => {
    const wheel = buildUrdf(bodies, links.slice(0, 1), [joint({ id: "w", child: "l1", kind: "continuous" })], { name: "Car", effort: 2, velocity: 6 });
    const limit = parse(wheel.urdf).querySelector("joint limit")!;
    expect(limit.getAttribute("lower")).toBeNull();
    expect([limit.getAttribute("effort"), limit.getAttribute("velocity")]).toEqual(["2", "6"]);
  });

  it("writes mass in kg, the centre of mass from the link's frame and inertia in kg·m²", () => {
    const arm = xml.querySelector('link[name="Arm"] inertial')!;
    expect(arm.querySelector("mass")!.getAttribute("value")).toBe("0.05");
    expect(arm.querySelector("origin")!.getAttribute("xyz")).toBe("0.05 0 0");
    const i = arm.querySelector("inertia")!;
    expect(Number(i.getAttribute("izz"))).toBe(3e-6);
    // Products keep their sign, and tiny values keep their figures.
    expect(Number(i.getAttribute("ixy"))).toBe(-1e-8);
    const tiny = buildUrdf([{ ...bodies[1]!, mass: { mass: 1, com: [0, 0, 0], inertia: [123.456, 1, 1, 0, 0, 0] } }], links.slice(0, 1), joints.slice(0, 1), {
      name: "t",
    });
    expect(Number(parse(tiny.urdf).querySelector("inertia")!.getAttribute("ixx"))).toBe(1.23456e-7);
    // A link with no mass has no inertial, which simulators treat as weightless.
    expect(xml.querySelector('link[name="Gripper"] inertial')).toBeNull();
  });

  it("moves each link's mesh into its frame, in metres, and names its file", () => {
    const grip = out.links.find((l) => l.name === "Gripper")!;
    expect(grip.mesh).toBe("meshes/Gripper.stl");
    expect([...grip.triangles.slice(0, 3)].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([0, 0, 0]);
    const arm = out.links.find((l) => l.name === "Arm")!;
    expect(arm.triangles[0]).toBeCloseTo(0.01, 6);
    expect(xml.querySelector('link[name="Arm"] visual mesh')!.getAttribute("filename")).toBe("meshes/Arm.stl");
    expect(xml.querySelector('link[name="base_link"] color')!.getAttribute("rgba")).toBe("1 0 0 1");
    // A link with no bodies has no mesh.
    expect(out.links.map((l) => l.name)).toEqual(["base_link", "Arm", "Gripper"]);
  });

  it("uses package paths for a ROS package", () => {
    const ros = buildUrdf(bodies, links, joints, { name: "My arm", rosPackage: true });
    expect(parse(ros.urdf).querySelector('link[name="Arm"] collision mesh')!.getAttribute("filename")).toBe("package://My_arm/meshes/Arm.stl");
  });

  it("needs a joint", () => {
    expect(() => buildUrdf(bodies, links, [], { name: "x" })).toThrow("Add a joint first to export a robot.");
  });

  it("makes names URDF accepts, and keeps them unique", () => {
    const taken = new Set<string>(["base_link"]);
    expect(urdfName("Left arm (2)", taken)).toBe("Left_arm_2");
    expect(urdfName("Left arm 2", taken)).toBe("Left_arm_2_2");
    expect(urdfName("3rd", taken)).toBe("_3rd");
    expect(urdfName("  ", taken)).toBe("part");
    expect(urdfName("base link", taken)).toBe("base_link_2");
  });
});
