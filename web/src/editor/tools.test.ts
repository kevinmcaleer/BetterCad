import { describe, expect, it } from "vitest";
import { TOOLS, TOOL_GROUPS } from "./tools";

describe("the top bar's tool groups", () => {
  it("has every tool in exactly one group", () => {
    const grouped = TOOL_GROUPS.flatMap((g) => g.tools.map((t) => t.id));
    expect([...grouped].sort()).toEqual(TOOLS.map((t) => t.id).sort());
  });
});
