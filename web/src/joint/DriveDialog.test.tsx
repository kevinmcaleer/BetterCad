import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GEAR_DEFAULTS, addDrive, addGear, addJoint, addLink, build, newDoc, type ModelDoc } from "../state/document";
import { DriveDialog } from "./DriveDialog";

/** Four wheels, two each side, each on its own wheel joint. */
function rover(): ModelDoc {
  let d = newDoc("Rover");
  [0, 1, 2, 3].forEach((i) => {
    const origin: [number, number, number] = [i * 30, i < 2 ? 40 : -40, 0];
    const frame = { origin, x: [1, 0, 0] as [number, number, number], normal: [0, 0, 1] as [number, number, number] };
    d = addGear(d, { gear: GEAR_DEFAULTS, width: 4, bore: { kind: "none", diameter: 0 }, frame }, `g${i}`, `W${i}`);
    d = addLink(d, [`W${i}`], `l${i}`);
    d = addJoint(d, { kind: "continuous", child: `l${i}`, parent: null, origin, axis: [0, i < 2 ? 1 : -1, 0], lower: 0, upper: 0 }, `j${i}`);
  });
  return d;
}

describe("Link joints", () => {
  it("starts from the joint you picked, and links the ones you tick, one the other way", async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    render(<DriveDialog doc={rover()} together lead="j1" onDone={onDone} onCancel={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: "Link joints" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Lead joint" })).toHaveValue("j1");
    expect(screen.getByRole("status")).toHaveTextContent("Tick the joints that move with it");
    expect(screen.getByRole("button", { name: "Link joints" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByRole("checkbox", { name: "Joint 2" })).toBeNull();
    await user.click(screen.getByRole("checkbox", { name: "Joint 1" }));
    await user.click(screen.getByRole("checkbox", { name: "Joint 3" }));
    await user.click(screen.getByRole("checkbox", { name: "Joint 4" }));
    await user.click(screen.getByRole("checkbox", { name: "Joint 4 turns the other way" }));
    expect(screen.getByRole("checkbox", { name: "Joint 3 turns the other way" })).not.toBeChecked();
    expect(screen.getByRole("status")).toHaveTextContent("3 joints move with Joint 2");
    await user.click(screen.getByRole("button", { name: "Link joints" }));
    expect(onDone).toHaveBeenCalledWith({ kind: "together", driver: "j1", driven: "j0", ratio: 1, more: ["j2", "j3"], against: ["j3"] });
  });

  it("opens a motion link to change it, and leaves out joints another step drives", () => {
    let d = addDrive(rover(), { kind: "together", driver: "j0", driven: "j1", ratio: 1 }, "m1");
    d = addDrive(d, { kind: "custom", driver: "j0", driven: "j3", ratio: 2 }, "d1");
    const editing = d.features.find((f) => f.id === "m1");
    if (editing?.type !== "drive") throw new Error("no link");
    expect(build(d).failed.size).toBe(0);
    render(<DriveDialog doc={d} editing={editing} onDone={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: "Edit Motion link 1" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Joint 2" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Joint 3" })).not.toBeChecked();
    expect(screen.queryByRole("checkbox", { name: "Joint 4" })).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Joint 2 moves with Joint 1");
  });
});
