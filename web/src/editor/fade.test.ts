import { describe, expect, it } from "vitest";
import { fadedOutside } from "./fade";

describe("fading outside the active component", () => {
  const components = [{ id: "A" }, { id: "B", parent: "A" }, { id: "C" }];
  const parts = [{ id: "loose" }, { id: "a", link: "A" }, { id: "b", link: "B" }, { id: "c", link: "C" }];

  it("fades every body outside the active component and the ones inside it", () => {
    expect(fadedOutside("A", components, parts)).toEqual(new Set(["loose", "c"]));
    expect(fadedOutside("B", components, parts)).toEqual(new Set(["loose", "a", "c"]));
  });

  it("fades nothing while the whole model is active", () => {
    expect(fadedOutside(null, components, parts)).toBeUndefined();
  });
});
