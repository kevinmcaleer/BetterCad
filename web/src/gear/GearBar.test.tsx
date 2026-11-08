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

const session = (f: GearFeature | null, partner: GearFeature | null = null) =>
  ({ feature: f, partner, change: vi.fn(), done: vi.fn(), cancel: vi.fn(), help: "Click the ground" }) as unknown as GearSession;

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

  it("shows a meshed gear's partner and ratio, with an angle in place of the module", () => {
    const a = feature({ name: "Gear 20T" });
    const x = session(feature({ id: "b", name: "Gear 40T", gear: { ...GEAR_DEFAULTS, teeth: 40 }, mesh: { gear: "g", angle: 0 } }), a);
    render(<GearBar x={x} onCancel={() => {}} />);
    expect(screen.getByText("Meshes with Gear 20T, module 1. 2 : 1, the small gear turns twice as fast.")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Module/)).toBeNull();
    expect(screen.getByLabelText(/Angle/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Unmesh/ }));
    expect(x.change).toHaveBeenCalledWith(expect.objectContaining({ mesh: undefined, frame: expect.objectContaining({ origin: [30, 0, 0] }) }));
  });

  it("switches form, and a rack has a length and height in place of teeth and bore", () => {
    const x = session(feature());
    const { rerender } = render(<GearBar x={x} onCancel={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /^Rack/ }));
    expect(x.change).toHaveBeenCalledWith(expect.objectContaining({ form: "rack", rack: { length: 60, height: 5 } }));
    rerender(<GearBar x={session(feature({ form: "rack", rack: { length: 60, height: 5 }, bore: { kind: "none", diameter: 0 } }))} onCancel={() => {}} />);
    expect(screen.getByLabelText(/Length/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Teeth/)).toBeNull();
    expect(screen.queryByRole("group", { name: "Bore" })).toBeNull();
    expect(screen.getByText("Tooth pitch 3.14 mm")).toBeInTheDocument();
  });

  it("shows a belted pulley's belt, ratio and centre distance", () => {
    const a = feature({ id: "a", name: "Pulley 20T", form: "gt2", width: 7 });
    const x = session(feature({ form: "gt2", width: 7, gear: { ...GEAR_DEFAULTS, teeth: 40 }, belt: { pulley: "a", angle: 0, length: 200 } }), a);
    render(<GearBar x={x} onCancel={() => {}} />);
    expect(screen.getByText("Pitch diameter 25.46 mm")).toBeInTheDocument();
    expect(screen.getByText("Round Pulley 20T, 100 teeth. 2 : 1, the small pulley turns twice as fast.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /200 mm belt/ })).toBeInTheDocument();
    expect(screen.getByText(/^Centres [\d.]+ mm apart\.$/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /9 mm belt/ }));
    expect(x.change).toHaveBeenCalledWith({ width: 10 });
  });
});
