/**
 * The modelling kernel. OpenCascade (epic #4) runs in a Web Worker behind `./browser`; the app talks to it through
 * KernelClient. The JS primitives stay as the first frame's meshes while the WASM loads.
 */
export * from "./mesh";
export * from "./primitives";
export * from "./errors";
export * from "./client";
export type { Methods, Method, Request, Response } from "./protocol";
export type { ModelResult, BuiltBody, ImportInfo, BodyMass, StepTiming } from "./occt/model";
export * from "./imports";
export * from "./catalogue";
export * from "./looks";
export type { Measure } from "./occt/shapes";
export type { MeasureResult, Single, Pair, TopoRef } from "./occt/measure";
export type { Mate } from "./occt/mates";
export type { Clash } from "./occt/clashes";
export type { SweepRange, SweepPair, SweepLimit, SweepResult } from "./sweep";
export type { Quality } from "./occt/tessellate";
export type { ExportFormat, ExportRequest, ExportEstimate, ExportResult } from "./occt/exporter";
export { DEFLECTION, type Resolution } from "./occt/deflection";

export interface KernelStatus {
  ready: boolean;
  engine: "opencascade.js";
}

export function kernelStatus(): KernelStatus {
  return { ready: false, engine: "opencascade.js" };
}

/** Instantiates a WASM module from bytes: a fetch() in the browser, a file read in Node tests. */
export async function instantiateWasm<T extends WebAssembly.Exports>(bytes: BufferSource, imports: WebAssembly.Imports = {}): Promise<T> {
  const { instance } = await WebAssembly.instantiate(bytes, imports);
  return instance.exports as T;
}
