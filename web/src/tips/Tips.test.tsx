import { act, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TipsCard, tips } from "./Tips";
import { TIPS_KEY, tipsHidden, useTips } from "./useTips";

afterEach(() => {
  localStorage.clear();
  vi.useRealTimers();
});

describe("TipsCard", () => {
  it("steps through the tips and dismisses at the end", async () => {
    const onDismiss = vi.fn();
    render(<TipsCard from="auto" onDismiss={onDismiss} />);
    const card = screen.getByRole("complementary", { name: "Tips" });
    const all = tips();
    expect(card).toHaveTextContent(all[0]!.text);
    expect(card).toHaveTextContent(`1 of ${all.length}`);
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Next tip" }));
    expect(card).toHaveTextContent(all[1]!.text);
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(card).toHaveTextContent(all[0]!.text);
    for (let i = 1; i < all.length; i++) await userEvent.click(screen.getByRole("button", { name: "Next tip" }));
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("dismisses from the close button", async () => {
    const onDismiss = vi.fn();
    render(<TipsCard from="help" onDismiss={onDismiss} />);
    await userEvent.click(screen.getByRole("button", { name: "Dismiss tips" }));
    expect(onDismiss).toHaveBeenCalled();
  });

  it("keeps to the brand book: no exclamation marks", () => {
    for (const t of tips()) expect(`${t.title} ${t.text}`).not.toMatch(/!/);
  });
});

describe("useTips", () => {
  it("shows after a moment, and not again once dismissed", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ on }) => useTips(on, 10), { initialProps: { on: false } });
    act(() => vi.advanceTimersByTime(20));
    expect(result.current.open).toBe(false);
    rerender({ on: true });
    act(() => vi.advanceTimersByTime(20));
    expect(result.current.open).toBe(true);
    expect(result.current.from).toBe("auto");
    act(() => result.current.dismiss());
    expect(result.current.open).toBe(false);
    expect(tipsHidden()).toBe(true);

    const again = renderHook(() => useTips(true, 10));
    act(() => vi.advanceTimersByTime(20));
    expect(again.result.current.open).toBe(false);
    act(() => again.result.current.show());
    expect(again.result.current.open).toBe(true);
    expect(again.result.current.from).toBe("help");
  });

  it("stays away when dismissed on an earlier visit", () => {
    localStorage.setItem(TIPS_KEY, "1");
    vi.useFakeTimers();
    const { result } = renderHook(() => useTips(true, 10));
    act(() => vi.advanceTimersByTime(20));
    expect(result.current.open).toBe(false);
  });
});
