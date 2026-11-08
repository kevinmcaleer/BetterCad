import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { canFullscreen, toggleFullscreen, useFullscreen } from "./fullscreen";

const d = document as unknown as Record<string, unknown>;
const el = document.documentElement as unknown as Record<string, unknown>;

function stub(name: string, value: unknown, on: Record<string, unknown> = d) {
  Object.defineProperty(on, name, { value, configurable: true, writable: true });
}

afterEach(() => {
  for (const k of ["fullscreenEnabled", "webkitFullscreenEnabled", "fullscreenElement", "webkitFullscreenElement", "exitFullscreen", "webkitExitFullscreen"])
    delete d[k];
  for (const k of ["requestFullscreen", "webkitRequestFullscreen"]) delete el[k];
});

describe("full screen", () => {
  it("says there is none where the browser has none, as on iPhone Safari", async () => {
    stub("fullscreenEnabled", false);
    expect(canFullscreen()).toBe(false);
    expect(await toggleFullscreen()).toBe(false);
  });

  it("enters with the standard API and leaves again", async () => {
    stub("fullscreenEnabled", true);
    const request = vi.fn(async () => stub("fullscreenElement", document.documentElement));
    const exit = vi.fn(async () => stub("fullscreenElement", null));
    stub("requestFullscreen", request, el);
    stub("exitFullscreen", exit);
    expect(await toggleFullscreen()).toBe(true);
    expect(request).toHaveBeenCalledWith({ navigationUI: "hide" });
    await toggleFullscreen();
    expect(exit).toHaveBeenCalled();
  });

  it("uses Safari's webkit names on iPad", async () => {
    stub("fullscreenEnabled", undefined);
    stub("webkitFullscreenEnabled", true);
    stub("requestFullscreen", undefined, el);
    const request = vi.fn();
    stub("webkitRequestFullscreen", request, el);
    expect(canFullscreen()).toBe(true);
    await toggleFullscreen();
    expect(request).toHaveBeenCalled();
  });

  it("follows full screen however it is left, Esc or a swipe", () => {
    const { result } = renderHook(() => useFullscreen());
    expect(result.current).toBe(false);
    stub("webkitFullscreenElement", document.documentElement);
    act(() => void document.dispatchEvent(new Event("webkitfullscreenchange")));
    expect(result.current).toBe(true);
    stub("webkitFullscreenElement", null);
    act(() => void document.dispatchEvent(new Event("fullscreenchange")));
    expect(result.current).toBe(false);
  });
});
