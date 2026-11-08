import { describe, expect, it } from "vitest";
import { originAxis } from "./usePattern";

describe("originAxis", () => {
  it("reads an origin axis in the view as the world axis of the same name", () => {
    expect(originAxis("origin:X")).toBe("x");
    expect(originAxis("origin:Z")).toBe("z");
    expect(originAxis("origin:O")).toBeNull();
    expect(originAxis("f123")).toBeNull();
  });
});
