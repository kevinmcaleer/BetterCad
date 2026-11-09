import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { STAGE_TEXT, StageNotice } from "./StageNotice";
import { STAGE, STAGE_KEY, stageSeen, useStageNotice } from "./useStageNotice";

afterEach(() => {
  localStorage.clear();
  vi.useRealTimers();
});

describe("StageNotice", () => {
  it("says which stage BetterCad is in and puts itself away", async () => {
    const onDismiss = vi.fn();
    render(<StageNotice onDismiss={onDismiss} />);
    const notice = screen.getByRole("complementary", { name: STAGE_TEXT[STAGE].title });
    expect(notice).toHaveTextContent("active development");
    await userEvent.click(screen.getByRole("button", { name: "Got it" }));
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalledTimes(2);
  });

  it("sits above the start card on an empty model", async () => {
    const { EmptyState } = await import("../editor/EmptyState");
    const none = () => undefined;
    render(<EmptyState onShape={none} onSketch={none} onOpen={none} onSample={none} notice={<StageNotice inline onDismiss={none} />} />);
    const notice = screen.getByRole("complementary", { name: STAGE_TEXT[STAGE].title });
    const card = screen.getByRole("region", { name: /start with a shape/i });
    expect(notice.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("keeps to the brand book: no exclamation marks", () => {
    for (const t of Object.values(STAGE_TEXT)) expect(`${t.title} ${t.text}`).not.toMatch(/!/);
  });
});

describe("useStageNotice", () => {
  it("shows a moment after a first visit, and not again once put away", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useStageNotice(true, 10));
    expect(result.current.open).toBe(false);
    act(() => vi.advanceTimersByTime(20));
    expect(result.current.open).toBe(true);
    act(() => result.current.dismiss());
    expect(result.current.open).toBe(false);
    expect(stageSeen()).toBe(true);

    const again = renderHook(() => useStageNotice(true, 10));
    act(() => vi.advanceTimersByTime(20));
    expect(again.result.current.open).toBe(false);
  });

  it("waits while the What's new card is up", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ on }) => useStageNotice(on, 10), { initialProps: { on: false } });
    act(() => vi.advanceTimersByTime(20));
    expect(result.current.open).toBe(false);
    rerender({ on: true });
    act(() => vi.advanceTimersByTime(20));
    expect(result.current.open).toBe(true);
  });

  it("shows again when the stage moves on", () => {
    vi.useFakeTimers();
    localStorage.setItem(STAGE_KEY, "some-earlier-stage");
    const { result } = renderHook(() => useStageNotice(true, 10));
    act(() => vi.advanceTimersByTime(20));
    expect(result.current.open).toBe(true);
  });

  it("starts put away in the end-to-end tests", () => {
    const config = readFileSync(join(__dirname, "../../playwright.config.ts"), "utf8");
    expect(config).toContain(`{ name: "${STAGE_KEY}", value: "${STAGE}" }`);
  });
});
