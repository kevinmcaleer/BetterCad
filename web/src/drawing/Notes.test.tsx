import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { newSheet, type Drawing, type DrawingDimension, type DrawingNote, type DrawingSheet, type DrawingView } from "@bettercad/kernel/drawing";
import type { ModelView, V2 } from "@bettercad/kernel/view";
import { newDoc } from "../state/document";
import { DrawingPaper, type DrawingTool, type ViewCall } from "./DrawingView";

const TAU = Math.PI * 2;
const edge = (index: number, name: string) => ({ body: "b1", kind: "edge" as const, index, name });
const line = (index: number, a: V2, b: V2, name: string) => ({ curve: { kind: "line", a, b }, visible: true, type: "sharp", source: edge(index, name) });
/** A bar 200 mm long and 20 mm tall with a 6 mm hole 30 mm from its left end. */
const bar = {
  edges: [line(0, [0, 0], [200, 0], "bottom"), line(1, [200, 0], [200, 20], "right"), line(2, [200, 20], [0, 20], "top"), line(3, [0, 20], [0, 0], "left")],
  box: { min: [0, 0], max: [200, 20] },
  rounds: [{ seen: "end", c: [30, 10], r: 3, hole: true, sweep: TAU, source: { body: "b1", kind: "face", index: 9, name: "bore" } }],
  bodies: ["b1"],
  ms: 1,
} as unknown as ModelView;

const front: DrawingView = { id: "v1", kind: "base", shows: { all: true }, direction: "front", hidden: true, tangent: false, at: [150, 150] };
const long: DrawingDimension = { id: "d1", view: "v1", kind: "linear", refs: [{ view: "v1", ...edge(0, "bottom") }], across: "aligned", at: [0, -20] };
const say = vi.fn();

function Harness({
  start = null,
  readOnly,
  notes,
  dimensions = [],
}: {
  start?: DrawingTool | null;
  readOnly?: boolean;
  notes?: DrawingNote[];
  dimensions?: DrawingDimension[];
}) {
  const [drawing, setDrawing] = useState<Drawing>({
    id: "dr1",
    name: "Drawing 1",
    decimals: 2,
    sheets: [{ ...newSheet("Sheet 1", { size: "A3" }), views: [front], dimensions, ...(notes ? { notes } : {}) }],
  });
  const [doc] = useState(() => ({ ...newDoc(), name: "Bar" }));
  const [tool, setTool] = useState<DrawingTool | null>(start);
  const [call] = useState(() => vi.fn<ViewCall>(() => Promise.resolve(bar)));
  return (
    <>
      <div data-testid="sheet">{JSON.stringify(drawing.sheets[0])}</div>
      <div data-testid="tool">{tool ?? "none"}</div>
      <DrawingPaper
        drawing={drawing}
        readOnly={readOnly}
        onTitle={vi.fn()}
        doc={doc}
        call={call}
        tool={tool}
        onTool={setTool}
        say={say}
        onSheet={(change) => setDrawing((d) => ({ ...d, sheets: [change(d.sheets[0]!)] }))}
      />
    </>
  );
}
const sheetNow = () => JSON.parse(screen.getByTestId("sheet").textContent!) as DrawingSheet;
const notesNow = () => sheetNow().notes ?? [];

beforeEach(() => say.mockClear());

describe("note tools", () => {
  it("Hole note: click a hole and its size is written beside it, with the tool still armed", async () => {
    render(<Harness start="note-hole" />);
    const card = screen.getByRole("dialog", { name: "Hole note" });
    expect(within(card).getByRole("status")).toHaveTextContent(/Click a hole/);
    // Only holes can take a hole note: the edges are not offered.
    const hole = await screen.findByRole("button", { name: "Hole, 6 mm across" });
    expect(screen.queryByRole("button", { name: /^Edge/ })).toBeNull();
    await userEvent.click(hole);
    expect(notesNow()).toMatchObject([{ kind: "hole", text: "", on: { view: "v1", kind: "face", name: "bore" } }]);
    expect(screen.getByRole("button", { name: "Hole note, Ø6" })).toBeInTheDocument();
    expect(screen.getByTestId("tool")).toHaveTextContent("note-hole");
    await userEvent.click(within(card).getByRole("button", { name: "Finish" }));
    expect(screen.getByTestId("tool")).toHaveTextContent("none");
  });

  it("Leader: asks for its words first, then points them at the edge you click", async () => {
    render(<Harness start="note-leader" />);
    const card = screen.getByRole("dialog", { name: "Leader" });
    const edges = await screen.findAllByRole("button", { name: "Edge, 200 mm long" });
    await userEvent.click(edges[0]!);
    expect(say).toHaveBeenCalledWith("Type what the note says first.");
    expect(notesNow()).toHaveLength(0);
    await userEvent.type(within(card).getByLabelText("Text"), "Deburr");
    await userEvent.click(edges[0]!);
    expect(notesNow()).toMatchObject([{ kind: "leader", text: "Deburr", on: { view: "v1", kind: "edge" } }]);
    expect(screen.getByRole("button", { name: "Note, Deburr" })).toBeInTheDocument();
  });

  it("Text: goes in the middle of the sheet from the card, or where you click", async () => {
    render(<Harness start="note-text" />);
    const card = screen.getByRole("dialog", { name: "Text" });
    const place = within(card).getByRole("button", { name: "Put it in the middle" });
    expect(place).toHaveAttribute("aria-disabled", "true");
    await userEvent.type(within(card).getByLabelText("Text"), "Print in PETG");
    await userEvent.click(place);
    const [note] = notesNow();
    expect(note).toMatchObject({ kind: "text", text: "Print in PETG" });
    expect(note!.on).toBeUndefined();
    expect(screen.getByRole("button", { name: "Note, Print in PETG" })).toBeInTheDocument();
  });

  it("Datum: each one takes the next letter; the card's Kind switches to another note tool", async () => {
    render(<Harness start="note-datum" />);
    const card = screen.getByRole("dialog", { name: "Datum" });
    expect(within(card).getByLabelText("Letter")).toHaveValue("A");
    const edges = await screen.findAllByRole("button", { name: "Edge, 200 mm long" });
    await userEvent.click(edges[0]!);
    await waitFor(() => expect(within(card).getByLabelText("Letter")).toHaveValue("B"));
    await userEvent.click(edges[1]!);
    expect(notesNow().map((n) => n.text)).toEqual(["A", "B"]);
    await userEvent.selectOptions(within(card).getByLabelText("Kind"), "Feature control frame");
    expect(screen.getByTestId("tool")).toHaveTextContent("note-frame");
    const frame = screen.getByRole("dialog", { name: "Feature control frame" });
    await userEvent.selectOptions(within(frame).getByLabelText("Of"), "Flatness");
    await userEvent.type(within(frame).getByLabelText("Datums"), "a b");
    await userEvent.click((await screen.findAllByRole("button", { name: "Edge, 200 mm long" }))[0]!);
    expect(notesNow()[2]).toMatchObject({ kind: "frame", symbol: "flatness", text: "0.1|A|B" });
    expect(screen.getByRole("button", { name: "Note, Flatness 0.1, A, B" })).toBeInTheDocument();
  });
});

describe("a note on the sheet", () => {
  const notes: DrawingNote[] = [{ id: "n1", kind: "leader", text: "Deburr", on: { view: "v1", ...edge(2, "top") }, at: [20, 30] }];

  it("moves with the arrow keys, changes its words with Enter and goes with Delete", async () => {
    render(<Harness notes={notes} />);
    const note = await screen.findByRole("button", { name: "Note, Deburr" });
    note.focus();
    await userEvent.keyboard("{ArrowRight}{Shift>}{ArrowUp}{/Shift}");
    expect(notesNow()[0]!.at).toEqual([21, 40]);
    await userEvent.keyboard("{Enter}");
    const card = screen.getByRole("dialog", { name: "Change leader" });
    const text = within(card).getByLabelText("Text");
    await userEvent.clear(text);
    await userEvent.type(text, "Sand smooth");
    await userEvent.click(within(card).getByRole("button", { name: "Done" }));
    expect(notesNow()[0]).toMatchObject({ id: "n1", text: "Sand smooth", at: [21, 40] });
    screen.getByRole("button", { name: "Note, Sand smooth" }).focus();
    await userEvent.keyboard("{Delete}");
    expect(notesNow()).toHaveLength(0);
  });

  it("is only drawn in a model you cannot change", async () => {
    render(<Harness notes={notes} readOnly />);
    const note = await screen.findByRole("button", { name: "Note, Deburr" });
    note.focus();
    await userEvent.keyboard("{ArrowRight}{Delete}{Enter}");
    expect(notesNow()).toEqual(notes);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("is a problem when its edge is gone: Pick again arms its tool with its words", async () => {
    const lost: DrawingNote[] = [{ id: "n1", kind: "leader", text: "Deburr", on: { view: "v1", ...edge(77, "gone") }, at: [20, 30] }];
    render(<Harness notes={lost} />);
    const warning = await screen.findByRole("button", { name: /Lost note/ });
    expect(say).toHaveBeenCalledWith(expect.stringMatching(/^1 problem on this sheet/));
    fireEvent.contextMenu(warning, { clientX: 300, clientY: 200 });
    await userEvent.click(within(screen.getByRole("menu", { name: "Warning actions" })).getByRole("menuitem", { name: /Pick again/ }));
    expect(screen.getByTestId("tool")).toHaveTextContent("note-leader");
    expect(within(screen.getByRole("dialog", { name: "Leader" })).getByLabelText("Text")).toHaveValue("Deburr");
    await userEvent.click((await screen.findAllByRole("button", { name: "Edge, 200 mm long" }))[0]!);
    // The new note takes the lost one's place.
    expect(notesNow()).toHaveLength(1);
    expect(notesNow()[0]!.id).not.toBe("n1");
    expect(screen.queryByRole("button", { name: /Lost note/ })).toBeNull();
  });
});

describe("a dimension's tolerance", () => {
  it("is set from its right-click menu: plus and minus, limits, a fit, and none again", async () => {
    render(<Harness dimensions={[long]} />);
    const open = async (name: string) => {
      fireEvent.contextMenu(await screen.findByRole("button", { name }), { clientX: 300, clientY: 200 });
      await userEvent.click(within(screen.getByRole("menu", { name: "Dimension actions" })).getByRole("menuitem", { name: /Tolerance/ }));
      return screen.findByRole("dialog", { name: /^Tolerance on/ });
    };
    let card = await open("Dimension, 200 mm");
    expect(card).toHaveAccessibleName("Tolerance on 200 mm");
    await userEvent.selectOptions(within(card).getByLabelText("Tolerance"), "Plus and minus");
    await userEvent.click(within(card).getByRole("button", { name: "Done" }));
    expect(sheetNow().dimensions[0]!.tolerance).toEqual({ plus: 0.1, minus: 0.1 });

    card = await open("Dimension, 200 ±0.1 mm");
    await userEvent.selectOptions(within(card).getByLabelText("Tolerance"), "Limits");
    await userEvent.click(within(card).getByRole("button", { name: "Done" }));
    expect(sheetNow().dimensions[0]!.tolerance).toEqual({ plus: 0.1, minus: 0.1, limits: true });

    card = await open("Dimension, 200.1 / 199.9 mm");
    await userEvent.selectOptions(within(card).getByLabelText("Tolerance"), "Sliding fit");
    expect(within(card).getByRole("status")).toHaveTextContent(/A sliding fit leaves 0\.\d+ mm each side/);
    await userEvent.click(within(card).getByRole("button", { name: "Done" }));
    const fit = sheetNow().dimensions[0]!.tolerance!;
    expect(fit).toMatchObject({ fit: "sliding" });

    card = await open(`Dimension, 200 sliding fit, ${"gap" in fit ? fit.gap : ""} gap`);
    await userEvent.selectOptions(within(card).getByLabelText("Tolerance"), "None");
    await userEvent.click(within(card).getByRole("button", { name: "Done" }));
    expect(sheetNow().dimensions[0]!.tolerance).toBeUndefined();
    expect(screen.getByRole("button", { name: "Dimension, 200 mm" })).toBeInTheDocument();
  });
});
