import { act, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NOTES } from "./notes";
import { loadSeen, saveSeen } from "./seen";
import { useWhatsNew } from "./useWhatsNew";
import { WhatsNewCard, WhatsNewDialog } from "./WhatsNew";

afterEach(() => {
  localStorage.clear();
  vi.useRealTimers();
});

describe("WhatsNewCard", () => {
  it("names up to three new features and counts the rest", async () => {
    const onOpen = vi.fn();
    const onDismiss = vi.fn();
    const fresh = NOTES.slice(0, 5).map((n) => n.id);
    render(<WhatsNewCard fresh={fresh} onOpen={onOpen} onDismiss={onDismiss} />);
    const card = screen.getByRole("complementary", { name: "What's new" });
    expect(card).toHaveTextContent(NOTES[0]!.title);
    expect(card).toHaveTextContent("and 2 more");
    await userEvent.click(screen.getByRole("button", { name: "See what's new" }));
    expect(onOpen).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalled();
  });
});

describe("WhatsNewDialog", () => {
  it("lists every note and marks the new ones", () => {
    render(<WhatsNewDialog fresh={[NOTES[0]!.id]} onClose={() => {}} />);
    expect(screen.getByRole("dialog", { name: "What's new" })).toBeInTheDocument();
    for (const n of NOTES) expect(screen.getByRole("article", { name: new RegExp(n.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) })).toBeInTheDocument();
    expect(screen.getAllByText("New")).toHaveLength(1);
  });
});

describe("useWhatsNew", () => {
  const settle = async () => {
    await act(async () => {
      vi.advanceTimersByTime(10);
      await import("./notes");
    });
    await act(async () => {});
  };

  it("offers nothing on a first visit, and remembers every note as seen", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useWhatsNew(10));
    await settle();
    expect(result.current.card).toBe(false);
    expect(loadSeen()?.size).toBe(NOTES.length);
  });

  it("offers the notes you haven't seen, and opening them marks them seen", async () => {
    saveSeen(NOTES.slice(1).map((n) => n.id));
    vi.useFakeTimers();
    const { result } = renderHook(() => useWhatsNew(10));
    await settle();
    expect(result.current.card).toBe(true);
    expect(result.current.fresh).toEqual([NOTES[0]!.id]);
    act(() => result.current.show());
    expect(result.current.open).toBe(true);
    expect(result.current.card).toBe(false);
    expect(loadSeen()?.has(NOTES[0]!.id)).toBe(true);
  });
});
