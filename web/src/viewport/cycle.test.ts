import { describe, expect, it } from "vitest";
import { cycleColours } from "./cycle";

describe("cycleColours", () => {
  it("gives each key its own colour, the same key the same one", () => {
    const m = cycleColours(["a", "b", "a", "c", "d", "e", "f"]);
    expect([...m.keys()]).toEqual(["a", "b", "c", "d", "e", "f"]);
    const hexes = [...m.values()].map((c) => c.getHexString());
    expect(new Set(hexes).size).toBe(hexes.length);
  });

  it("keeps the first parts' colours when more parts come", () => {
    const few = cycleColours(["a", "b"]);
    const more = cycleColours(["a", "b", "c"]);
    expect(more.get("a")!.equals(few.get("a")!)).toBe(true);
    expect(more.get("b")!.equals(few.get("b")!)).toBe(true);
  });
});
