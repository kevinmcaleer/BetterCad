import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyDesign } from "@bettercad/electronics";
import type { Command } from "../state/commands";
import { showView } from "./actions";
import ElectronicsView from "./Electronics";
import { GridButton } from "./GridButton";
import { drawGridDots } from "./view2d";
import { eui } from "./ui";

afterEach(() => {
  localStorage.clear();
  act(() => eui.reset());
});

describe("the grid (status strip)", () => {
  it("shows the schematic grid's size and hides the grid from its menu", async () => {
    render(<GridButton view="schematic" />);
    const button = screen.getByRole("button", { name: /Grid 2.54 mm/ });
    expect(eui.get().gridShown).toBe(true);
    await userEvent.click(button);
    const show = screen.getByRole("menuitemcheckbox", { name: /Show grid/ });
    expect(show).toHaveAttribute("aria-checked", "true");
    await userEvent.click(show);
    expect(eui.get().gridShown).toBe(false);
    expect(screen.getByRole("button", { name: /Grid hidden/ })).toBeInTheDocument();
    expect(localStorage.getItem("bettercad.electronicsGrid")).toBe("off");
  });

  it("sets the board's grid size", async () => {
    render(<GridButton view="pcb" />);
    await userEvent.click(screen.getByRole("button", { name: /Grid 0.5 mm/ }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: /1.27 mm/ }));
    expect(eui.get().grid).toBe(1.27);
    expect(screen.getByRole("button", { name: /Grid 1.27 mm/ })).toBeInTheDocument();
  });

  it("has G to show or hide it", () => {
    const commands: Command[] = [];
    const registry = { register: (list: Command[]) => (commands.push(...list), () => void commands.splice(0)) };
    render(<ElectronicsView design={emptyDesign()} edit={() => {}} registry={registry} />);
    act(() => showView("schematic"));
    const grid = commands.find((c) => c.id === "electronics.grid")!;
    expect(grid.keys).toEqual(["g"]);
    expect(grid.label).toBe("Show or hide the grid");
    act(() => void grid.run({} as Parameters<Command["run"]>[0]));
    expect(eui.get().gridShown).toBe(false);
    expect(screen.getByRole("button", { name: /Grid hidden/ })).toBeInTheDocument();
  });

  it("draws a bigger dot every fifth step", () => {
    const rects: number[] = [];
    const ctx = { save: vi.fn(), restore: vi.fn(), fillRect: (_x: number, _y: number, w: number) => rects.push(w), fillStyle: "", globalAlpha: 1 };
    // 10 px a millimetre: the 2.54 mm grid is 25.4 px apart, 0 to 100 mm across.
    drawGridDots(ctx as unknown as CanvasRenderingContext2D, { scale: 10, ox: 0, oy: 1000 }, { w: 1000, h: 1000 }, 2.54, "grey");
    expect(rects.filter((w) => w === 2.5).length).toBeGreaterThan(0);
    expect(rects.filter((w) => w === 1.5).length).toBeGreaterThan(rects.filter((w) => w === 2.5).length * 10);
  });
});
