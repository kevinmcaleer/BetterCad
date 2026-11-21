import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { RecoverNotice } from "./RecoverNotice";
import type { AutosaveRecord } from "./autosave";

const HOUR = 60 * 60 * 1000;
const NOW = 100 * HOUR;
const rec = (name: string, hoursAgo: number): AutosaveRecord => ({ id: name, name, json: "{}", modified: NOW - hoursAgo * HOUR, savedAt: null, source: null });

const setup = (list: AutosaveRecord[]) => {
  const p = { onRecover: vi.fn(), onDiscard: vi.fn(), onDiscardAll: vi.fn() };
  render(<RecoverNotice list={list} {...p} now={() => NOW} />);
  return p;
};

describe("RecoverNotice", () => {
  it("shows nothing when there is nothing to recover", () => {
    const { container } = render(<RecoverNotice list={[]} onRecover={vi.fn()} onDiscard={vi.fn()} onDiscardAll={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("names a single model with Recover and Discard", () => {
    const p = setup([rec("SMARS Wheel", 8)]);
    expect(screen.getByText(/Recover ‘SMARS Wheel’ from 8 hours ago/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Recover" }));
    expect(p.onRecover).toHaveBeenCalledWith(expect.objectContaining({ id: "SMARS Wheel" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(p.onDiscard).toHaveBeenCalledWith(expect.objectContaining({ id: "SMARS Wheel" }));
  });

  it("gathers several models into one notice, with the list behind Choose", () => {
    const p = setup([rec("SMARS Wheel", 8), rec("STL Import test", 8), rec("smars", 11)]);
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByText("You have 3 unsaved models you can recover")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Models you can recover" })).not.toBeInTheDocument();

    const choose = screen.getByRole("button", { name: "Choose" });
    expect(choose).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(choose);
    const list = screen.getByRole("list", { name: "Models you can recover" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    expect(within(list).getByText("11 hours ago")).toBeInTheDocument();

    fireEvent.click(within(list).getByRole("button", { name: "Recover STL Import test" }));
    expect(p.onRecover).toHaveBeenCalledWith(expect.objectContaining({ id: "STL Import test" }));
    fireEvent.click(within(list).getByRole("button", { name: "Discard smars" }));
    expect(p.onDiscard).toHaveBeenCalledWith(expect.objectContaining({ id: "smars" }));

    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("discards them all at once", () => {
    const p = setup([rec("a", 1), rec("b", 2)]);
    fireEvent.click(screen.getByRole("button", { name: "Discard all" }));
    expect(p.onDiscardAll).toHaveBeenCalledOnce();
  });
});
