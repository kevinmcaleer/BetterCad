import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GEAR_DEFAULTS, type GearFeature } from "../state/document";
import { GearBar } from "./GearBar";
import type { GearSession } from "./useGear";

const feature = (c: Partial<GearFeature> = {}): GearFeature => ({
  id: "g",
  type: "gear",
  name: "Gear 20T",
  body: { id: "b", name: "Gear 20T" },
  gear: GEAR_DEFAULTS,
  width: 5,
  bore: { kind: "round", diameter: 5 },
  frame: { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 0, 1] },
  ...c,
});

const session = (f: GearFeature | null) =>
  ({ feature: f, change: vi.fn(), done: vi.fn(), cancel: vi.fn(), help: "Click the ground" }) as unknown as GearSession;

describe("GearBar (#191)", () => {
  it("asks for a place before there's a gear", () => {
    render(<GearBar x={session(null)} onCancel={() => {}} />);
    expect(screen.getByText("Click the ground")).toBeInTheDocument();
  });

  it("shows the pitch diameter and changes the bore", () => {
    const x = session(feature({ gear: { ...GEAR_DEFAULTS, teeth: 30 } }));
    render(<GearBar x={x} onCancel={() => {}} />);
    expect(screen.getByText("Pitch diameter 30 mm")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /D-flat/ }));
    expect(x.change).toHaveBeenCalledWith({ bore: { kind: "dflat", diameter: 3, flat: 1.2 } });
    expect(screen.queryByLabelText(/Pressure angle/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /More/ }));
    expect(screen.getByLabelText(/Pressure angle/)).toBeInTheDocument();
  });

  it("warns about undercut below 17 teeth, and shows a problem", () => {
    const { rerender } = render(<GearBar x={session(feature({ gear: { ...GEAR_DEFAULTS, teeth: 12 } }))} onCancel={() => {}} />);
    expect(screen.getByText("Fewer than 17 teeth weakens the root at 20°. Try profile shift.")).toBeInTheDocument();
    rerender(<GearBar x={session(feature())} error="The bore is wider than the gear's root" onCancel={() => {}} />);
    expect(screen.getByRole("alert")).toHaveTextContent("The bore is wider");
  });
});
