import { beforeEach, expect, it } from "vitest";
import { formatMilestones, milestone, milestones, resetMilestones } from "./perf";

beforeEach(resetMilestones);

it("records each milestone once and formats them in seconds", () => {
  const first = milestone("shell");
  expect(milestone("shell")).toBe(first);
  expect(Object.keys(milestones())).toEqual(["shell"]);
  expect(performance.getEntriesByName("bc:shell", "mark").length).toBeGreaterThan(0);
  expect(formatMilestones({ shell: 812, kernel: 3140 })).toBe("shell 0.8 s · kernel 3.1 s");
  expect(formatMilestones({ kernel: 950 })).toBe("kernel 0.9 s");
});
