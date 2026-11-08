import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { JointFeature } from "../state/document";
import { JointBar } from "./JointBar";
import type { JointSession } from "./useJoint";

const joint: JointFeature = {
  id: "J1",
  type: "joint",
  name: "Joint 1",
  kind: "revolute",
  child: "L1",
  parent: null,
  origin: [0, 0, 0],
  axis: [0, 0, 1],
  lower: -90,
  upper: 90,
};

function session(over: Partial<JointSession> = {}): JointSession {
  return {
    stage: "edit",
    child: "L1",
    parent: null,
    feature: joint,
    session: { id: "J1", isNew: true },
    change: vi.fn(),
    setFieldExpr: vi.fn(),
    done: vi.fn(),
    cancel: vi.fn(),
    back: vi.fn(),
    edit: vi.fn(),
    help: "Set the kind and limits. Enter keeps it, Esc takes it back.",
    pickParent: vi.fn(),
    nameOf: (l: string | null) => (l === null ? "Base" : "Link 1"),
    ...over,
  } as JointSession;
}

describe("JointBar (#172)", () => {
  it("names each kind in plain words with URDF's name beside it, and shows a hinge's limits in degrees", async () => {
    const x = session();
    render(<JointBar x={x} onCancel={() => {}} />);
    for (const name of ["Hinge (revolute)", "Wheel (continuous)", "Slider (prismatic)", "Fixed (fixed)"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "Hinge (revolute)" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("textbox", { name: /^Lower/ })).toHaveValue("-90");
    expect(screen.getByText("Link 1 on Base")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Wheel (continuous)" }));
    expect(x.change).toHaveBeenCalledWith({ kind: "continuous" });
  });

  it("hides limits for a wheel or a fixed joint", () => {
    render(<JointBar x={session({ feature: { ...joint, kind: "continuous" } })} onCancel={() => {}} />);
    expect(screen.queryByRole("textbox", { name: /^Lower/ })).toBeNull();
  });

  it("offers Base while picking the parent", async () => {
    const x = session({
      stage: "parent",
      parent: undefined,
      feature: null,
      session: null,
      help: "Click a body in the link Link 1 hangs from, or press Enter for Base.",
    });
    render(<JointBar x={x} onCancel={() => {}} />);
    expect(screen.getByText("Moves: Link 1")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^Base/ }));
    expect(x.pickParent).toHaveBeenCalledWith(null);
  });
});
