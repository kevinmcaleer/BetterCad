import { afterEach, describe, expect, it } from "vitest";
import { loupeAuto, setLoupeAuto } from "./loupePref";

describe("loupe setting", () => {
  afterEach(() => localStorage.clear());
  it("is on until turned off, and back on", () => {
    expect(loupeAuto()).toBe(true);
    setLoupeAuto(false);
    expect(loupeAuto()).toBe(false);
    setLoupeAuto(true);
    expect(loupeAuto()).toBe(true);
  });
});
