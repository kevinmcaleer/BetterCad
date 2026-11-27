import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { BASICS, addLabel, emptyDesign, placePart, placeSheetBox, placedPins, type ElectronicsDesign } from "@bettercad/electronics";
import { addSheet } from "@bettercad/electronics/sheets";
import { showView, type EEdit } from "./actions";
import ElectronicsView from "./Electronics";
import { hitSheet } from "./hit";
import { eui } from "./ui";

/** A top sheet, and a "Driver" sheet with a resistor between labels IN and OUT. */
function driver(): ElectronicsDesign {
  const added = addSheet(emptyDesign(), "sh1", "drv");
  let d: ElectronicsDesign = { ...added.design, sheets: added.design.sheets.map((s) => (s.id === "drv" ? { ...s, name: "Driver" } : s)) };
  d = placePart(d, "drv", BASICS.resistor!(), { x: 0, y: 0 }).design;
  const [a, b] = placedPins(d).filter((p) => p.sheet === "drv");
  d = addLabel(d, "drv", "IN", a!.at[0], a!.at[1]);
  return addLabel(d, "drv", "OUT", b!.at[0], b!.at[1]);
}

function setup(start: ElectronicsDesign) {
  let design = start;
  const labels: string[] = [];
  const view = () => <ElectronicsView design={design} edit={edit} registry={{ register: () => () => {} }} />;
  const edit: EEdit = (change, label) => {
    design = change(design);
    labels.push(label);
    ui.rerender(view());
  };
  const ui = render(view());
  return { labels, design: () => design };
}

afterEach(() => act(() => eui.reset()));

describe("sheets as boxes (#757)", () => {
  it("makes the picked labels sheet pins with the Sheet pin tool", async () => {
    const d = driver();
    act(() => {
      showView("schematic", d);
      eui.set({ sheet: "drv", selected: d.sheets[1]!.labels.map((l) => l.id) });
    });
    const s = setup(d);
    await userEvent.click(screen.getByRole("button", { name: "Sheet pin" }));
    expect(s.labels).toEqual(["Make sheet pin"]);
    expect(s.design().sheets[1]!.labels.every((l) => l.port)).toBe(true);
  });

  it("finds a box under the pointer, and a copy's sheet follows its master and can't be changed", () => {
    let d = driver();
    d = { ...d, sheets: d.sheets.map((s) => (s.id === "drv" ? { ...s, labels: s.labels.map((l) => ({ ...l, port: true })) } : s)) };
    d = placeSheetBox(d, "sh1", "drv", [0, 0])!.design;
    d = placeSheetBox(d, "sh1", "drv", [0, -30])!.design;
    const box = d.sheets[0]!.boxes![0]!;
    expect(hitSheet(d, d.sheets[0]!, [box.x + 5, box.y - 2], 0.5).map((h) => h.kind)).toContain("box");
    const copy = d.sheets.find((s) => s.use?.master)!;
    act(() => {
      showView("schematic", d);
      eui.set({ sheet: copy.id });
    });
    setup(d);
    expect(screen.getByRole("status", { name: "Electronics status" })).toHaveTextContent("This sheet follows Driver");
    expect(screen.getByRole("button", { name: "Wire" })).toHaveAttribute("aria-disabled", "true");
  });
});
