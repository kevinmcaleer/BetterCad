import type { StepTiming } from "@bettercad/kernel";
import { formatMilestones } from "../perf";
import type { Stats } from "./engine";

/** The last build, as the overlay shows it (#76): its time, its slowest steps and what the cache holds. */
export interface KernelPerf {
  ms: number;
  made: number;
  timings: StepTiming[];
  cache: { bodies: number; bytes: number; steps: number };
  /** A step's name on the timeline. */
  nameOf: (id: string) => string;
}

const W = 120;
const H = 28;
/** The graph's top: two 60 fps frames. */
const TOP = 33.4;

/** The frame-time graph: one point per frame, the line at 16.7 ms is 60 fps. */
export function graphPoints(history: number[], top = TOP): string {
  return history.map((ms, i) => `${i},${(H - (Math.min(ms, top) / top) * H).toFixed(1)}`).join(" ");
}

const MB = (b: number) => `${(b / 1024 / 1024).toFixed(1)} MB`;

/**
 * The developer overlay (#42): frame time, frames per second, triangles, draw calls, ID passes and a 120-frame graph;
 * then the last build's time, its slowest steps (cached or made) and the cache. Turn it on with `?perf` in the address
 * or Show frame times in the command palette.
 */
export function PerfOverlay({ frame, kernel }: { frame: Stats; kernel?: KernelPerf | null }) {
  const slow = kernel ? [...kernel.timings].sort((a, b) => b.ms - a.ms).slice(0, 5) : [];
  const milestones = formatMilestones();
  return (
    <div className="bc-frame-stats" aria-hidden="true">
      <div>
        {frame.ms.toFixed(1)} ms · {Math.round(frame.fps)} fps · {frame.triangles.toLocaleString()} triangles · {frame.calls} draws · {frame.idPasses} ID passes
        · {frame.bodies} bodies
        {milestones && ` · ${milestones}`}
      </div>
      <svg className="bc-frame-graph" width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        <line className="bc-frame-graph-60" x1={0} x2={W} y1={H / 2} y2={H / 2} />
        <polyline points={graphPoints(frame.history)} />
      </svg>
      {kernel && (
        <div>
          Build {kernel.ms.toFixed(0)} ms · {kernel.made} made · cache {kernel.cache.bodies} bodies, {kernel.cache.steps} steps, {MB(kernel.cache.bytes)}
          {slow.map((t) => (
            <div key={t.feature}>
              {kernel.nameOf(t.feature)} {t.ms.toFixed(1)} ms{t.cached ? " (cached)" : ""}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
