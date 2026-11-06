/**
 * The OpenCascade kernel (epic #4) will live here, in a Web Worker. For now this package holds the status stub the
 * app imports and the WASM loading helper the kernel and its tests will share.
 */
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
