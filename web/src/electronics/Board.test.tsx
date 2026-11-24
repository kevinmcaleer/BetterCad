import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { BASICS, emptyDesign, placePart, pushToBoard, type ElectronicsDesign } from "@bettercad/electronics";
import { addHole, addTrack, setPlacement } from "@bettercad/electronics/pcb/route";
import type { EEdit } from "./actions";
import BoardChecks from "./BoardChecks";
import BoardProps from "./BoardProps";
import BoardSetup from "./BoardSetup";
import { eui } from "./ui";

/** Two resistors on a 50 by 40 mm board, nothing wired. */
function board(): { d: ElectronicsDesign; parts: [string, string] } {
  const a = placePart(emptyDesign(), "sh1", BASICS.resistor!(), { x: 0, y: 0 });
  const b = placePart(a.design, "sh1", BASICS.resistor!(), { x: 25.4, y: 0 });
  let d = pushToBoard(b.design).design;
  d = setPlacement(d, a.part.id, { x: 10, y: 20 });
  d = setPlacement(d, b.part.id, { x: 30, y: 10 });
  return { d, parts: [a.part.id, b.part.id] };
}

function setup(start: ElectronicsDesign, view: (d: ElectronicsDesign, edit: EEdit) => JSX.Element) {
  let design = start;
  const labels: string[] = [];
  const edit: EEdit = (change, label) => {
    design = change(design);
    labels.push(label);
    ui.rerender(view(design, edit));
  };
  const ui = render(view(design, edit));
  return { labels, design: () => design };
}
const type = (field: HTMLElement, text: string) => {
  fireEvent.change(field, { target: { value: text } });
  fireEvent.keyDown(field, { key: "Enter" });
};

afterEach(() => act(() => eui.reset()));

describe("the board check card", () => {
  it("lists what is wrong with the board and goes to it", async () => {
    const { d } = board();
    setup(
      addTrack(d, "", "top", [
        [-1, 5],
        [3, 5],
      ]),
      (design, edit) => <BoardChecks design={design} edit={edit} onClose={() => {}} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("1 error and 2 warnings to look at.");
    expect(screen.getByText(/Checked against Safe for most board houses/)).toBeInTheDocument();
    const edge = within(screen.getByRole("list", { name: "Results" })).getByRole("button", { name: /A track on no net is over the board's edge/ });
    await userEvent.click(edge);
    expect(eui.get().spot).toMatchObject({ sheet: "board", at: [1, 5] });
    await userEvent.click(screen.getByRole("button", { name: "Board rules" }));
    expect(eui.get().card).toBe("board");
  });

  it("waives a result with a note and sets a rule's level", async () => {
    const { d } = board();
    const s = setup(
      addTrack(d, "", "top", [
        [5, 5],
        [9, 5],
      ]),
      (design, edit) => <BoardChecks design={design} edit={edit} onClose={() => {}} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("2 warnings to look at.");
    await userEvent.click(screen.getAllByRole("button", { name: "Waive" })[0]!);
    await userEvent.type(screen.getByLabelText("Why it is fine"), "A test point{Enter}");
    expect(screen.getByRole("status")).toHaveTextContent("1 warning to look at. 1 waived.");
    await userEvent.click(screen.getByRole("button", { name: "Choose the rules" }));
    await userEvent.selectOptions(screen.getByLabelText("A track ends in mid air"), "Ignore");
    expect(s.design().checks?.levels).toEqual({ "track-open": "ignore" });
    expect(screen.getByRole("status")).toHaveTextContent("No problems found. The board is ready to make.");
  });
});

describe("board setup", () => {
  it("sizes the board, rounds its corners and sets what it is made of", async () => {
    const s = setup(board().d, (design, edit) => <BoardSetup design={design} edit={edit} onClose={() => {}} />);
    type(screen.getByLabelText("Width (mm)"), "60");
    type(screen.getByLabelText("Corners (mm)"), "3");
    expect(s.design().board!.outline).toHaveLength(8);
    expect(screen.getByLabelText("Width (mm)")).toHaveValue("60");
    expect(screen.getByLabelText("Corners (mm)")).toHaveValue("3");
    await userEvent.selectOptions(screen.getByLabelText("Thickness"), "1 mm");
    await userEvent.selectOptions(screen.getByLabelText("Solder mask"), "Black");
    expect(s.design().board).toMatchObject({ thickness: 1, mask: "black" });
    expect(s.labels).toContain("Change the board's size");
  });

  it("takes a board house's rules, says where they came from and lets you change a number", async () => {
    const s = setup(board().d, (design, edit) => <BoardSetup design={design} edit={edit} onClose={() => {}} />);
    await userEvent.selectOptions(screen.getByLabelText("Made by"), "JLCPCB, 2 layers");
    expect(s.design().board!.rules).toMatchObject({ preset: "jlcpcb-2layer", minTrackWidth: 0.1 });
    expect(screen.getByRole("link", { name: "jlcpcb.com" })).toHaveAttribute("href", "https://jlcpcb.com/capabilities/pcb-capabilities");
    expect(screen.getByText(/checked on 24 November 2026/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Change the numbers" }));
    type(screen.getByLabelText("Clearance (mm)"), "0.3");
    expect(s.design().board!.rules.clearance).toBe(0.3);
    await userEvent.click(screen.getByRole("button", { name: "Put them back" }));
    expect(s.design().board!.rules.clearance).toBe(0.15);
  });

  it("makes a net class and puts nets in it", async () => {
    const start = board().d;
    const s = setup(start, (design, edit) => <BoardSetup design={design} edit={edit} onClose={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Add a class" }));
    expect(screen.getByLabelText("Class name")).toHaveValue("Power");
    type(screen.getByLabelText("Track width (mm)"), "0.8");
    expect(s.design().board!.classes[0]).toMatchObject({ name: "Power", trackWidth: 0.8, nets: [] });
    expect(within(screen.getByRole("list", { name: "Nets in Power" })).getByText("No nets yet.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Remove Power" }));
    expect(s.design().board!.classes).toEqual([]);
  });
});

describe("what is picked on the board", () => {
  it("places a part by numbers and locks it", async () => {
    const { d, parts } = board();
    const s = setup(d, (design, edit) => <BoardProps design={design} edit={edit} part={parts[0]} selected={[parts[0]]} />);
    type(screen.getByLabelText("X (mm)"), "12.5");
    type(screen.getByLabelText("Turn (°)"), "90");
    await userEvent.selectOptions(screen.getByLabelText("Side"), "Bottom");
    expect(s.design().board!.placements.find((p) => p.part === parts[0])).toMatchObject({ x: 12.5, y: 20, rot: 90, side: "bottom" });
    await userEvent.click(screen.getByLabelText("Locked in place"));
    expect(s.design().board!.placements.find((p) => p.part === parts[0])!.locked).toBe(true);
    expect(screen.getByLabelText("X (mm)")).toBeDisabled();
  });

  it("lines up several parts", async () => {
    const { d, parts } = board();
    const s = setup(d, (design, edit) => <BoardProps design={design} edit={edit} selected={parts} />);
    await userEvent.click(within(screen.getByRole("group", { name: "Line up the parts" })).getByRole("button", { name: "Line up top" }));
    expect(s.design().board!.placements.map((p) => p.y)).toEqual([20, 20]);
    expect(screen.getByRole("button", { name: "Space evenly across" })).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(screen.getByRole("button", { name: "Lock them in place" }));
    expect(s.design().board!.placements.every((p) => p.locked)).toBe(true);
    expect(screen.getByRole("button", { name: "Unlock them" })).toBeInTheDocument();
  });

  it("changes a track's width and a hole's screw size", async () => {
    let d = addTrack(board().d, "", "top", [
      [5, 5],
      [9, 5],
    ]);
    d = addHole(d, 40, 30, 3.2);
    const track = d.board!.tracks[0]!.id;
    const hole = d.board!.holes[0]!.id;
    let picked = track;
    const s = setup(d, (design, edit) => <BoardProps design={design} edit={edit} selected={[picked]} />);
    type(screen.getByLabelText("Width (mm)"), "0.5");
    expect(s.design().board!.tracks[0]!.width).toBe(0.5);
    expect(screen.getByText("4 mm")).toBeInTheDocument();
    // The next edit draws the card again, now with the hole picked.
    picked = hole;
    type(screen.getByLabelText("Width (mm)"), "0.6");
    await userEvent.selectOptions(screen.getByLabelText("Screw"), "M2.5, 2.7 mm hole");
    await userEvent.click(screen.getByLabelText("Copper ring"));
    expect(s.design().board!.holes[0]).toMatchObject({ drill: 2.7, pad: 5 });
  });
});
