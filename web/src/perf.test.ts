import { beforeEach, expect, it, vi } from "vitest";
import { formatMilestones, milestone, milestones, recordKernelLoad, resetMilestones } from "./perf";

beforeEach(resetMilestones);

it("records each milestone once and formats them in seconds", () => {
  const first = milestone("shell");
  expect(milestone("shell")).toBe(first);
  expect(Object.keys(milestones())).toEqual(["shell"]);
  expect(performance.getEntriesByName("bc:shell", "mark").length).toBeGreaterThan(0);
  expect(formatMilestones({ shell: 812, kernel: 3140 })).toBe("shell 0.8 s · kernel 3.1 s");
  expect(formatMilestones({ kernel: 950 })).toBe("kernel 0.9 s");
});

it("adds the engine's download and start to the overlay, and logs them once (#50)", () => {
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  expect(formatMilestones({ kernel: 3000 }, { download: 1200, start: 800 })).toBe("kernel 3.0 s · wasm download 1.2 s · wasm start 0.8 s");
  // A cached WASM has no download.
  expect(formatMilestones({}, { start: 400 })).toBe("wasm start 0.4 s");
  recordKernelLoad({ start: 400 }, 900);
  recordKernelLoad({ start: 500 }, 1000);
  expect(log).toHaveBeenCalledTimes(1);
  expect(log.mock.calls[0]![0]).toBe("Geometry engine ready in 0.9 s: download cached, compile and start 0.4 s");
  expect(formatMilestones({})).toBe("wasm start 0.4 s");
  log.mockRestore();
});
