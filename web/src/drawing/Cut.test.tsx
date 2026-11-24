import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { newSheet, type Drawing, type DrawingSheet, type DrawingView } from "@bettercad/kernel/drawing";
import type { ModelView, ModelViewRequest, V2 } from "@bettercad/kernel/view";
import { newDoc } from "../state/document";
import { DrawingPaper, type DrawingTool, type ViewCall } from "./DrawingView";

const TAU = Math.PI * 2;
const edge = (index: number, name: string) => ({ body: "b1", kind: "edge" as const, index, name });
const line = (index: number, a: V2, b: V2, name: string) => ({ curve: { kind: "line", a, b }, visible: true, type: "sharp", source: edge(index, name) });
/** A bar 200 mm long and 20 mm tall with a 6 mm hole 30 mm from its left end. Cut, it comes back with its cut face. */
const bar = (cut: boolean) =>
  ({
    edges: [line(0, [0, 0], [200, 0], "bottom"), line(1, [200, 0], [200, 20], "right"), line(2, [200, 20], [0, 20], "top"), line(3, [0, 20], [0, 0], "left")],
    box: { min: [0, 0], max: [200, 20] },
    rounds: [{ seen: "end", c: [30, 10], r: 3, hole: true, sweep: TAU, source: { body: "b1", kind: "face", index: 9, name: "bore" } }],
    bodies: ["b1"],
    ms: 1,
    ...(cut
      ? {
          cuts: [
            {
              body: "b1",
              outline: [
                [
                  [0, 0],
                  [200, 0],
                  [200, 20],
                  [0, 20],
                  [0, 0],
                ],
              ],
            },
          ],
        }
      : {}),
  }) as unknown as ModelView;

const front: DrawingView = { id: "v1", kind: "base", shows: { all: true }, direction: "front", hidden: true, tangent: false, at: [150, 150] };
const say = vi.fn();
const asked: ModelViewRequest[] = [];

function Harness({ start, readOnly }: { start: DrawingTool; readOnly?: boolean }) {
  const [drawing, setDrawing] = useState<Drawing>({
    id: "dr1",
    name: "Drawing 1",
    decimals: 2,
    sheets: [{ ...newSheet("Sheet 1", { size: "A3" }), views: [front] }],
  });
  const [doc] = useState(() => ({ ...newDoc(), name: "Bar" }));
  const [tool, setTool] = useState<DrawingTool | null>(start);
  const [call] = useState(() =>
    vi.fn<ViewCall>((p) => {
      asked.push(p);
      return Promise.resolve(bar(!!p.cut));
    }),
  );
  return (
    <>
      <button onClick={() => setTool("break")}>Arm break</button>
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
const ready = (card: HTMLElement, text: RegExp) => waitFor(() => expect(within(card).getByRole("status")).toHaveTextContent(text));

describe("section, detail and break tools", () => {
  it("Section view: cut through the middle from the card, and the kernel is asked for the cut", async () => {
    render(<Harness start="section" />);
    const card = screen.getByRole("dialog", { name: "Section view" });
    // The only view on the sheet is the one to cut.
    expect(within(card).getByLabelText("From")).toHaveValue("v1");
    await ready(card, /Click the view where the cut goes/);
    await userEvent.selectOptions(within(card).getByLabelText("Cutting line"), "Up the view");
    await userEvent.click(within(card).getByRole("checkbox", { name: "Look from the other side" }));
    await userEvent.click(within(card).getByRole("button", { name: "Cut through the middle" }));
    expect(screen.getByTestId("tool")).toHaveTextContent("none");
    const section = sheetNow().views[1]!;
    // Through x = 100, the middle of the bar, looking from the left: what is to the left is taken away.
    expect(section).toMatchObject({ kind: "section", parent: "v1", direction: "left", section: { origin: [100, 0, 10], normal: [-1, 0, 0], label: "A" } });
    // First angle (A3 is ISO): the view from the left sits to the right, level with its parent.
    expect(section.at[0]).toBeGreaterThan(150);
    expect(section.at[1]).toBe(150);
    const view = await screen.findByRole("button", { name: /^Section A-A, 1:1/ });
    await waitFor(() => expect(asked.some((r) => r.cut && r.cut.normal[0] === -1)).toBe(true));
    await waitFor(() => expect(view.querySelector(".bc-view-thin")?.getAttribute("d")).toMatch(/^M/));
    expect(within(view).getByText("A-A")).toBeInTheDocument();
    // The parent carries the letters at each end of the cutting line.
    expect(within(screen.getByRole("button", { name: /^Front view, / })).getAllByText("A")).toHaveLength(2);
  });

  it("Section view: a half section through the middle, and the kernel is asked for half a cut", async () => {
    render(<Harness start="section" />);
    const card = screen.getByRole("dialog", { name: "Section view" });
    await ready(card, /Click the view where the cut goes/);
    await userEvent.selectOptions(within(card).getByLabelText("Cut"), "Half the view");
    await ready(card, /Click the view where the cut stops/);
    await userEvent.click(within(card).getByRole("button", { name: "Cut through the middle" }));
    const section = sheetNow().views[1]!;
    expect(section.section).toEqual({ origin: [100, 0, 10], normal: [0, 0, 1], along: [1, 0, 0], half: true, label: "A" });
    await waitFor(() => expect(asked.some((r) => r.cut?.half && r.cut.along?.[0] === 1)).toBe(true));
    // One letter on the parent: a half section is marked at the end it is cut to.
    await screen.findByRole("button", { name: /^Section A-A, 1:1/ });
    expect(within(screen.getByRole("button", { name: /^Front view, / })).getAllByText("A")).toHaveLength(1);
  });

  it("Section view: a stepped section waits for two places, and a turned line makes a slanted one", async () => {
    render(<Harness start="section" />);
    const card = screen.getByRole("dialog", { name: "Section view" });
    await ready(card, /Click the view where the cut goes/);
    await userEvent.selectOptions(within(card).getByLabelText("Cut"), "Stepped");
    await ready(card, /Click each place the cut goes through/);
    expect(within(card).getByRole("button", { name: "Make the section" })).toHaveAttribute("aria-disabled", "true");
    await userEvent.selectOptions(within(card).getByLabelText("Cut"), "All the way");
    const turn = within(card).getByLabelText("Turn the line");
    await userEvent.clear(turn);
    await userEvent.type(turn, "30{Enter}");
    await userEvent.click(within(card).getByRole("button", { name: "Cut through the middle" }));
    const section = sheetNow().views[1]!;
    expect(section.kind).toBe("section");
    expect(section.section!.normal[0]).toBeCloseTo(-0.5);
    expect(section.direction).toMatchObject({ up: [0, 1, 0] });
    expect(await screen.findByRole("button", { name: /^Section A-A, 1:1/ })).toBeInTheDocument();
  });

  it("Detail view: circle the middle at a scale and radius from the card", async () => {
    render(<Harness start="detail" />);
    const card = screen.getByRole("dialog", { name: "Detail view" });
    await ready(card, /Click the view where the detail's circle goes/);
    // A sixth of the smaller side, rounded, and twice the parent's scale.
    expect(within(card).getByLabelText("Radius")).toHaveValue("3");
    expect(within(card).getByLabelText("Scale")).toHaveValue("2");
    await userEvent.selectOptions(within(card).getByLabelText("Scale"), "5:1");
    const radius = within(card).getByLabelText("Radius");
    await userEvent.clear(radius);
    await userEvent.type(radius, "12{Enter}");
    await userEvent.click(within(card).getByRole("button", { name: "Circle the middle" }));
    expect(sheetNow().views[1]).toMatchObject({ kind: "detail", parent: "v1", scale: 5, detail: { c: [100, 10], r: 12, label: "A" } });
    expect(await screen.findByRole("button", { name: /^Detail A, 5:1/ })).toBeInTheDocument();
    expect(screen.getByText("A (5:1)")).toBeInTheDocument();
  });

  it("Break: leave out the middle third, and take the break off again from the view's menu", async () => {
    render(<Harness start="break" />);
    const card = screen.getByRole("dialog", { name: "Break" });
    await ready(card, /Click the view at each end/);
    await userEvent.click(within(card).getByRole("button", { name: "Leave out the middle third" }));
    const breaks = sheetNow().views[0]!.breaks!;
    expect(breaks).toHaveLength(1);
    expect(breaks[0]!.axis).toBe("x");
    expect(breaks[0]!.from).toBeCloseTo(200 / 3, 4);
    expect(breaks[0]!.to).toBeCloseTo(400 / 3, 4);
    const view = screen.getByRole("button", { name: /^Front view, / });
    fireEvent.contextMenu(view);
    await userEvent.click(await screen.findByRole("menuitem", { name: "Remove breaks" }));
    expect(sheetNow().views[0]!.breaks).toBeUndefined();
  });

  it("offers none of them on a model you can only look at", async () => {
    render(<Harness start="section" readOnly />);
    await screen.findByRole("button", { name: /^Front view, 1:1$/ });
    expect(screen.queryByRole("dialog", { name: "Section view" })).toBeNull();
  });
});
