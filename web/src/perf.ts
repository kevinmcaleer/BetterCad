/**
 * Load-time marks (#97): "shell" when the 3D view can first be orbited and "kernel" when the geometry engine reports
 * ready, each measured from the start of navigation. They show in the dev frame overlay and in DevTools' Performance
 * panel, and docs/performance.md records them per device.
 */
export type Milestone = "shell" | "kernel";

const seen = new Map<Milestone, number>();

/** Records a milestone once, as a performance mark and measure. Returns its time in ms from navigation start. */
export function milestone(name: Milestone): number {
  const had = seen.get(name);
  if (had !== undefined) return had;
  const at = typeof performance === "undefined" ? 0 : performance.now();
  seen.set(name, at);
  try {
    performance.mark(`bc:${name}`);
    performance.measure(`bc:${name}`, { start: 0, end: at });
  } catch {
    // Older browsers without measure options still get the mark.
  }
  return at;
}

/** How the geometry engine's load split (#50): fetching the WASM, then compiling and starting it, in ms. */
let kernelLoad: { download?: number; start?: number } | null = null;

/** Records the engine's load once, and logs it once a session. */
export function recordKernelLoad(load: { download?: number; start?: number } | undefined, total: number): void {
  if (kernelLoad || !load) return;
  kernelLoad = load;
  const s = (ms?: number) => (ms === undefined ? "cached" : `${(ms / 1000).toFixed(1)} s`);
  console.info(`Geometry engine ready in ${(total / 1000).toFixed(1)} s: download ${s(load.download)}, compile and start ${s(load.start)}`);
}

/** The milestones reached so far, in ms. */
export const milestones = (): Partial<Record<Milestone, number>> => Object.fromEntries(seen);

/** "shell 0.8 s · kernel 3.1 s", for the overlay. */
export function formatMilestones(m = milestones(), load = kernelLoad): string {
  const s = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
  const parts = (["shell", "kernel"] as const).filter((k) => m[k] !== undefined).map((k) => `${k} ${s(m[k]!)}`);
  if (load?.download !== undefined) parts.push(`wasm download ${s(load.download)}`);
  if (load?.start !== undefined) parts.push(`wasm start ${s(load.start)}`);
  return parts.join(" · ");
}

/** Forgets the marks (tests). */
export const resetMilestones = () => {
  seen.clear();
  kernelLoad = null;
};
