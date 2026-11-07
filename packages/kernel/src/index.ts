/**
 * The modelling kernel. OpenCascade (epic #4) will run in a Web Worker behind this package; until it lands, the
 * placeholder primitives are tessellated here in the same BodyMesh shape the worker will hand the viewport.
 */
export * from "./mesh";
export * from "./primitives";

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
