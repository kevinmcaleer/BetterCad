/** Placeholder for the OpenCascade kernel worker (epic #4). */
export interface KernelStatus {
  ready: boolean;
  engine: "opencascade.js";
}

export function kernelStatus(): KernelStatus {
  return { ready: false, engine: "opencascade.js" };
}
