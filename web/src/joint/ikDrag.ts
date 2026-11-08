/**
 * Dragging an arm by its tool point (#176), loaded once a tool point is wanted so the solver and the drag stay out of
 * first paint. The drag itself is plain: told where the pointer goes, it solves and hands back poses.
 */
import { lockJoint, setToolPoint, type Pose, type V3 } from "../state/document";
import { homeOf, solveIk, toolPoint, type IkProblem } from "../state/ik";

export { homeOf, lockJoint, setToolPoint };

export interface IkView {
  project(p: V3): { x: number; y: number };
  ray(x: number, y: number): { origin: V3; dir: V3 };
}

export interface IkDragHooks {
  /** A new pose while dragging. */
  show(pose: Pose): void;
  /** The drag ended where it moved to; miss is how far short of the pointer the tool point stopped, mm. */
  commit(pose: Pose, miss: number): void;
  /** The drag ended without moving, or was called off. */
  revert(cancelled: boolean): void;
}

/** A drag that keeps the tool point under the pointer, at the screen offset it was grabbed with. */
export function ikDrag(problem: IkProblem, start: Pose, view: IkView, at: { x: number; y: number }, hooks: IkDragHooks) {
  const shown = view.project(toolPoint(problem, start));
  const offset = { x: shown.x - at.x, y: shown.y - at.y };
  let now: Pose = { ...start };
  let miss = 0;
  let moved = false;
  let done = false;
  return {
    move(p: { x: number; y: number }) {
      if (done) return;
      const r = view.ray(p.x + offset.x, p.y + offset.y);
      // Aim at the point on the pointer's ray nearest the tool point, a few times over, so the arm settles where it
      // comes closest to the ray (through it, when it can reach).
      for (let k = 0; k < 4; k++) {
        const tip = toolPoint(problem, now);
        const t = (tip[0] - r.origin[0]) * r.dir[0] + (tip[1] - r.origin[1]) * r.dir[1] + (tip[2] - r.origin[2]) * r.dir[2];
        const target: V3 = [r.origin[0] + r.dir[0] * t, r.origin[1] + r.dir[1] * t, r.origin[2] + r.dir[2] * t];
        const step = solveIk(problem, now, target, 10);
        now = step.pose;
        miss = step.miss;
      }
      moved = true;
      hooks.show(now);
    },
    end() {
      if (done) return;
      done = true;
      if (!moved) return hooks.revert(false);
      const kept: Pose = {};
      for (const [id, v] of Object.entries(now)) if (Math.abs(v) > 1e-9) kept[id] = Math.round(v * 1000) / 1000;
      hooks.commit(kept, miss);
    },
    cancel() {
      if (done) return;
      done = true;
      hooks.revert(true);
    },
  };
}
