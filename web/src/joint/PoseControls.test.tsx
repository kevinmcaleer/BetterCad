import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { JointFeature } from "../state/document";
import { PoseControls } from "./PoseControls";

const hinge: JointFeature = {
  id: "J1",
  type: "joint",
  name: "Joint 1",
  kind: "revolute",
  child: "L1",
  parent: null,
  origin: [0, 0, 0],
  axis: [0, 0, 1],
  lower: -90,
  upper: 45,
};
const slider: JointFeature = { ...hinge, id: "J2", name: "Joint 2", kind: "prismatic", child: "L2", lower: 0, upper: 50 };
const bolt: JointFeature = { ...hinge, id: "J3", name: "Joint 3", kind: "fixed", child: "L3", lower: 0, upper: 0 };

describe("PoseControls", () => {
  it("shows a slider and a field per joint that moves, with units, and none for a fixed one", () => {
    render(<PoseControls joints={[hinge, slider, bolt]} pose={{ J1: 30, J2: 12 }} onChange={vi.fn()} onCommit={vi.fn()} onHome={vi.fn()} />);
    const h = screen.getByRole("group", { name: "Joint 1, hinge" });
    expect(within(h).getByRole("slider", { name: "Angle" })).toHaveValue("30");
    expect(within(h).getByRole("slider", { name: "Angle" })).toHaveAttribute("max", "45");
    expect(within(h).getByRole("textbox", { name: /^Angle/ })).toHaveValue("30");
    const s = screen.getByRole("group", { name: "Joint 2, slider" });
    expect(within(s).getByRole("slider", { name: "Distance" })).toHaveAttribute("aria-valuetext", "12 mm");
    expect(screen.queryByRole("group", { name: /Joint 3/ })).toBeNull();
  });

  it("moves live and keeps the move when the slider is let go, inside the limits", () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    render(<PoseControls joints={[hinge]} pose={undefined} onChange={onChange} onCommit={onCommit} />);
    const range = screen.getByRole("slider", { name: "Angle" });
    fireEvent.change(range, { target: { value: "20" } });
    expect(onChange).toHaveBeenLastCalledWith("J1", 20);
    fireEvent.pointerUp(range);
    expect(onCommit).toHaveBeenLastCalledWith("J1", 20);
  });

  it("takes a typed value, held to the limits", async () => {
    const onCommit = vi.fn();
    render(<PoseControls joints={[hinge]} pose={undefined} onChange={vi.fn()} onCommit={onCommit} />);
    const field = screen.getByRole("textbox", { name: /^Angle/ });
    await userEvent.clear(field);
    await userEvent.type(field, "80{Enter}");
    expect(onCommit).toHaveBeenLastCalledWith("J1", 45);
  });

  it("offers Home only away from home", async () => {
    const onHome = vi.fn();
    const { rerender } = render(<PoseControls joints={[hinge]} pose={undefined} onChange={vi.fn()} onCommit={vi.fn()} onHome={onHome} />);
    expect(screen.getByRole("button", { name: "Home" })).toHaveAttribute("aria-disabled", "true");
    rerender(<PoseControls joints={[hinge]} pose={{ J1: 10 }} onChange={vi.fn()} onCommit={vi.fn()} onHome={onHome} />);
    await userEvent.click(screen.getByRole("button", { name: "Home" }));
    expect(onHome).toHaveBeenCalled();
  });

  it("says so when no joint moves", () => {
    render(<PoseControls joints={[bolt]} pose={undefined} onChange={vi.fn()} onCommit={vi.fn()} />);
    expect(screen.getByText("A fixed joint doesn't move.")).toBeVisible();
  });
});
