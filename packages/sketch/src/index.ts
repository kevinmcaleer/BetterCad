/** Placeholder for the planegcs sketch solver (epic #5). */
export interface SolverStatus {
  ready: boolean;
  engine: "planegcs";
}

export function solverStatus(): SolverStatus {
  return { ready: false, engine: "planegcs" };
}
