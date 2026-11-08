import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CATALOGUE } from "@bettercad/kernel";
import { LookControls } from "./LookControls";

describe("Colour and Finish in Properties (#196)", () => {
  it("colours the selection from a filament swatch, or back to the theme", async () => {
    const onColour = vi.fn();
    render(<LookControls parts={[{ colour: "#d2332e" }]} onColour={onColour} onFinish={() => {}} />);
    expect(screen.getByRole("button", { name: "Red" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Theme colour" })).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(screen.getByRole("button", { name: "Blue" }));
    expect(onColour).toHaveBeenLastCalledWith("#2d6fd0");
    await userEvent.click(screen.getByRole("button", { name: "Theme colour" }));
    expect(onColour).toHaveBeenLastCalledWith(undefined);
  });

  it("shows Matte PLA by default, a bearing as Metal, and sets a finish from the menu", async () => {
    const onFinish = vi.fn();
    const { rerender } = render(<LookControls parts={[{}]} onColour={() => {}} onFinish={onFinish} />);
    await userEvent.click(screen.getByRole("button", { name: "Matte PLA" }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: "Silk" }));
    expect(onFinish).toHaveBeenCalledWith("silk");
    const bearing = CATALOGUE.find((p) => p.category === "bearing")!;
    rerender(<LookControls parts={[{ catalogue: bearing }]} onColour={() => {}} onFinish={onFinish} />);
    expect(screen.getByRole("button", { name: "Metal" })).toBeInTheDocument();
  });

  it("says Several when the selection's finishes differ", () => {
    render(<LookControls parts={[{ finish: "metal" }, { finish: "silk" }]} onColour={() => {}} onFinish={() => {}} />);
    expect(screen.getByRole("button", { name: "Several" })).toBeInTheDocument();
  });
});
