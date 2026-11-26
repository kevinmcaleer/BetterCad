import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { newSheet, type Drawing, type DrawingMark, type DrawingSheet, type DrawingView } from "@bettercad/kernel/drawing";
import type { ModelView, V2 } from "@bettercad/kernel/view";
import { newDoc } from "../state/document";
import { DrawingPaper, DrawingRibbon, type DrawingApi, type DrawingTool, type ViewCall } from "./DrawingView";
import { sceneDxf } from "./export/dxf";
import { sheetScene } from "./export/scene";
import { sheetLayout } from "./layout";

const TAU = Math.PI * 2;
const face = (index: number, name: string) => ({ body: "b1", kind: "face" as const, index, name });
const edge = (index: number) => ({ body: "b1", kind: "edge" as const, index });
const bolts: V2[] = [0, 1, 2, 3].map((i) => [20 * Math.cos((i * TAU) / 4), 20 * Math.sin((i * TAU) / 4)]);
/** A plate with four 5 mm holes on a bolt circle, a 12 mm bore, a cross hole seen from the side and a chamfered corner. */
const plate = {
  edges: [
    { curve: { kind: "line", a: [-30, -30], b: [30, -30] }, visible: true, type: "sharp", source: edge(0) },
    { curve: { kind: "line", a: [30, -30], b: [30, 20] }, visible: true, type: "sharp", source: edge(1) },
    { curve: { kind: "line", a: [20, 30], b: [-30, 30] }, visible: true, type: "sharp", source: edge(2) },
  ],
  box: { min: [-30, -30], max: [30, 30] },
  rounds: [
    ...bolts.map((c, i) => ({ seen: "end", c, r: 2.5, hole: true, sweep: TAU, source: face(10 + i, `hole${i}`) })),
    { seen: "end", c: [0, 0], r: 6, hole: true, sweep: TAU, source: face(20, "bore") },
    { seen: "side", a: [-30, 10], b: [30, 10], r: 1.5, hole: true, sweep: TAU, source: face(22, "cross") },
  ],
  bodies: ["b1"],
  ms: 1,
} as unknown as ModelView;
const front: DrawingView = { id: "v1", kind: "base", shows: { all: true }, direction: "front", hidden: true, tangent: false, at: [150, 150] };
const doc = { ...newDoc(), name: "Plate" };
const say = vi.fn();

function Harness({ tool: first = null, marks = [], readOnly }: { tool?: DrawingTool | null; marks?: DrawingMark[]; readOnly?: boolean }) {
  const [drawing, setDrawing] = useState<Drawing>({
    id: "dr1",
    name: "Drawing 1",
    decimals: 2,
    sheets: [{ ...newSheet("Sheet 1", { size: "A3" }), views: [front], marks }],
  });
  const [tool, setTool] = useState<DrawingTool | null>(first);
  const [call] = useState(() => vi.fn<ViewCall>(() => Promise.resolve(plate)));
  const api = useRef<DrawingApi | null>(null);
  return (
    <>
      <button onClick={() => api.current?.autoMarks()}>Auto</button>
      <button onClick={() => setTool("centre-mark")}>Arm</button>
      <div data-testid="sheet">{JSON.stringify(drawing.sheets[0])}</div>
      <DrawingPaper
        drawing={drawing}
        readOnly={readOnly}
        onTitle={vi.fn()}
        doc={doc}
        call={call}
        api={api}
        tool={tool}
        onTool={setTool}
        say={say}
        onSheet={(change) => setDrawing((d) => ({ ...d, sheets: [change(d.sheets[0]!)] }))}
      />
    </>
  );
}
const sheetNow = () => JSON.parse(screen.getByTestId("sheet").textContent!) as DrawingSheet;
const holes = () => screen.findAllByRole("button", { name: "Hole, 5 mm across" });

describe("Centre mark", () => {
  it("offers every hole in the view; a click marks its centre, once", async () => {
    render(<Harness tool="centre-mark" />);
    expect(within(screen.getByRole("dialog", { name: "Centre mark" })).getByRole("status").textContent).toMatch(/Click a hole or a round edge/);
    const all = await holes();
    expect(all).toHaveLength(4);
    expect(screen.getByRole("button", { name: "Hole, 12 mm across" })).toBeTruthy();
    // Axes and edges are for the other tools.
    expect(screen.queryByRole("button", { name: /^Edge/ })).toBeNull();
    await userEvent.click(all[0]!);
    await userEvent.click(all[0]!);
    expect(sheetNow().marks).toMatchObject([
      { id: expect.any(String), kind: "centre-mark", on: { view: "v1", body: "b1", kind: "face", index: 10, name: "hole0" } },
    ]);
    // The mark is drawn: a short cross and four lines out past the rim.
    const mark = screen.getByRole("button", { name: "Centre mark" });
    expect(mark.querySelector(".bc-mark-line")!.getAttribute("d")!.match(/M/g)).toHaveLength(6);
  });

  it("works from the keyboard: Tab to a hole, Enter marks it, and the tool stays armed until Esc", async () => {
    render(<Harness tool="centre-mark" />);
    const bore = await screen.findByRole("button", { name: "Hole, 12 mm across" });
    act(() => bore.focus());
    await userEvent.keyboard("{Enter}");
    expect(sheetNow().marks[0]).toMatchObject({ kind: "centre-mark", on: { name: "bore" } });
    expect(screen.getByRole("dialog", { name: "Centre mark" })).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Centre mark" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Hole, 12 mm across" })).toBeNull();
  });

  it("a mark is selected by focus and deleted with Delete, leaving its view where it was", async () => {
    const marks: DrawingMark[] = [{ id: "m1", kind: "centre-mark", on: { view: "v1", body: "b1", kind: "face", index: 20, name: "bore" } }];
    render(<Harness marks={marks} />);
    const mark = await screen.findByRole("button", { name: "Centre mark" });
    act(() => mark.focus());
    expect(mark.getAttribute("aria-pressed")).toBe("true");
    await userEvent.keyboard("{ArrowRight}{Delete}");
    expect(sheetNow().marks).toEqual([]);
    expect(sheetNow().views[0]!.at).toEqual([150, 150]);
  });

  it("a mark whose hole the model no longer has is kept but not drawn; marks are only drawn in a view-only model", async () => {
    const marks: DrawingMark[] = [
      { id: "m1", kind: "centre-mark", on: { view: "v1", body: "b1", kind: "face", index: 20, name: "gone" } },
      { id: "m2", kind: "centre-mark", on: { view: "v1", body: "b1", kind: "face", index: 20, name: "bore" } },
    ];
    render(<Harness marks={marks} readOnly tool="centre-mark" />);
    const drawn = await screen.findAllByRole("button", { name: "Centre mark" });
    expect(drawn).toHaveLength(1);
    act(() => drawn[0]!.focus());
    await userEvent.keyboard("{Delete}");
    expect(sheetNow().marks).toHaveLength(2);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("Centre mark pattern", () => {
  it("one click brings in the holes like it on their circle; Add marks them with the pitch circle", async () => {
    render(<Harness tool="centre-pattern" />);
    await userEvent.click((await holes())[1]!);
    const card = within(screen.getByRole("dialog", { name: "Centre mark pattern" }));
    expect(card.getByRole("status").textContent).toMatch(/^4 holes picked\./);
    expect((card.getByRole("combobox", { name: "Join with" }) as HTMLSelectElement).value).toBe("circle");
    expect((await holes()).every((h) => h.getAttribute("aria-pressed") === "true")).toBe(true);
    await userEvent.click(card.getByRole("button", { name: "Add" }));
    const mark = sheetNow().marks[0] as Extract<DrawingMark, { kind: "centre-pattern" }>;
    expect(mark).toMatchObject({ kind: "centre-pattern", join: "circle" });
    expect(mark.on.map((r) => r.name)).toEqual(["hole0", "hole1", "hole2", "hole3"]);
    const drawn = screen.getByRole("button", { name: "Centre mark pattern" });
    expect(drawn.querySelectorAll(".bc-mark-line")[1]!.getAttribute("stroke-dasharray")).toBe("10 1.5 1.5 1.5");
  });

  it("a hole can be left out, and a set that is not on one circle is joined with lines", async () => {
    render(<Harness tool="centre-pattern" />);
    await userEvent.click(await screen.findByRole("button", { name: "Hole, 12 mm across" }));
    const card = within(screen.getByRole("dialog", { name: "Centre mark pattern" }));
    expect(card.getByRole("status").textContent).toMatch(/^1 hole picked\./);
    expect(card.queryByRole("button", { name: "Add" })).toBeNull();
    const all = await holes();
    await userEvent.click(all[0]!);
    await userEvent.click(all[3]!);
    await userEvent.click(all[3]!);
    await userEvent.click(all[1]!);
    await userEvent.click(all[2]!);
    expect(card.queryByRole("option", { name: "A pitch circle" })).toBeNull();
    await userEvent.click(card.getByRole("button", { name: "Add" }));
    expect(sheetNow().marks[0]).toMatchObject({
      kind: "centre-pattern",
      join: "lines",
      on: [{ name: "bore" }, { name: "hole0" }, { name: "hole1" }, { name: "hole2" }],
    });
  });
});

describe("Centre line and Edge extension", () => {
  it("a hole seen from the side gets its axis in one click", async () => {
    render(<Harness tool="centre-line" />);
    await userEvent.click(await screen.findByRole("button", { name: "Axis of a hole, 3 mm across" }));
    expect(sheetNow().marks).toMatchObject([
      { id: expect.any(String), kind: "centre-line", a: { view: "v1", body: "b1", kind: "face", index: 22, name: "cross" } },
    ]);
  });

  it("two edges get the line midway between them", async () => {
    render(<Harness tool="centre-line" />);
    await userEvent.click(await screen.findByRole("button", { name: "Edge, 60 mm long" }));
    expect(within(screen.getByRole("dialog", { name: "Centre line" })).getByRole("status").textContent).toBe("Now click the second edge.");
    await userEvent.click(screen.getAllByRole("button", { name: "Edge, 50 mm long" })[0]!);
    expect(sheetNow().marks[0]).toMatchObject({ kind: "centre-line", a: { kind: "edge", index: 0 }, b: { kind: "edge" } });
    expect(within(screen.getByRole("dialog", { name: "Centre line" })).getByRole("status").textContent).toMatch(/^Click a hole or pin/);
  });

  it("an extension carries two edges on to their corner", async () => {
    render(<Harness tool="extension" />);
    expect(screen.queryByRole("button", { name: /^Axis/ })).toBeNull();
    const edges = await screen.findAllByRole("button", { name: "Edge, 50 mm long" });
    expect(edges).toHaveLength(2);
    await userEvent.click(edges[0]!);
    await userEvent.click(edges[1]!);
    expect(sheetNow().marks).toMatchObject([
      {
        id: expect.any(String),
        kind: "extension",
        a: { view: "v1", body: "b1", kind: "edge", index: 1 },
        b: { view: "v1", body: "b1", kind: "edge", index: 2 },
      },
    ]);
    expect(screen.getByRole("button", { name: "Edge extension" })).toBeTruthy();
  });
});

describe("Add centre marks to this view", () => {
  it("marks every hole and axis in one step, and says how many; again, there is nothing left", async () => {
    render(<Harness />);
    await screen.findByRole("button", { name: "Front view, 1:1" });
    await userEvent.click(screen.getByRole("button", { name: "Auto" }));
    expect(
      sheetNow()
        .marks.map((m) => m.kind)
        .sort(),
    ).toEqual(["centre-line", "centre-mark", "centre-mark", "centre-mark", "centre-mark", "centre-mark"]);
    expect(say).toHaveBeenLastCalledWith("Added 6 marks.");
    await userEvent.click(screen.getByRole("button", { name: "Auto" }));
    expect(sheetNow().marks).toHaveLength(6);
    expect(say).toHaveBeenLastCalledWith("There are no holes or round features left to mark here.");
  });

  it("is on a view's right-click menu", async () => {
    render(<Harness />);
    fireEvent.contextMenu(await screen.findByRole("button", { name: "Front view, 1:1" }), { clientX: 300, clientY: 200 });
    await userEvent.click(within(screen.getByRole("menu", { name: "View actions" })).getByRole("menuitem", { name: "Add centre marks to this view" }));
    await waitFor(() => expect(sheetNow().marks).toHaveLength(6));
  });

  it("the Drawing tab has the four tools and Add centre marks", async () => {
    const p = { onSettings: vi.fn(), onFit: vi.fn(), onMark: vi.fn(), onAutoMarks: vi.fn() };
    render(<DrawingRibbon {...p} mark="centre-line" />);
    const group = within(screen.getByRole("group", { name: "Geometry" }));
    for (const name of ["Centre mark", "Centre mark pattern", "Centre line", "Edge extension"]) await userEvent.click(group.getByRole("button", { name }));
    expect(p.onMark.mock.calls.map((c) => c[0])).toEqual(["centre-mark", "centre-pattern", "centre-line", "extension"]);
    expect(group.getByRole("button", { name: "Centre line" }).getAttribute("aria-pressed")).toBe("true");
    await userEvent.click(group.getByRole("button", { name: "Add centre marks" }));
    expect(p.onAutoMarks).toHaveBeenCalled();
  });
});

describe("marks in an export", () => {
  it("go on the centre layer, in paper millimetres", () => {
    const sheet: DrawingSheet = {
      ...newSheet("Sheet 1", { size: "A3" }),
      views: [front],
      marks: [
        { id: "m1", kind: "centre-mark", on: { view: "v1", body: "b1", kind: "face", index: 20, name: "bore" } },
        {
          id: "m2",
          kind: "centre-pattern",
          on: bolts.map((_, i) => ({ view: "v1", body: "b1", kind: "face" as const, index: 10 + i, name: `hole${i}` })),
          join: "circle",
        },
      ],
    };
    const scene = sheetScene(sheet, sheetLayout(sheet), () => plate);
    const centre = scene.strokes.filter((s) => s.layer === "centre");
    expect(centre.filter((s) => s.curve.kind === "line")).toHaveLength(6 + 4 * 6 + 2);
    expect(centre[0]).toEqual({ layer: "centre", width: 0.25, curve: { kind: "line", a: [148.5, 150], b: [151.5, 150] } });
    expect(centre.find((s) => s.curve.kind === "circle")).toMatchObject({ dash: [10, 1.5, 1.5, 1.5], curve: { c: [150, 150] } });
    expect(sceneDxf(scene)).toContain("CIRCLE\r\n  8\r\nCENTRE\r\n 10\r\n150\r\n 20\r\n150\r\n 30\r\n0\r\n 40\r\n20\r\n");
  });
});
