import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { JointFeature } from "../state/document";
import { JointPanel } from "./JointPanel";
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
    target: null,
    setTarget: vi.fn(),
    child: "L1",
    from: { point: [10, 0, 5], normal: [0, 0, -1] },
    parent: null,
    frame: { origin: [0, 0, 0], axis: [0, 0, 1] },
    feature: joint,
    settings: joint,
    session: { id: "J1", isNew: true },
    missing: null,
    change: vi.fn(),
    setFieldExpr: vi.fn(),
    clear: vi.fn(),
    done: vi.fn(),
    cancel: vi.fn(),
    back: vi.fn(),
    edit: vi.fn(),
    help: null,
    pickChild: vi.fn(),
    pickParent: vi.fn(),
    nameOf: (l: string | null) => (l === null ? "Base" : l === "L1" ? "Wheel" : "Chassis"),
    links: [
      { id: "L1", name: "Wheel", parts: [] },
      { id: "L2", name: "Chassis", parts: [] },
    ],
    ...over,
  } as unknown as JointSession;
}

describe("JointPanel (#172)", () => {
  it("shows both components with their snaps, where each is, and an × to pick it again", async () => {
    const x = session();
    render(<JointPanel x={x} onCancel={() => {}} />);
    const moves = screen.getByRole("region", { name: "Moves" });
    expect(within(moves).getByRole("heading", { name: "Moves: Wheel" })).toBeInTheDocument();
    expect(within(moves).getByRole("combobox", { name: "The component that moves" })).toHaveValue("L1");
    expect(within(moves).getByRole("button", { name: /^10, 0, 5 mm/ })).toBeInTheDocument();
    await userEvent.click(within(moves).getByRole("button", { name: "Clear a snap on the component that moves" }));
    expect(x.clear).toHaveBeenCalledWith("child");
    const from = screen.getByRole("region", { name: "Hangs from" });
    expect(within(from).getByRole("heading", { name: "Hangs from: Base" })).toBeInTheDocument();
    expect(within(from).getByRole("combobox", { name: "The component it hangs from" })).toHaveValue("base");
    await userEvent.selectOptions(within(from).getByRole("combobox", { name: "The component it hangs from" }), "Chassis");
    expect(x.pickParent).toHaveBeenCalledWith("L2");
    await userEvent.click(within(from).getByRole("button", { name: /^0, 0, 0 mm/ }));
    expect(x.setTarget).toHaveBeenCalledWith("parent");
  });

  it("sets the angle, the gap, the offsets and flip", async () => {
    const x = session();
    render(<JointPanel x={x} onCancel={() => {}} />);
    const angle = screen.getByRole("textbox", { name: /^Angle/ });
    await userEvent.clear(angle);
    await userEvent.type(angle, "30{Enter}");
    expect(x.change).toHaveBeenCalledWith({ angle: 30 });
    const gap = screen.getByRole("textbox", { name: /^Gap/ });
    await userEvent.clear(gap);
    await userEvent.type(gap, "2{Enter}");
    expect(x.change).toHaveBeenCalledWith({ gap: 2 });
    const y = screen.getByRole("textbox", { name: /^Y offset/ });
    await userEvent.clear(y);
    await userEvent.type(y, "5{Enter}");
    expect(x.change).toHaveBeenCalledWith({ offset: [0, 5, 0] });
    await userEvent.click(screen.getByRole("checkbox", { name: "Flip" }));
    expect(x.change).toHaveBeenCalledWith({ flip: true });
  });

  it("offers each kind in a list with URDF's name beside it, and shows a hinge's limits in degrees", async () => {
    const x = session();
    render(<JointPanel x={x} onCancel={() => {}} />);
    const kind = screen.getByRole("combobox", { name: "Kind" });
    for (const name of ["Hinge (revolute)", "Wheel (continuous)", "Slider (prismatic)", "Fixed (fixed)"]) {
      expect(within(kind).getByRole("option", { name })).toBeInTheDocument();
    }
    expect(kind).toHaveValue("revolute");
    expect(screen.getByRole("textbox", { name: /^Lower/ })).toHaveValue("-90");
    await userEvent.selectOptions(kind, "Wheel (continuous)");
    expect(x.change).toHaveBeenCalledWith({ kind: "continuous" });
  });

  it("hides limits for a wheel", () => {
    render(<JointPanel x={session({ settings: { ...joint, kind: "continuous" } })} onCancel={() => {}} />);
    expect(screen.queryByRole("textbox", { name: /^Lower/ })).toBeNull();
  });

  it("offers Base while picking what it hangs from, and waits for the picks before OK", async () => {
    const x = session({
      stage: "parent",
      target: "parent",
      from: null,
      parent: undefined,
      frame: null,
      feature: null,
      settings: { kind: "revolute", lower: -90, upper: 90 },
      session: null,
      missing: "what it hangs from",
      help: "Click a face, a round edge or an axis on the part it joins, or press Enter for Base.",
    });
    render(<JointPanel x={x} onCancel={() => {}} />);
    expect(screen.getByRole("heading", { name: "Moves: Wheel" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Hangs from" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^OK/ })).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(screen.getByRole("button", { name: /^Base/ }));
    expect(x.pickParent).toHaveBeenCalledWith(null);
  });
});
