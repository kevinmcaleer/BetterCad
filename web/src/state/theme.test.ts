import { applyTheme, loadThemeSetting, resolveTheme, saveThemeSetting } from "./theme";

describe("theme", () => {
  it("honours the system preference", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("holodeck", false)).toBe("holodeck");
  });
  it("saves and loads the setting", () => {
    saveThemeSetting("holodeck");
    expect(loadThemeSetting()).toBe("holodeck");
    localStorage.setItem("bettercad.theme", "nonsense");
    expect(loadThemeSetting()).toBe("system");
  });
  it("applies data-theme and the theme-color", () => {
    applyTheme("holodeck");
    expect(document.documentElement.dataset.theme).toBe("holodeck");
    expect(document.querySelector('meta[name="theme-color"]')!.getAttribute("content")).toBe("#1b1d22");
  });
});
