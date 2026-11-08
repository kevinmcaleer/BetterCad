/**
 * Sketching (epic #5): the sketch model, 2D geometry, closed-profile finding, the drawing tools' records and the
 * planegcs solver. Framework-free, so it runs in Node for the golden tests.
 */
export * from "./model";
export * from "./geom2d";
export * from "./profiles";
export * from "./measure";
export * from "./draw";
export * from "./dof";
export * from "./edit";
export * from "./text";
// The solver loads on its own, from "@bettercad/sketch/solver", so planegcs stays out of the app's first paint.
export type { Solver, SolveResult, SolveStatusName } from "./solver";

export interface SolverStatus {
  ready: boolean;
  engine: "planegcs";
}

export function solverStatus(): SolverStatus {
  return { ready: false, engine: "planegcs" };
}
