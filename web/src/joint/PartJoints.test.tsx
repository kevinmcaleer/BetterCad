import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { JointFeature } from "../state/document";
import { PartJoints, type PartJoint } from "./PartJoints";

const wheel: JointFeature = {
  id: "J1",
  type: "joint",
  name: "Joint 1",
  kind: "continuous",
  child: "wheel",
  parent: "chassis",
  origin: [0, 0, 0],
  axis: [0, 1, 0],
  lower: 0,
  upper: 0,
};
const bolt: JointFeature = { ...wheel, id: "J2", name: "Joint 2", kind: "fixed", child: "chassis", parent: null };
const joints: PartJoint[] = [
  { joint: wheel, role: "holds", other: "Wheel" },
  { joint: bolt, role: "moves", other: "the base" },
];
const pose = { pose: { J1: 30 }, onChange: vi.fn(), onCommit: vi.fn() };

describe("PartJoints", () => {
  it("lists every joint to and from the part, with what it joins to, and a slider only for one that moves", () => {
    render(<PartJoints joints={joints} lit={null} onLight={vi.fn()} onEdit={vi.fn()} pose={pose} />);
    const list = screen.getByRole("list", { name: "Joints of this part" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(items[0]!).getByRole("button", { name: /^Joint 1/ })).toHaveTextContent("Joint 1Wheel joint, holds Wheel");
    expect(within(items[0]!).getByRole("slider", { name: "Angle" })).toHaveValue("30");
    expect(within(items[1]!).getByRole("button", { name: /^Joint 2/ })).toHaveTextContent("Fixed joint, on the base");
    expect(within(items[1]!).queryByRole("slider")).toBeNull();
  });

  it("lights a joint on click, clears it on a second click, and edits it from Edit or a double-click", async () => {
    const user = userEvent.setup();
    const onLight = vi.fn();
    const onEdit = vi.fn();
    const { rerender } = render(<PartJoints joints={joints} lit={null} onLight={onLight} onEdit={onEdit} />);
    const pick = screen.getByRole("button", { name: /^Joint 1/ });
    expect(pick).toHaveAttribute("aria-pressed", "false");
    await user.click(pick);
    expect(onLight).toHaveBeenLastCalledWith("J1");
    rerender(<PartJoints joints={joints} lit="J1" onLight={onLight} onEdit={onEdit} />);
    expect(screen.getByRole("button", { name: /^Joint 1/ })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: /^Joint 1/ }));
    expect(onLight).toHaveBeenLastCalledWith(null);
    await user.click(screen.getByRole("button", { name: "Edit Joint 2" }));
    expect(onEdit).toHaveBeenLastCalledWith("J2");
    await user.dblClick(screen.getByRole("button", { name: /^Joint 1/ }));
    expect(onEdit).toHaveBeenLastCalledWith("J1");
  });

  it("has no Edit when the model can't be changed", () => {
    render(<PartJoints joints={joints} lit={null} onLight={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /^Edit/ })).toBeNull();
  });
});
