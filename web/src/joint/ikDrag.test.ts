import { describe, expect, it, vi } from "vitest";
import { ikGizmoDrag } from "./ikDrag";
import { toolPoint, type IkProblem } from "../state/ik";
import type { PoseJoint } from "../state/document";

// One hinge about Z at the origin, the tool 50 mm out along X.
const hinge: PoseJoint = { id: "h", kind: "revolute", child: "arm", parent: null, origin: [0, 0, 0], axis: [0, 0, 1], lower: -180, upper: 180 };
const problem: IkProblem = { joints: [hinge], link: "arm", point: [50, 0, 0] };
const hooks = () => ({ show: vi.fn(), commit: vi.fn(), revert: vi.fn() });

describe("the gizmo drag on a tool point (#176)", () => {
  it("swings the arm to where the gizmo is, and commits a rounded pose", () => {
    const h = hooks();
    const drag = ikGizmoDrag(problem, {}, h);
    drag.move([0, 50, 0]);
    expect(h.show).toHaveBeenCalled();
    drag.end();
    const [pose, miss] = h.commit.mock.calls[0]!;
    expect(pose.h).toBeCloseTo(90, 2);
    expect(miss).toBeLessThan(0.01);
    expect(toolPoint(problem, pose)[1]).toBeCloseTo(50, 2);
  });

  it("says how far out of reach it ended", () => {
    const h = hooks();
    const drag = ikGizmoDrag(problem, {}, h);
    drag.move([80, 0, 0]);
    drag.end();
    expect(h.commit.mock.calls[0]![1]).toBeCloseTo(30, 1);
  });

  it("puts the arm back when called off, and ignores the release after", () => {
    const h = hooks();
    const drag = ikGizmoDrag(problem, {}, h);
    drag.move([0, 50, 0]);
    drag.cancel();
    drag.end();
    expect(h.revert).toHaveBeenCalledWith(true);
    expect(h.commit).not.toHaveBeenCalled();
  });

  it("changes nothing when released without moving", () => {
    const h = hooks();
    ikGizmoDrag(problem, {}, h).end();
    expect(h.revert).toHaveBeenCalledWith(false);
  });
});
