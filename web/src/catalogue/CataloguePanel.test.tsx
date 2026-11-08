import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CataloguePanel, matches } from "./CataloguePanel";
import { cataloguePart } from "@bettercad/kernel/catalogue";

describe("Robot parts panel (#187)", () => {
  it("lists parts by category", () => {
    render(<CataloguePanel placing={null} onPick={() => {}} />);
    for (const c of ["Servos", "Motors", "Boards", "Sensors", "Bearings", "Power"]) expect(screen.getByRole("region", { name: c })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /SG90 micro servo/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Raspberry Pi Pico W/ })).toBeInTheDocument();
  });

  it("searches by name, hiding empty categories", async () => {
    render(<CataloguePanel placing={null} onPick={() => {}} />);
    await userEvent.type(screen.getByRole("searchbox", { name: "Search parts" }), "pi 4");
    expect(screen.getByRole("button", { name: /Raspberry Pi 4/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /SG90/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Servos" })).not.toBeInTheDocument();
    await userEvent.clear(screen.getByRole("searchbox", { name: "Search parts" }));
    await userEvent.type(screen.getByRole("searchbox", { name: "Search parts" }), "flux capacitor");
    expect(screen.getByText(/No parts match/)).toBeInTheDocument();
  });

  it("picks a part, and shows the one being placed", async () => {
    const onPick = vi.fn();
    const { rerender } = render(<CataloguePanel placing={null} onPick={onPick} />);
    await userEvent.click(screen.getByRole("button", { name: /608 bearing/ }));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: "608" }));
    rerender(<CataloguePanel placing="608" onPick={onPick} />);
    expect(screen.getByRole("button", { name: /608 bearing/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("matches every word typed", () => {
    const p = cataloguePart("mg996r")!;
    expect(matches(p, "MG996R")).toBe(true);
    expect(matches(p, "servo metal")).toBe(true);
    expect(matches(p, "servo plastic")).toBe(false);
  });
});
