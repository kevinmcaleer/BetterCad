import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { BASICS, addLabel, addWire, emptyDesign, placePart, type ElectronicsDesign, type P2 } from "@bettercad/electronics";
import { addSheet } from "@bettercad/electronics/sheets";
import type { Command } from "../state/commands";
import { showView, type EEdit } from "./actions";
import ElectronicsView from "./Electronics";
import { schMenuRows } from "./schMenuRows";
import { eui } from "./ui";

function ledAndResistor(): ElectronicsDesign {
  let d = emptyDesign();
  d = placePart(d, "sh1", BASICS.resistor!(), { x: -25.4, y: 0 }).design;
  d = placePart(d, "sh1", BASICS.led!(), { x: 0, y: 0 }).design;
  d = addWire(d, "sh1", [-25.4, 3.81], [0, 3.81]);
  d = addLabel(d, "sh1", "LED_ON", 20.32, 10.16);
  return addLabel(d, "sh1", "LED_ON", 40.64, 10.16);
}

function setup(start: ElectronicsDesign) {
  let design = start;
  const labels: string[] = [];
  const registry = { register: (_: Command[]) => () => undefined };
  const view = () => <ElectronicsView design={design} edit={edit} registry={registry} />;
  const edit: EEdit = (change, label) => {
    design = change(design);
    labels.push(label);
    ui.rerender(view());
  };
  const ui = render(view());
  return { labels, design: () => design };
}

/** Right-clicks the schematic at a place on the sheet, in millimetres. */
async function rightClick(at: P2) {
  const canvas = screen.getByRole("img", { name: /^Schematic/ });
  const [scale, ox, oy] = canvas.getAttribute("data-view")!.split(" ").map(Number) as [number, number, number];
  fireEvent.contextMenu(canvas, { clientX: ox + at[0] * scale, clientY: oy - at[1] * scale });
  return screen.findByRole("menu", { name: "Schematic actions" });
}

afterEach(() => act(() => eui.reset()));

describe("the schematic's right-click menu (#788)", () => {
  it("groups the picked parts", async () => {
    act(() => showView("schematic"));
    const s = setup(ledAndResistor());
    const sheet = () => s.design().sheets[0]!;
    act(() => eui.set({ selected: sheet().symbols.map((x) => x.id) }));
    const menu = await rightClick([-25.4, 0]);
    expect(menu).toHaveTextContent("2 things");
    await userEvent.click(screen.getByRole("menuitem", { name: /Group these 2/ }));
    expect(sheet().groups?.[0]?.members).toHaveLength(2);
    expect(s.labels).toEqual(["Group"]);
    expect(screen.getByRole("textbox", { name: "Group name" })).toBeInTheDocument();
  });

  it("picks what is under the pointer when it is not picked yet", async () => {
    act(() => showView("schematic"));
    const s = setup(ledAndResistor());
    const menu = await rightClick([20.32 + 1, 10.16 + 0.5]);
    const label = s.design().sheets[0]!.labels[0]!;
    expect(eui.get().selected).toEqual([label.id]);
    expect(menu).toHaveTextContent("Net label LED_ON");
  });

  it("sets which way a net label's signal goes, and finds the other end", async () => {
    act(() => showView("schematic"));
    const s = setup(ledAndResistor());
    const [a, b] = s.design().sheets[0]!.labels;
    await rightClick([20.32 + 1, 10.16 + 0.5]);
    await userEvent.click(screen.getByRole("menuitemradio", { name: "Goes out" }));
    expect(s.design().sheets[0]!.labels[0]!.shape).toBe("out");
    await rightClick([20.32 + 1, 10.16]);
    expect(screen.getByRole("menuitemradio", { name: "Goes out" })).toHaveAttribute("aria-checked", "true");
    await userEvent.click(screen.getByRole("menuitem", { name: "Show the other end" }));
    expect(eui.get().selected).toEqual([a!.id, b!.id]);
  });

  it("offers places to start things on an empty spot", async () => {
    act(() => showView("schematic"));
    setup(ledAndResistor());
    await rightClick([60, -30]);
    await userEvent.click(screen.getByRole("menuitem", { name: /Start a wire here/ }));
    expect(eui.get().schTool).toBe("wire");
  });
});

describe("schMenuRows", () => {
  it("goes to the other sheet a label's name is on", () => {
    let d = ledAndResistor();
    const two = addSheet(d);
    d = addLabel(two.design, two.id, "VBUS", 0, 0);
    d = addLabel(d, "sh1", "VBUS", 50, 50);
    const sheet = d.sheets[0]!;
    const vbus = sheet.labels.find((l) => l.name === "VBUS")!;
    const ids = schMenuRows({ design: d, sheet, selected: [vbus.id], readOnly: false, canPaste: false }).map((r) => ("label" in r ? r.label : r.id));
    expect(ids).toContain("Show the other end");
    expect(ids).toContain("Make a sheet pin");
  });

  it("offers Ungroup for a whole group and Copy only when read-only", () => {
    const d = ledAndResistor();
    const sheet = { ...d.sheets[0]!, groups: [{ id: "g1", name: "Light", members: d.sheets[0]!.symbols.map((x) => x.id) }] };
    const rows = schMenuRows({ design: d, sheet, selected: sheet.groups[0]!.members, readOnly: false, canPaste: false }).map((r) => r.id);
    expect(rows).toContain("ungroup");
    expect(rows).not.toContain("group");
    const read = schMenuRows({ design: d, sheet, selected: [sheet.symbols[0]!.id], readOnly: true, canPaste: false }).map((r) => r.id);
    expect(read).toEqual(["inspect", "s0", "copy"]);
  });
});
