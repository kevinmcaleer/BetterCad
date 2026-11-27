import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BASICS, addLabel, addWire, emptyDesign, netlist, placePart, pushToBoard, type ElectronicsDesign } from "@bettercad/electronics";
import { addTrack } from "@bettercad/electronics/pcb/route";
import type { EEdit } from "./actions";
import { ElectronicsProps } from "./Electronics";
import { eui } from "./ui";

function setup(start: ElectronicsDesign) {
  let design = start;
  const labels: string[] = [];
  const edit: EEdit = (change, label) => {
    design = change(design);
    labels.push(label);
    ui.rerender(<ElectronicsProps design={design} edit={edit} />);
  };
  const ui = render(<ElectronicsProps design={design} edit={edit} />);
  return { labels, design: () => design };
}
const type = (field: HTMLElement, text: string) => {
  fireEvent.change(field, { target: { value: text } });
  fireEvent.keyDown(field, { key: "Enter" });
  fireEvent.blur(field);
};

afterEach(() => act(() => eui.reset()));

describe("a part's pins in the inspector", () => {
  it("names the net on a pin, and renames a named net with its copper", async () => {
    const r = placePart(emptyDesign(), "sh1", BASICS.resistor!(), { x: 0, y: 0 });
    let d = r.design;
    act(() => eui.set({ view: "schematic", selected: [r.symbol.id] }));
    const s = setup(d);
    const pin1 = await screen.findByLabelText(/^Net on pin 1/);
    expect(pin1).toHaveValue("");
    expect(pin1).toHaveAttribute("placeholder", "Not connected");
    type(pin1, "LED");
    expect(s.labels).toEqual(["Join pin 1 to LED"]);
    expect(netlist(s.design()).of.get(`${r.part.id}:1`)).toBe("LED");
    expect(await screen.findByLabelText(/^Net on pin 1/)).toHaveValue("LED");

    // On the board: the track on the net takes the new name.
    d = pushToBoard(s.design()).design;
    d = addTrack(d, "LED", "top", [
      [0, 0],
      [4, 0],
    ]);
    act(() => eui.set({ view: "pcb", selected: [r.part.id] }));
    const t = setup(d);
    type((await screen.findAllByLabelText(/^Net on pin 1/)).at(-1)!, "STATUS");
    expect(t.labels).toEqual(["Rename net LED to STATUS"]);
    expect(t.design().board!.tracks.map((x) => x.net)).toEqual(["STATUS"]);
  });

  it("renames a net from its own Name field", async () => {
    let d = placePart(emptyDesign(), "sh1", BASICS.resistor!(), { x: 0, y: 0 }).design;
    d = addWire(d, "sh1", [50, 50], [60, 50]);
    d = addLabel(d, "sh1", "SIG", 60, 50);
    act(() => eui.set({ view: "schematic", selected: [d.sheets[0]!.wires.at(-1)!.id] }));
    const s = setup(d);
    expect(await screen.findByRole("group", { name: "Net SIG" })).toBeInTheDocument();
    type(screen.getByLabelText("Name"), "SDA");
    expect(s.labels).toEqual(["Rename net SIG to SDA"]);
    expect(s.design().sheets[0]!.labels.map((l) => l.name)).toEqual(["SDA"]);
  });
});
