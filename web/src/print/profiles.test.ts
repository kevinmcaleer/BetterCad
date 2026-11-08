import { bedLabel, loadLocal, merge, saveLocal } from "./profiles";
import { profileFromSettings } from "../state/document";

describe("printer profiles in the browser (#180)", () => {
  beforeEach(() => localStorage.clear());

  it("keeps profiles in local storage and drops anything that isn't one", () => {
    const p = profileFromSettings("p1", "My A1", { printer: "bambu-a1" });
    saveLocal([p]);
    expect(loadLocal()).toEqual([p]);
    localStorage.setItem("bettercad.printers", JSON.stringify([{ id: 1 }, p]));
    expect(loadLocal()).toEqual([p]);
    localStorage.setItem("bettercad.printers", "not json");
    expect(loadLocal()).toEqual([]);
  });

  it("merges the account's printers with this browser's, the account winning", () => {
    const a = profileFromSettings("a", "Local A", {});
    const b = profileFromSettings("b", "Local B", {});
    const b2 = { ...b, name: "Account B" };
    expect(merge([a, b], [b2]).map((p) => p.name)).toEqual(["Local A", "Account B"]);
  });
});

describe("bedLabel", () => {
  it("names the printer's build volume", () => {
    expect(bedLabel({ id: "prusa-mk4", name: "Prusa MK4" })).toBe("Prusa MK4 build volume");
  });
  it("says just build volume for a custom size", () => {
    expect(bedLabel({ id: "custom", name: "Custom printer" })).toBe("Build volume");
  });
});
