import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { newSheet, type Drawing, type DrawingSheet, type DrawingView } from "@bettercad/kernel/drawing";
import type { ModelView, V2 } from "@bettercad/kernel/view";
import { newDoc } from "../state/document";
import { DrawingPaper, type DrawingApi, type DrawingTool, type ViewCall } from "./DrawingView";

const edge = (body: string, index: number, a: V2, b: V2) => ({
  curve: { kind: "line", a, b },
  visible: true,
  type: "sharp",
  source: { body, kind: "edge", index },
});
const boxOf = (body: string, x0: number, y0: number, x1: number, y1: number) => [
  edge(body, 0, [x0, y0], [x1, y0]),
  edge(body, 1, [x1, y0], [x1, y1]),
  edge(body, 2, [x1, y1], [x0, y1]),
  edge(body, 3, [x0, y1], [x0, y0]),
];
/** A base plate with an arm standing on it. */
const robot = {
  edges: [...boxOf("plate", -40, -10, 40, 0), ...boxOf("arm", -5, 0, 5, 50)],
  box: { min: [-40, -10], max: [40, 50] },
  rounds: [],
  bodies: ["plate", "arm"],
  ms: 1,
} as unknown as ModelView;
const bodies = [
  { id: "plate", name: "Plate" },
  { id: "arm", name: "Beam", link: "c1" },
];
const components = [{ id: "c1", name: "Arm", parts: ["arm"] }];
const front: DrawingView = { id: "v1", kind: "base", shows: { all: true }, direction: "front", hidden: true, tangent: false, at: [150, 150] };
const say = vi.fn();

function Harness({ start = null, readOnly, partsList }: { start?: DrawingTool | null; readOnly?: boolean; partsList?: boolean }) {
  const [drawing, setDrawing] = useState<Drawing>({
    id: "dr1",
    name: "Drawing 1",
    decimals: 2,
    sheets: [{ ...newSheet("Sheet 1", { size: "A3" }), views: [front], ...(partsList ? { partsList } : {}) }],
  });
  const [doc] = useState(() => ({ ...newDoc(), name: "Robot", print: { material: "petg" } }));
  const [tool, setTool] = useState<DrawingTool | null>(start);
  const [call] = useState(() => vi.fn<ViewCall>(() => Promise.resolve(robot)));
  const api = useRef<DrawingApi | null>(null);
  return (
    <>
      <button onClick={() => api.current?.partsList()}>Toggle list</button>
      <button onClick={() => api.current?.autoBalloons()}>Auto balloons</button>
      <div data-testid="sheet">{JSON.stringify(drawing.sheets[0])}</div>
      <DrawingPaper
        drawing={drawing}
        readOnly={readOnly}
        onTitle={vi.fn()}
        api={api}
        doc={doc}
        call={call}
        tool={tool}
        onTool={setTool}
        say={say}
        bodies={bodies}
        components={components}
        onSheet={(change) => setDrawing((d) => ({ ...d, sheets: [change(d.sheets[0]!)] }))}
      />
    </>
  );
}
const sheetNow = () => JSON.parse(screen.getByTestId("sheet").textContent!) as DrawingSheet;
const cells = (row: HTMLElement) =>
  within(row)
    .getAllByRole("cell")
    .map((c) => c.textContent);

beforeEach(() => say.mockClear());

describe("the parts list on a sheet", () => {
  it("goes on and comes off, and reads the model: a row for each part with its count and material", async () => {
    render(<Harness />);
    expect(screen.queryByRole("table", { name: "Parts list" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Toggle list" }));
    expect(sheetNow().partsList).toBe(true);
    expect(say).toHaveBeenCalledWith("The parts list is above the title block.");
    const table = screen.getByRole("table", { name: "Parts list" });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((c) => c.textContent),
    ).toEqual(["Item", "Part", "Qty", "Material"]);
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map(cells)).toEqual([
      ["1", "Plate", "1", "PETG"],
      ["2", "Arm", "1", "PETG"],
    ]);
    // Delete on the table takes it off the sheet; so does its menu.
    table.focus();
    await userEvent.keyboard("{Delete}");
    expect(sheetNow().partsList).toBeUndefined();
    expect(screen.queryByRole("table")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Toggle list" }));
    fireEvent.contextMenu(screen.getByRole("table", { name: "Parts list" }), { clientX: 300, clientY: 200 });
    await userEvent.click(within(screen.getByRole("menu", { name: "Parts list actions" })).getByRole("menuitem", { name: /Remove parts list/ }));
    expect(sheetNow().partsList).toBeUndefined();
  });

  it("is only drawn in a model you cannot change", async () => {
    render(<Harness partsList readOnly />);
    const table = screen.getByRole("table", { name: "Parts list" });
    table.focus();
    await userEvent.keyboard("{Delete}");
    await userEvent.click(screen.getByRole("button", { name: "Toggle list" }));
    expect(sheetNow().partsList).toBe(true);
  });
});

describe("balloons on a sheet", () => {
  it("Add balloons gives each part in the view its number, once", async () => {
    render(<Harness />);
    await screen.findByRole("button", { name: "Front view, 1:1" });
    await userEvent.click(screen.getByRole("button", { name: "Auto balloons" }));
    expect(say).toHaveBeenCalledWith("Added 2 balloons.");
    expect(screen.getByRole("button", { name: "Balloon 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Balloon 2" })).toBeInTheDocument();
    expect(sheetNow().notes).toHaveLength(2);
    await userEvent.click(screen.getByRole("button", { name: "Auto balloons" }));
    expect(say).toHaveBeenLastCalledWith("Every part here has its balloon.");
    expect(sheetNow().notes).toHaveLength(2);
    // From the view's menu too.
    fireEvent.contextMenu(screen.getByRole("button", { name: "Front view, 1:1" }), { clientX: 300, clientY: 200 });
    expect(within(screen.getByRole("menu", { name: "View actions" })).getByRole("menuitem", { name: "Add balloons to this view" })).toBeInTheDocument();
  });

  it("the Balloon tool numbers the part whose edge you click; Delete takes a balloon away", async () => {
    render(<Harness start="note-balloon" />);
    const card = screen.getByRole("dialog", { name: "Balloon" });
    expect(within(card).getByRole("status")).toHaveTextContent(/Click a part/);
    // The arm's 50 mm sides: either numbers the arm, which is the second row of the list.
    await userEvent.click((await screen.findAllByRole("button", { name: "Edge, 50 mm long" }))[0]!);
    expect(sheetNow().notes).toMatchObject([{ kind: "balloon", text: "", on: { view: "v1", body: "arm" } }]);
    const balloon = screen.getByRole("button", { name: "Balloon 2" });
    await userEvent.click(within(card).getByRole("button", { name: "Finish" }));
    // A balloon has no words to change: Enter does nothing, Delete removes it.
    balloon.focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.queryByRole("dialog")).toBeNull();
    await userEvent.keyboard("{Delete}");
    expect(sheetNow().notes).toHaveLength(0);
  });
});
