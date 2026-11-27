import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { BASICS, emptyDesign, placePart, pushToBoard, type ElectronicsDesign } from "@bettercad/electronics";
import { addPour, wholeBoard } from "@bettercad/electronics/pcb/pour";
import { addTrack, addVia, setPlacement } from "@bettercad/electronics/pcb/route";
import { setStack } from "@bettercad/electronics/pcb/stack";
import type { EEdit } from "./actions";
import BoardProps from "./BoardProps";
import BoardSetup from "./BoardSetup";
import BoardView from "./BoardView";
import { layersFor } from "./drawBoard";
import { kindOf, readLayers } from "./FabPreview";
import { eui } from "./ui";

function board(): ElectronicsDesign {
  const a = placePart(emptyDesign(), "sh1", BASICS.resistor!(), { x: 0, y: 0 });
  return setPlacement(pushToBoard(a.design).design, a.part.id, { x: 10, y: 20 });
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

afterEach(() => act(() => eui.reset()));

describe("a board with inner layers (#648)", () => {
  it("Board setup gives the board four layers, shows the build, and says what going back takes away", async () => {
    const s = setup(board(), (design, edit) => <BoardSetup design={design} edit={edit} onClose={() => {}} />);
    const layers = screen.getByLabelText("Copper layers");
    expect(layers).toHaveValue("2");
    expect(screen.queryByRole("table", { name: "The build, top to bottom" })).toBeNull();
    await userEvent.selectOptions(layers, "4 layers");
    expect(s.design().board).toMatchObject({ copperLayers: 4, stack: "4", thickness: 1.6 });
    const rows = within(screen.getByRole("table", { name: "The build, top to bottom" })).getAllByRole("row");
    expect(rows.map((r) => r.textContent)).toEqual([
      "Top copper0.035 mm",
      "Prepreg0.2 mm",
      "Inner 1 copper0.0175 mm",
      "Core1.095 mm",
      "Inner 2 copper0.0175 mm",
      "Prepreg0.2 mm",
      "Bottom copper0.035 mm",
    ]);
    expect(screen.getByText(/This is a usual build, not a board house's own/)).toBeInTheDocument();

    act(() => {
      s.labels.length = 0;
    });
    const withCopper = addTrack(s.design(), "", "in1", [
      [5, 5],
      [9, 5],
    ]);
    const t = setup(withCopper, (design, edit) => <BoardSetup design={design} edit={edit} onClose={() => {}} />);
    await userEvent.selectOptions(screen.getAllByLabelText("Copper layers")[1]!, "2 layers");
    expect(t.design().board!.tracks).toEqual([]);
    expect(screen.getByText("1 track on the inner layers went with them. Undo puts them back.")).toBeInTheDocument();
  });

  it("the Layers card lists the inner layers, and picking one makes it the layer to work on", async () => {
    const d = setStack(board(), "4");
    expect(
      layersFor(d.board!)
        .map((l) => l.label)
        .slice(0, 4),
    ).toEqual(["Top copper", "Inner 1 copper", "Inner 2 copper", "Bottom copper"]);
    expect(
      layersFor(board().board!)
        .map((l) => l.id)
        .slice(0, 2),
    ).toEqual(["top", "bottom"]);
    render(<BoardView design={d} edit={() => {}} />);
    const card = screen.getByRole("region", { name: "Layers" });
    await userEvent.click(within(card).getByRole("button", { name: "Inner 2 copper" }));
    expect(eui.get().layer).toBe("in2");
    await userEvent.click(within(card).getByRole("button", { name: "Show inner 1 copper" }));
    expect(eui.get().hidden).toEqual(["in1"]);
  });

  it("a via can join only some layers, and a pour can sit on an inner one", async () => {
    let d = addVia(setStack(board(), "4"), "", 30, 30);
    const via = d.board!.vias[0]!.id;
    const s = setup(d, (design, edit) => <BoardProps design={design} edit={edit} selected={[via]} />);
    const joins = screen.getByLabelText("Joins");
    expect(joins).toHaveValue("");
    expect(
      within(joins)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["Every layer", "Top to Inner 1", "Top to Inner 2", "Inner 1 to Inner 2", "Inner 1 to Bottom", "Inner 2 to Bottom"]);
    await userEvent.selectOptions(joins, "Top to Inner 1");
    expect(s.design().board!.vias[0]!.span).toEqual(["top", "in1"]);
    expect(s.labels).toEqual(["Change the layers a via joins"]);
    await userEvent.selectOptions(screen.getByLabelText("Joins"), "Every layer");
    expect(s.design().board!.vias[0]!.span).toBeUndefined();

    d = addPour(setStack(board(), "4"), "GND", "top", wholeBoard(board().board!));
    const pour = d.board!.pours[0]!.id;
    const p = setup(d, (design, edit) => <BoardProps design={design} edit={edit} selected={[pour]} />);
    await userEvent.selectOptions(screen.getByLabelText("Layer"), "Inner 1 copper");
    expect(p.design().board!.pours[0]!.layer).toBe("in1");
  });

  it("a two-layer board has no Joins choice for its vias", () => {
    const d = addVia(board(), "", 30, 30);
    setup(d, (design, edit) => <BoardProps design={design} edit={edit} selected={[d.board!.vias[0]!.id]} />);
    expect(screen.queryByLabelText("Joins")).toBeNull();
  });

  it("the files preview knows an inner copper file by what it says of itself, or by its name", () => {
    expect(kindOf("a.gbr", "Copper,L2,Inr")).toBe("copper-inner");
    expect(kindOf("a.gbr", "Copper,L4,Bot")).toBe("copper-bottom");
    expect(kindOf("board.G2")).toBe("copper-inner");
    const file = (fn: string) => `%TF.FileFunction,${fn}*%\n%FSLAX46Y46*%\n%MOMM*%\nM02*\n`;
    const layers = readLayers([
      { name: "b.G1", text: file("Copper,L2,Inr") },
      { name: "b.G2", text: file("Copper,L3,Inr") },
      { name: "b.GTL", text: file("Copper,L1,Top") },
    ]);
    expect(layers.map((l) => l.label)).toEqual(["Inner 2 copper", "Inner 1 copper", "Top copper"]);
  });
});

describe("pours as outlines (#728)", () => {
  it("a switch on the Layers card shows pours as their edges only", async () => {
    render(<BoardView design={addPour(board(), "", "top", wholeBoard(board().board!))} edit={() => {}} />);
    const box = screen.getByRole("checkbox", { name: "Pours as outlines" });
    expect(box).not.toBeChecked();
    await userEvent.click(box);
    expect(eui.get().pourOutlines).toBe(true);
  });
});

describe("the selection filter (#748)", () => {
  it("ticks on the Layers card say what a click or a drag box picks", async () => {
    render(<BoardView design={board()} edit={() => {}} />);
    const pick = screen.getByRole("group", { name: "Pick" });
    const vias = within(pick).getByRole("checkbox", { name: "Vias" });
    expect(vias).toBeChecked();
    await userEvent.click(vias);
    expect(eui.get().pick.off).toEqual(["vias"]);
    await userEvent.click(within(pick).getByRole("checkbox", { name: "Locked parts" }));
    expect(eui.get().pick.skipLocked).toBe(true);
    await userEvent.click(vias);
    expect(eui.get().pick).toEqual({ off: [], skipLocked: true });
  });
});
