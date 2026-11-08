import { applyTheme, loadThemeSetting, resolveTheme, saveThemeSetting } from "./theme";

describe("theme", () => {
  it("honours the system preference", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("holoroom", false)).toBe("holoroom");
  });
  it("saves and loads the setting", () => {
    saveThemeSetting("holoroom");
    expect(loadThemeSetting()).toBe("holoroom");
    // Holodeck is now Holoroom: the old id still loads.
    localStorage.setItem("bettercad.theme", "holodeck");
    expect(loadThemeSetting()).toBe("holoroom");
    localStorage.setItem("bettercad.theme", "nonsense");
    expect(loadThemeSetting()).toBe("system");
  });
  it("applies data-theme and the theme-color", () => {
    applyTheme("holoroom");
    expect(document.documentElement.dataset.theme).toBe("holoroom");
    expect(document.querySelector('meta[name="theme-color"]')!.getAttribute("content")).toBe("#1b1d22");
  });
});
