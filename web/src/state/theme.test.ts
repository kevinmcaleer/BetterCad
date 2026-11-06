import { loadThemeSetting, resolveTheme, saveThemeSetting } from "./theme";

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
});
