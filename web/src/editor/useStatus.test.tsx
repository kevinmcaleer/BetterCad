import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TOAST_MS, useStatus } from "./useStatus";

describe("useStatus", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("puts a save notice in the toast, not the status line, and clears it", () => {
    const { result } = renderHook(() => useStatus());
    act(() => result.current[1]("Autosaved", false, true));
    expect(result.current[0].text).toBe("");
    expect(result.current[2]?.text).toBe("Autosaved");
    act(() => vi.advanceTimersByTime(TOAST_MS));
    expect(result.current[2]).toBeNull();
  });

  it("starts the toast over for each notice", () => {
    const { result } = renderHook(() => useStatus());
    act(() => result.current[1]("Autosaved", false, true));
    const first = result.current[2]!.id;
    act(() => vi.advanceTimersByTime(TOAST_MS - 100));
    act(() => result.current[1]("Saved to Bracket.bcad", false, true));
    expect(result.current[2]).toEqual({ text: "Saved to Bracket.bcad", id: first + 1 });
    act(() => vi.advanceTimersByTime(200));
    expect(result.current[2]?.text).toBe("Saved to Bracket.bcad");
  });

  it("never lets Autosaved cover a save notice still showing", () => {
    const { result } = renderHook(() => useStatus());
    act(() => result.current[1]("Saved Bracket to your account", false, true));
    act(() => result.current[1]("Autosaved", false, "minor"));
    expect(result.current[2]?.text).toBe("Saved Bracket to your account");
    act(() => vi.advanceTimersByTime(TOAST_MS));
    act(() => result.current[1]("Autosaved", false, "minor"));
    expect(result.current[2]?.text).toBe("Autosaved");
  });

  it("keeps errors on the status line, where they stay long enough to read", () => {
    const { result } = renderHook(() => useStatus());
    act(() => result.current[1]("That didn't save.", true, true));
    expect(result.current[2]).toBeNull();
    expect(result.current[0]).toEqual({ text: "That didn't save.", bad: true });
  });
});
