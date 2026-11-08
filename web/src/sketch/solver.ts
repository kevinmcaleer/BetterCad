import type { Solver } from "@bettercad/sketch";

let solverLoad: Promise<Solver> | null = null;

/** The planegcs solver, loaded once on first use. Sketch editing and parameter changes (#75) share it. */
export function loadSolver(): Promise<Solver> {
  // The solver and its planegcs glue load with the WASM, keeping them out of the first paint.
  solverLoad ??= Promise.all([import("@bettercad/sketch/solver"), import("@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm?url")]).then(([s, m]) =>
    s.Solver.load(m.default),
  );
  return solverLoad;
}
