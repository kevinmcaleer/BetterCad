import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { BASICS, addLabel, addWire, emptyDesign, placePart, pushToBoard, type ElectronicsDesign } from "@bettercad/electronics";
import { addTrack, addVia } from "@bettercad/electronics/pcb/route";
import type { EEdit } from "./actions";
import BoardProps from "./BoardProps";
import { ElectronicsProps } from "./Electronics";
import { eui } from "./ui";

function board(): ElectronicsDesign {
  const a = placePart(emptyDesign(), "sh1", BASICS.resistor!(), { x: 0, y: 0 });
  let d = pushToBoard(a.design).design;
  d = addTrack(d, "GND", "top", [
    [0, 0],
    [10, 0],
  ]);
  d = addTrack(d, "GND", "bottom", [
    [10, 0],
    [10, 5],
  ]);
  return addVia(d, "GND", 10, 0);
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

describe("a via in the inspector", () => {
  it("is covered like the board, and can be left open on its own (#736)", async () => {
    const d = board();
    const s = setup(d, (design, edit) => <BoardProps design={design} edit={edit} selected={[d.board!.vias[0]!.id]} />);
    const mask = screen.getByLabelText("Mask");
    expect(mask).toHaveValue("covered");
    expect(screen.getByRole("option", { name: "Covered, like the board" })).toBeInTheDocument();
    await userEvent.selectOptions(mask, "open");
    expect(s.design().board!.vias[0]!.mask).toBe("open");
    expect(s.labels).toEqual(["Change the via's mask"]);
    await userEvent.selectOptions(screen.getByLabelText("Mask"), "covered");
    expect(s.design().board!.vias[0]).not.toHaveProperty("mask");
  });
});

describe("a net in the inspector", () => {
  it("shows a track's net and sets the width of all its tracks", () => {
    const d = board();
    act(() => eui.set({ view: "pcb", airs: { GND: 2 } }));
    const s = setup(d, (design, edit) => <BoardProps design={design} edit={edit} selected={[d.board!.tracks[0]!.id]} />);
    expect(screen.getByRole("group", { name: "Net GND" })).toBeInTheDocument();
    expect(screen.getByText("2, 15 mm in all")).toBeInTheDocument();
    expect(screen.getByText("Top, Bottom")).toBeInTheDocument();
    expect(screen.getByText("2 connections")).toBeInTheDocument();
    type(screen.getByLabelText("Width of its tracks (mm)"), "0.6");
    expect(s.design().board!.tracks.map((t) => t.width)).toEqual([0.6, 0.6]);
    expect(s.labels).toEqual(["Change GND's track width"]);
  });

  it("puts the net in a new Power class and changes the class's width there", async () => {
    const d = board();
    act(() => eui.set({ view: "pcb" }));
    const s = setup(d, (design, edit) => <BoardProps design={design} edit={edit} selected={[d.board!.vias[0]!.id]} />);
    await userEvent.selectOptions(screen.getByLabelText("Net class"), "New class…");
    const k = s.design().board!.classes[0]!;
    expect(k).toMatchObject({ name: "Power", nets: ["GND"] });
    expect(screen.getByLabelText("Net class")).toHaveDisplayValue("Power");
    type(screen.getByLabelText("Power track width (mm)"), "0.9");
    expect(s.design().board!.tracks.map((t) => t.width)).toEqual([0.9, 0.9]);
    await userEvent.selectOptions(screen.getByLabelText("Net class"), "None, the board's own");
    expect(s.design().board!.classes[0]!.nets).toEqual([]);
  });

  it("shows the net of a wire on the schematic", async () => {
    let d = board();
    d = addWire(d, "sh1", [50, 50], [60, 50]);
    d = addLabel(d, "sh1", "GND", 60, 50);
    const wire = d.sheets[0]!.wires.at(-1)!.id;
    act(() => eui.set({ view: "schematic", selected: [wire] }));
    setup(d, (design, edit) => <ElectronicsProps design={design} edit={edit} />);
    expect(await screen.findByRole("group", { name: "Net GND" })).toBeInTheDocument();
    expect(screen.getByLabelText("Net class")).toHaveDisplayValue("None, the board's own");
  });
});
