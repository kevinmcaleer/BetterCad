import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { BASICS, addLabel, emptyDesign, placePart, pushToBoard, type ElectronicsDesign } from "@bettercad/electronics";
import { addKeepoutArea, addPour, wholeBoard } from "@bettercad/electronics/pcb/pour";
import { addPicture, packInk, pictureRects } from "@bettercad/electronics/pcb/picture";
import { addHole, addText, addTrack, setPlacement } from "@bettercad/electronics/pcb/route";
import { addMark } from "@bettercad/electronics/pcb/marks";
import { sampleBoard } from "@bettercad/electronics/sample";
import { applyPreset } from "@bettercad/electronics/pcb/rules";
import { drawCircle, drawRectangle, newSketch } from "@bettercad/sketch";
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
  it("adds custom rules between classes and in an area (#760)", async () => {
    const s = setup(board().d, (design, edit) => <BoardSetup design={design} edit={edit} onClose={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Between classes" }));
    await userEvent.click(screen.getByRole("button", { name: "In an area" }));
    expect(s.design().board!.customRules!.map((r) => r.kind)).toEqual(["classes", "area"]);
    const area = screen.getByRole("group", { name: "Area 2" });
    type(within(area).getByLabelText("Track width (mm)"), "0.15");
    type(within(area).getByLabelText("Right (mm)"), "40");
    const rule = s.design().board!.customRules![1]!;
    expect(rule.trackWidth).toBe(0.15);
    expect(Math.max(...rule.area!.map((p) => p[0]))).toBe(40);
    await userEvent.click(screen.getByRole("button", { name: "Remove Classes 1" }));
    expect(s.design().board!.customRules!.map((r) => r.name)).toEqual(["Area 2"]);
  });

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
    await userEvent.selectOptions(screen.getByLabelText("Vias"), "Open");
    expect(s.design().board!.viaMask).toBe("open");
    await userEvent.selectOptions(screen.getByLabelText("Vias"), "Covered by the mask");
    expect(s.design().board!.viaMask).toBeUndefined();
    await userEvent.click(screen.getByLabelText("Teardrops"));
    expect(s.design().board!.teardrops).toBe(true);
    await userEvent.click(screen.getByLabelText("Teardrops"));
    expect(s.design().board!.teardrops).toBeUndefined();
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

  it("offers a board house's newer numbers, and never applies them itself (#643)", async () => {
    // A board that took JLCPCB's rules when clearance was 0.2 mm, before the limits were checked again.
    const taken = applyPreset(board().d, "jlcpcb-2layer");
    const old = { ...taken, board: { ...taken.board!, rules: { ...taken.board!.rules, clearance: 0.2, presetChecked: "2026-01-01" } } };
    const s = setup(old, (design, edit) => <BoardSetup design={design} edit={edit} onClose={() => {}} />);
    expect(
      screen.getByText(/has been checked again since this board took its rules, and one number differs: Clearance 0.2 mm, now 0.15 mm/),
    ).toBeInTheDocument();
    expect(s.design().board!.rules.clearance).toBe(0.2);
    expect(screen.queryByRole("button", { name: "Put them back" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Keep these" }));
    expect(s.design().board!.rules).toMatchObject({ clearance: 0.2, presetChecked: "2026-11-24" });
    expect(screen.queryByRole("button", { name: "Update the rules" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Put them back" })).toBeInTheDocument();
  });

  it("updates to a board house's newer numbers when asked", async () => {
    const taken = applyPreset(board().d, "jlcpcb-2layer");
    const old = { ...taken, board: { ...taken.board!, rules: { ...taken.board!.rules, clearance: 0.2, presetChecked: "2026-01-01" } } };
    const s = setup(old, (design, edit) => <BoardSetup design={design} edit={edit} onClose={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Update the rules" }));
    expect(s.design().board!.rules).toMatchObject({ clearance: 0.15, presetChecked: "2026-11-24" });
    expect(s.labels).toContain("Update the board's rules");
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

describe("a board shaped by a file or a face", () => {
  it("takes its shape from a DXF file, and says when the file has none (#638)", async () => {
    const s = setup(board().d, (design, edit) => <BoardSetup design={design} edit={edit} onClose={() => {}} />);
    const pair = (rows: (string | number)[][]) => rows.map(([c, v]) => `${c}\n${v}`).join("\n");
    const square = pair([
      [0, "SECTION"],
      [2, "ENTITIES"],
      [0, "LWPOLYLINE"],
      [70, 1],
      [10, 0],
      [20, 0],
      [10, 64],
      [20, 0],
      [10, 64],
      [20, 32],
      [10, 0],
      [20, 32],
      [0, "ENDSEC"],
      [0, "EOF"],
    ]);
    const input = screen.getByLabelText("A DXF file for the board's shape");
    expect(screen.getByRole("button", { name: "Shape from a DXF file" })).toBeInTheDocument();
    await userEvent.upload(input, new File(["nothing here"], "empty.dxf"));
    expect(await screen.findByText(/That file has no closed shape/)).toBeInTheDocument();
    await userEvent.upload(input, new File([square], "plate.dxf"));
    expect(await screen.findByText(/The board took its shape from the file/)).toBeInTheDocument();
    expect(s.labels).toEqual(["Shape the board from a DXF file"]);
    expect(s.design().board!.outline).toHaveLength(4);
    expect(screen.getByLabelText("Width (mm)")).toHaveValue("64");
    // A round shape inside the edge is a cut-out, and is offered as a mounting hole.
    const holed = pair([
      [0, "SECTION"],
      [2, "ENTITIES"],
      [0, "LWPOLYLINE"],
      [70, 1],
      [10, 0],
      [20, 0],
      [10, 64],
      [20, 0],
      [10, 64],
      [20, 32],
      [10, 0],
      [20, 32],
      [0, "CIRCLE"],
      [10, 6],
      [20, 6],
      [40, 1.6],
      [0, "ENDSEC"],
      [0, "EOF"],
    ]);
    await userEvent.upload(input, new File([holed], "holed.dxf"));
    await userEvent.click(await screen.findByRole("button", { name: "Make it a mounting hole" }));
    expect(s.design().board!.cutouts).toBeUndefined();
    expect(s.design().board!.holes.at(-1)).toMatchObject({ x: 6, y: 6, drill: 3.2 });
    expect(screen.queryByText(/could be a mounting hole/)).toBeNull();
  });

  it("takes its shape from a flat face picked in the model, and says when the face has changed (#638)", async () => {
    // One face: a rectangle `w` wide and 20 deep, lying flat.
    const mesh = (w: number) => ({
      positions: new Float32Array([0, 0, 5, w, 0, 5, w, 20, 5, 0, 20, 5]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
      faceTris: new Uint32Array([0, 2]),
    });
    const model = (w: number, picked = true) =>
      ({
        bodies: new Map([["b1", { mesh: mesh(w), names: { faces: ["top"] } }]]),
        picks: picked ? [{ body: "b1", kind: "face", index: 0 }] : [],
        names: [{ id: "b1", name: "Lid" }],
      }) as unknown as Parameters<typeof BoardSetup>[0]["model"];
    let m = model(60);
    const s = setup(board().d, (design, edit) => <BoardSetup design={design} edit={edit} model={m} onClose={() => {}} />);
    await userEvent.selectOptions(screen.getByLabelText("Board shape"), "From a face of Lid");
    expect(s.labels).toEqual(["Shape the board from a face of Lid"]);
    // The face's plane is kept, so the board stands on the face in 3D: level, 5 mm up.
    expect(s.design().board!.outlineFrom).toMatchObject({ face: "b1|top", frame: { origin: [0, 0, 5], x: [1, 0, 0], normal: [0, 0, 1] } });
    expect(screen.getByText(/The outline follows a face of Lid: 60 × 20 mm/)).toBeInTheDocument();
    // The body changes, and nothing is picked any more: the face is still found, by its name.
    m = model(80, false);
    await userEvent.selectOptions(screen.getByLabelText("Solder mask"), "Blue");
    expect(screen.getByText("A face of Lid has changed since the board took its shape.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Update the outline" }));
    expect(screen.getByText(/The outline follows a face of Lid: 80 × 20 mm/)).toBeInTheDocument();
    // The face goes: the outline stays, and the card says why it no longer follows.
    m = { ...m!, bodies: new Map() };
    await userEvent.selectOptions(screen.getByLabelText("Solder mask"), "Red");
    expect(screen.getByText(/The face the outline followed is gone/)).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Board shape"), "Set here");
    expect(s.labels.at(-1)).toBe("Stop following the face");
    expect(screen.getByLabelText("Width (mm)")).toHaveValue("80");
  });
});

describe("a board shaped by a sketch", () => {
  it("takes its outline and cut-outs from a sketch, and says when the sketch has changed", async () => {
    const plate = (w: number) => ({
      id: "sk1",
      name: "Lid",
      sketch: drawCircle(drawRectangle(newSketch(), [100, 100], [100 + w, 130]).sketch, [110, 110], 3).sketch,
    });
    let sketches = [plate(70)];
    const s = setup(board().d, (design, edit) => <BoardSetup design={design} edit={edit} sketches={sketches} onClose={() => {}} />);
    await userEvent.selectOptions(screen.getByLabelText("Board shape"), "From Lid");
    expect(s.labels).toContain("Shape the board from Lid");
    expect(s.design().board).toMatchObject({ outlineFrom: { sketch: "sk1" } });
    expect(s.design().board!.cutouts).toHaveLength(1);
    expect(screen.getByText(/The outline follows Lid: 70 × 30 mm/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Width (mm)")).toBeNull();
    expect(screen.queryByRole("button", { name: "Update the outline" })).toBeNull();
    // The sketch grows: the board says so, and catches up when asked.
    sketches = [plate(80)];
    await userEvent.selectOptions(screen.getByLabelText("Solder mask"), "Blue");
    expect(screen.getByText("Lid has changed since the board took its shape.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Update the outline" }));
    expect(screen.getByText(/The outline follows Lid: 80 × 30 mm/)).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Board shape"), "Set here");
    expect(s.design().board!.outlineFrom).toBeUndefined();
    expect(screen.getByLabelText("Width (mm)")).toHaveValue("80");
  });
});

describe("what is picked on the board", () => {
  it("changes a pour's net, side and joins, and what a keep-out keeps out", async () => {
    let d = board().d;
    d = addPour(d, "", "top", wholeBoard(d.board!));
    d = addKeepoutArea(d, [
      [2, 2],
      [8, 2],
      [8, 8],
    ]);
    let picked = d.board!.pours[0]!.id;
    const s = setup(d, (design, edit) => <BoardProps design={design} edit={edit} selected={[picked]} />);
    expect(screen.getByRole("group", { name: "Pour" })).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Side"), "Bottom copper");
    await userEvent.click(screen.getByLabelText("Join pads with spokes"));
    await userEvent.selectOptions(screen.getByLabelText("Where pours overlap"), "Fills first of all");
    expect(s.design().board!.pours[0]).toMatchObject({ layer: "bottom", thermal: false, priority: 2 });
    picked = d.board!.keepouts[0]!.id;
    await userEvent.click(screen.getByLabelText("Join pads with spokes"));
    await userEvent.click(screen.getByLabelText("Parts"));
    await userEvent.click(screen.getByLabelText("Pours"));
    expect(s.design().board!.keepouts[0]).toMatchObject({ tracks: true, parts: true, pours: false });
  });

  it("hides a part's name on the silkscreen", async () => {
    const { d, parts } = board();
    const s = setup(d, (design, edit) => <BoardProps design={design} edit={edit} part={parts[0]} selected={[parts[0]]} />);
    await userEvent.click(screen.getByLabelText("Name on the silkscreen"));
    expect(s.design().board!.placements.find((p) => p.part === parts[0])!.refHidden).toBe(true);
  });

  it("swaps a resistor's two pins from the board, as one step (#645)", async () => {
    const { d, parts } = board();
    const s = setup(d, (design, edit) => <BoardProps design={design} edit={edit} part={parts[0]} selected={[parts[0]]} />);
    await userEvent.click(screen.getByRole("button", { name: "Swap pins 1 and 2" }));
    expect(s.labels).toEqual(["Swap pins 1 and 2 of R1"]);
    const part = s.design().parts.find((p) => p.id === parts[0])!;
    expect(s.design().defs[part.def]!.swapped).toBe(true);
    // A part whose pins each do their own job has nothing to swap.
    const j = placePart(d, "sh1", BASICS["header-3"]!(), { x: 50, y: 0 });
    const placed = pushToBoard(j.design).design;
    setup(placed, (design, edit) => <BoardProps design={design} edit={edit} part={j.part.id} selected={[j.part.id]} />);
    expect(screen.getAllByRole("button", { name: /Swap pins/ })).toHaveLength(1);
  });

  it("lets one pad join its pour its own way (#641)", async () => {
    const start = board();
    const a = start.d.sheets[0]!.symbols[0]!;
    const pin = start.d.defs[start.d.parts[0]!.def]!.symbol.pins[0]!;
    // A GND label on R1's first pin, and a GND pour over the board.
    const named = addLabel(start.d, "sh1", "GND", a.x + pin.x, a.y + pin.y);
    const d = addPour(named, "GND", "top", wholeBoard(named.board!));
    const s = setup(d, (design, edit) => <BoardProps design={design} edit={edit} part={start.parts[0]} selected={[start.parts[0]]} />);
    expect(screen.queryByLabelText(/Pad 2 joins its pour/)).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText(/Pad 1 joins its pour/), "All round");
    expect(s.design().board!.placements.find((p) => p.part === start.parts[0])!.joins).toEqual({ "1": "solid" });
    expect(s.labels).toEqual(["Change how pad 1 joins its pour"]);
    await userEvent.selectOptions(screen.getByLabelText(/Pad 1 joins its pour/), "As the pour says");
    expect(s.design().board!.placements.find((p) => p.part === start.parts[0])).not.toHaveProperty("joins");
  });

  it("moves text into copper and says what that means (#642)", async () => {
    const { d } = board();
    const lettered = addText(d, 5, 5, "Rev A");
    const id = lettered.board!.texts[0]!.id;
    const s = setup(lettered, (design, edit) => <BoardProps design={design} edit={edit} selected={[id]} />);
    expect(screen.queryByText(/Copper text is copper on no net/)).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Side"), "Bottom copper");
    expect(s.design().board!.texts[0]!.layer).toBe("copper-bottom");
    expect(screen.getByText(/Copper text is copper on no net/)).toBeInTheDocument();
  });

  it("stitches a pour to the other side with vias, as one step (#737)", async () => {
    const d = sampleBoard();
    const top = d.board!.pours.find((p) => p.layer === "top")!;
    const s = setup(d, (design, edit) => <BoardProps design={design} edit={edit} selected={[top.id]} />);
    await userEvent.click(screen.getByRole("button", { name: "Add stitching vias" }));
    expect(await screen.findByRole("status")).toHaveTextContent(/Added \d+ vias. Undo takes them all out./);
    expect(s.labels).toEqual(["Add stitching vias"]);
    expect(s.design().board!.vias.length).toBeGreaterThan(d.board!.vias.length);
  });

  it("puts a test point on a net (#735)", async () => {
    const tp = addMark(sampleBoard(), "testpoint", 5, 5);
    const s = setup(tp.design, (design, edit) => <BoardProps design={design} edit={edit} selected={[tp.id]} />);
    expect(screen.getByRole("group", { name: "Test point TP1" })).toBeInTheDocument();
    const net = screen.getByLabelText("Net");
    const first = within(net).getAllByRole("option")[1]!;
    await userEvent.selectOptions(net, first);
    expect(s.design().board!.marks![0]!.net).toBe(first.textContent);
    expect(s.labels).toEqual(["Change the test point's net"]);
  });

  it("moves a fiducial to the bottom and says what it is for (#735)", async () => {
    const { d } = board();
    const f = addMark(d, "fiducial", 5, 5);
    const s = setup(f.design, (design, edit) => <BoardProps design={design} edit={edit} selected={[f.id]} />);
    expect(screen.getByText(/A 1 mm copper dot in a 2 mm clear ring/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Net")).toBeNull();
    await userEvent.selectOptions(screen.getByLabelText("Side"), "Bottom");
    expect(s.design().board!.marks![0]!.side).toBe("bottom");
  });

  it("sizes a picture, moves it to the other side and swaps its ink (#642)", async () => {
    const { d } = board();
    const pictured = addPicture(d, { layer: "silk-top", x: 20, y: 30, w: 4, cols: 4, rows: 2, bits: packInk([1, 1, 0, 0, 1, 1, 1, 1], 4, 2) }, "pi1");
    const s = setup(pictured, (design, edit) => <BoardProps design={design} edit={edit} selected={["pi1"]} />);
    const pic = () => s.design().board!.pictures![0]!;
    expect(screen.getByLabelText("Height (mm)")).toHaveValue("2");
    type(screen.getByLabelText("Width (mm)"), "8");
    expect(pic().w).toBe(8);
    expect(screen.getByLabelText("Height (mm)")).toHaveValue("4");
    await userEvent.selectOptions(screen.getByLabelText("Side"), "Bottom silkscreen");
    expect(pic().layer).toBe("silk-bottom");
    await userEvent.click(screen.getByRole("button", { name: "Swap ink and bare board" }));
    expect(pictureRects(pic())).toHaveLength(1);
    expect(s.labels).toEqual(["Change the picture's size", "Move the picture", "Swap the picture's ink"]);
  });

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
