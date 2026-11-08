import { Solver } from "@bettercad/sketch";

let solverLoad: Promise<Solver> | null = null;

/** The planegcs solver, loaded once on first use. Sketch editing and parameter changes (#75) share it. */
export function loadSolver(): Promise<Solver> {
  solverLoad ??= import("@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm?url").then((m) => Solver.load(m.default));
  return solverLoad;
}
