/** What the simulator gives back (#761): its vectors by name, and any errors it reported. */
export interface SpiceAnswer {
  vectors: { name: string; values: number[] }[];
  errors: string[];
}

/** The part of eecircuit-engine's Simulation a run needs, so a test can run the real one in Node. */
export interface SpiceEngine {
  start(): Promise<void>;
  setNetList(text: string): void;
  runSim(): Promise<{ dataType: "real" | "complex"; data: { name: string; values: unknown[] }[] }>;
  getError(): string[];
}

/** Runs one deck on a started engine. A transient run's vectors are real numbers. */
export async function runDeck(sim: SpiceEngine, text: string): Promise<SpiceAnswer> {
  sim.setNetList(text);
  const result = await sim.runSim();
  const errors = sim.getError().filter((e) => e.trim());
  if (result.dataType !== "real") return { vectors: [], errors: [...errors, "The simulator gave back no voltages"] };
  return { vectors: result.data.map((v) => ({ name: v.name, values: v.values as number[] })), errors };
}
