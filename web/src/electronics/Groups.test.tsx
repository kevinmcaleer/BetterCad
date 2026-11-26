import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { BASICS, addWire, emptyDesign, placePart, type ElectronicsDesign } from "@bettercad/electronics";
import type { Command } from "../state/commands";
import { showView, type EEdit } from "./actions";
import ElectronicsView from "./Electronics";
import { schematicScene } from "./sheetScene";
import { hitGroupOutline } from "./hit";
import { eui } from "./ui";

function ledAndResistor(): ElectronicsDesign {
  let d = emptyDesign();
  d = placePart(d, "sh1", BASICS.resistor!(), { x: -25.4, y: 0 }).design;
  d = placePart(d, "sh1", BASICS.led!(), { x: 0, y: 0 }).design;
  return addWire(d, "sh1", [-25.4, 3.81], [0, 3.81]);
}

function setup(start: ElectronicsDesign) {
  let design = start;
  const labels: string[] = [];
  const commands: Command[] = [];
  const registry = {
    register: (list: Command[]) => {
      commands.push(...list);
      return () => void commands.splice(0);
    },
  };
  const view = () => <ElectronicsView design={design} edit={edit} registry={registry} />;
  const edit: EEdit = (change, label) => {
    design = change(design);
    labels.push(label);
    ui.rerender(view());
  };
  const ui = render(view());
  return { labels, commands, design: () => design };
}

afterEach(() => act(() => eui.reset()));

describe("schematic groups (#766)", () => {
  it("groups the selection, asks for its name, and takes it apart again", async () => {
    act(() => showView("schematic"));
    const s = setup(ledAndResistor());
    const tools = screen.getByRole("toolbar", { name: "Schematic tools" });
    expect(within(tools).getByRole("button", { name: "Group" })).toHaveAttribute("aria-disabled", "true");
    const sheet = () => s.design().sheets[0]!;
    act(() => eui.set({ selected: [...sheet().symbols.map((x) => x.id), sheet().wires[0]!.id] }));
    await userEvent.click(within(tools).getByRole("button", { name: "Group" }));
    expect(sheet().groups).toHaveLength(1);
    expect(sheet().groups![0]!.members).toHaveLength(3);
    const field = screen.getByRole("textbox", { name: "Group name" });
    expect(field).toHaveValue("Group 1");
    await userEvent.clear(field);
    await userEvent.type(field, "Status light{Enter}");
    expect(sheet().groups![0]!.name).toBe("Status light");
    expect(s.labels).toEqual(["Group", "Rename group"]);

    // The outline and name go to paper too.
    const scene = schematicScene(s.design(), sheet(), { size: "A4", title: {} as never });
    expect(scene.labels.map((l) => l.text)).toContain("Status light");

    await userEvent.click(within(tools).getByRole("button", { name: "Group" }));
    expect(sheet().groups).toBeUndefined();
    expect(s.labels.at(-1)).toBe("Ungroup");
  });

  it("has Ctrl+G and Ctrl+Shift+G on the keyboard", () => {
    act(() => showView("schematic"));
    const s = setup(ledAndResistor());
    const ids = s.design().sheets[0]!.symbols.map((x) => x.id);
    act(() => eui.set({ selected: ids }));
    act(() => s.commands.find((c) => c.keys?.includes("mod+g"))!.run({} as never));
    expect(s.design().sheets[0]!.groups?.[0]?.members).toEqual(ids);
    act(() => s.commands.find((c) => c.keys?.includes("shift+mod+g"))!.run({} as never));
    expect(s.design().sheets[0]!.groups).toBeUndefined();
  });
});

describe("picking a group by its outline", () => {
  it("finds the group under its edge or its name, not in its middle", () => {
    const o = { id: "g", name: "Motor", box: { x1: 0, y1: 0, x2: 20, y2: 10 } };
    expect(hitGroupOutline([o], [0.2, 5], 0.5)?.id).toBe("g");
    expect(hitGroupOutline([o], [3, 11], 0.5)?.id).toBe("g");
    expect(hitGroupOutline([o], [10, 5], 0.5)).toBeUndefined();
    expect(hitGroupOutline([o], [30, 5], 0.5)).toBeUndefined();
  });
});
