import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { addLabel, emptyDesign, placePart, resistor, type ElectronicsDesign } from "@bettercad/electronics";
import { addSheet } from "@bettercad/electronics/sheets";
import type { EEdit } from "./actions";
import SchSheets from "./SchSheets";
import { eui } from "./ui";
import { useEui } from "./useEui";

/** One resistor with IN and MID on its pins, and a second sheet that uses IN too. */
function twoSheets(): ElectronicsDesign {
  let d = emptyDesign();
  d = placePart(d, "sh1", resistor(), { x: 0, y: 0 }).design;
  d = addLabel(d, "sh1", "IN", 0, 3.81);
  d = addLabel(d, "sh1", "MID", 0, -3.81);
  const two = addSheet(d, undefined, "sh2");
  return addLabel(two.design, "sh2", "IN", 10.16, 0);
}

/** The strip over a design held here, as the editor's history would hold it. */
function setup(start: ElectronicsDesign, readOnly = false) {
  let design = start;
  const labels: string[] = [];
  function Host() {
    const ui = useEui();
    const open = design.sheets.find((s) => s.id === ui.sheet) ?? design.sheets[0]!;
    return <SchSheets design={design} open={open.id} edit={edit} readOnly={readOnly} />;
  }
  const edit: EEdit = (change, label) => {
    design = change(design);
    labels.push(label);
    view.rerender(<Host />);
  };
  const view = render(<Host />);
  return { labels, design: () => design, tabs: () => screen.getAllByRole("tab").map((t) => t.textContent) };
}

afterEach(() => act(() => eui.reset()));

describe("the schematic's sheets (#636)", () => {
  it("adds a sheet and opens it, renames it, moves it and deletes it", async () => {
    const s = setup(twoSheets());
    expect(s.tabs()).toEqual(["Sheet 1", "Sheet 2"]);
    expect(screen.getByRole("tab", { name: "Sheet 1, sheet 1 of 2" })).toHaveAttribute("aria-selected", "true");

    await userEvent.click(screen.getByRole("button", { name: "Add sheet" }));
    expect(s.tabs()).toEqual(["Sheet 1", "Sheet 3", "Sheet 2"]);
    const made = screen.getByRole("tab", { name: "Sheet 3, sheet 2 of 3" });
    expect(made).toHaveAttribute("aria-selected", "true");

    // F2 renames; Alt with an arrow moves it along.
    made.focus();
    await userEvent.keyboard("{F2}");
    const box = screen.getByLabelText("Sheet name");
    await userEvent.clear(box);
    await userEvent.type(box, "Motor driver{Enter}");
    expect(s.tabs()).toEqual(["Sheet 1", "Motor driver", "Sheet 2"]);
    await userEvent.keyboard("{Alt>}{ArrowRight}{/Alt}");
    expect(s.tabs()).toEqual(["Sheet 1", "Sheet 2", "Motor driver"]);

    // Arrows go from sheet to sheet, and Delete deletes the one you are on, with its parts.
    await userEvent.keyboard("{Home}");
    expect(screen.getByRole("tab", { name: "Sheet 1, sheet 1 of 3" })).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{Delete}");
    expect(s.tabs()).toEqual(["Sheet 2", "Motor driver"]);
    expect(screen.getByRole("status")).toHaveTextContent("Deleted Sheet 1 and its 1 part. Undo brings it back.");
    expect(s.design().parts).toEqual([]);
    expect(s.labels).toEqual(["Add sheet", "Rename sheet", "Move sheet", "Delete sheet"]);
  });

  it("copies a sheet as a block from its menu, and says what it renamed", async () => {
    const s = setup(twoSheets());
    fireEvent.contextMenu(screen.getByRole("tab", { name: "Sheet 1, sheet 1 of 2" }));
    await userEvent.click(within(screen.getByRole("menu", { name: "Sheet actions" })).getByRole("menuitem", { name: "Duplicate, as a block to use again" }));
    expect(s.tabs()).toEqual(["Sheet 1", "Sheet 3", "Sheet 2"]);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Copied Sheet 1. Its parts have their own references, and MID is MID_2 on the copy. Names other sheets use still join.",
    );
    expect(s.design().parts.map((p) => p.ref)).toEqual(["R1", "R2"]);
    expect(
      s
        .design()
        .sheets[1]!.labels.map((l) => l.name)
        .sort(),
    ).toEqual(["IN", "MID_2"]);
  });

  it("says where a picked label carries on, and goes there", async () => {
    const d = twoSheets();
    setup(d);
    const label = d.sheets[0]!.labels.find((l) => l.name === "IN")!;
    act(() => eui.set({ selected: [label.id] }));
    expect(screen.getByRole("status")).toHaveTextContent("IN carries on to Sheet 2");
    await userEvent.click(within(screen.getByRole("status")).getByRole("button", { name: "Sheet 2" }));
    expect(eui.get().sheet).toBe("sh2");
    expect(eui.get().selected).toEqual([d.sheets[1]!.labels[0]!.id]);
    expect(eui.get().spot).toMatchObject({ sheet: "sh2", at: [10.16, 0] });
    // A name that stays on one sheet has nowhere to go.
    act(() => eui.set({ sheet: "sh1", selected: [d.sheets[0]!.labels.find((l) => l.name === "MID")!.id] }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("only switches sheets when the model is read only, and hides with one sheet", () => {
    const one = setup(emptyDesign(), true);
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(one.labels).toEqual([]);
  });

  it("places another sheet on this one as a box, and again as a copy that follows it (#757)", async () => {
    const s = setup(twoSheets());
    const place = async () => {
      fireEvent.contextMenu(screen.getByRole("tab", { name: "Sheet 2, sheet 2 of 2" }));
      await userEvent.click(within(screen.getByRole("menu", { name: "Sheet actions" })).getByRole("menuitem", { name: "Place on this sheet as a box" }));
    };
    await place();
    expect(s.labels).toEqual(["Place sheet as a box"]);
    expect(s.design().sheets[0]!.boxes).toHaveLength(1);
    expect(eui.get().selected).toEqual([s.design().sheets[0]!.boxes![0]!.id]);
    expect(screen.getByRole("status")).toHaveTextContent("Sheet 2 is a box here now");
    await place();
    expect(s.tabs()).toEqual(["Sheet 1", "Sheet 2", "Sheet 2 (2)"]);
    expect(screen.getByRole("status")).toHaveTextContent("The copy follows Sheet 2");
    // A placed sheet goes with its box.
    fireEvent.contextMenu(screen.getByRole("tab", { name: "Sheet 2, sheet 2 of 3" }));
    await userEvent.click(within(screen.getByRole("menu", { name: "Sheet actions" })).getByRole("menuitem", { name: /^Delete/ }));
    expect(s.tabs()).toHaveLength(3);
    expect(screen.getByRole("status")).toHaveTextContent("Delete its box instead");
  });
});
