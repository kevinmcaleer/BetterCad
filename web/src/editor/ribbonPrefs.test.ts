import { act, renderHook } from "@testing-library/react";
import { setToolbarMode, toolbarMode, useRibbon } from "./ribbonPrefs";

describe("tool bar setting", () => {
  afterEach(() => localStorage.clear());

  it("is Automatic until changed, and remembers the choice", () => {
    expect(toolbarMode()).toBe("auto");
    setToolbarMode("compact");
    expect(toolbarMode()).toBe("compact");
    setToolbarMode("auto");
    expect(localStorage.getItem("bettercad.toolbar")).toBeNull();
  });

  it("shows the ribbon when set to Ribbon, and follows a change at once", () => {
    const { result } = renderHook(() => useRibbon());
    expect(result.current).toBe(false);
    act(() => setToolbarMode("ribbon"));
    expect(result.current).toBe(true);
    act(() => setToolbarMode("compact"));
    expect(result.current).toBe(false);
  });
});
