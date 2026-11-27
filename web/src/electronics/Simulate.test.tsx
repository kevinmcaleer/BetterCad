import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BASICS, addLabel, emptyDesign, placePart, placedPins, type ComponentDef, type ElectronicsDesign } from "@bettercad/electronics";
import type { EEdit } from "./actions";
import Simulate, { type RunSpice } from "./Simulate";

function put(d: ElectronicsDesign, def: ComponentDef, nets: Record<string, string>, value?: string): ElectronicsDesign {
  const placed = placePart(d, "sh1", def, { x: d.parts.length * 20, y: 0 }, value ? { value } : {});
  let out = placed.design;
  for (const pin of placedPins(out).filter((p) => p.part === placed.part.id))
    if (nets[pin.pin]) out = addLabel(out, "sh1", nets[pin.pin]!, pin.at[0], pin.at[1]);
  return out;
}

/** VIN through a resistor to OUT, a capacitor to ground, and a header the simulator leaves out. */
function circuit(): ElectronicsDesign {
  let d = emptyDesign();
  d = put(d, BASICS.vin!(), { "1": "VIN" });
  d = put(d, BASICS.gnd!(), { "1": "GND" });
  d = put(d, BASICS.resistor!(), { "1": "VIN", "2": "OUT" }, "1 kΩ");
  d = put(d, BASICS.capacitor!(), { "1": "OUT", "2": "GND" }, "1 µF");
  d = put(d, BASICS["header-2"]!(), { "1": "OUT", "2": "GND" });
  return d;
}

function setup(start: ElectronicsDesign, run: RunSpice) {
  let design = start;
  const labels: string[] = [];
  const view = () => <Simulate design={design} edit={edit} onClose={() => {}} run={run} />;
  const edit: EEdit = (change, label) => {
    design = change(design);
    labels.push(label);
    ui.rerender(view());
  };
  const ui = render(view());
  return { labels, design: () => design };
}
const type = (field: HTMLElement, text: string) => {
  fireEvent.change(field, { target: { value: text } });
  fireEvent.keyDown(field, { key: "Enter" });
};

describe("the Simulate card (#761)", () => {
  it("asks for a probe and an unknown rail's voltage, then runs and draws the probed net", async () => {
    const run = vi.fn<RunSpice>(async (text) => {
      const out = /^R1 \S+ (\S+) /m.exec(text)![1]!;
      return {
        vectors: [
          { name: "time", values: [0, 0.005, 0.01] },
          { name: `v(${out})`, values: [0, 3.2, 4.9] },
        ],
        errors: [],
      };
    });
    const s = setup(circuit(), run);
    const go = screen.getByRole("button", { name: "Run" });
    expect(go.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByText("Give VIN a voltage first.")).toBeTruthy();
    type(screen.getByLabelText("VIN (V)"), "5");
    expect(s.design().sim?.rails).toEqual({ VIN: 5 });
    expect(screen.getByText("Probe a net first.")).toBeTruthy();
    await userEvent.selectOptions(screen.getByLabelText("Add a probe"), "OUT");
    expect(s.design().sim?.probes).toEqual(["OUT"]);
    // The header has no model: it is listed, not run.
    expect(screen.getByText(/Left out of the run: 1 part/)).toBeTruthy();
    expect(screen.getByText("J1: The simulator has no model for it")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Run" }));
    await waitFor(() => expect(screen.getByRole("img", { name: /Voltages over 10 ms: OUT from 0 V to 4\.9 V/ })).toBeTruthy());
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]![0]).toMatch(/DC 5$/m);
    expect(s.labels).toEqual(["Set VIN to 5 V", "Probe OUT"]);
  });

  it("drives a net with a square wave, sets how long it runs, and shows the simulator's errors", async () => {
    const run = vi.fn<RunSpice>(async () => ({ vectors: [], errors: ["singular matrix"] }));
    const s = setup({ ...circuit(), sim: { rails: { VIN: 5 }, probes: ["OUT"] } }, run);
    await userEvent.click(screen.getByRole("button", { name: "Drive a net" }));
    expect(s.design().sim?.drives).toMatchObject([{ net: "OUT", wave: "pulse", low: 0, high: 5, freq: 1000 }]);
    await userEvent.selectOptions(screen.getByLabelText("Net"), "VIN");
    await userEvent.selectOptions(screen.getByLabelText("Signal"), "Sine wave");
    type(screen.getByLabelText("Frequency (Hz)"), "50");
    expect(s.design().sim?.drives).toMatchObject([{ net: "VIN", wave: "sine", freq: 50 }]);
    type(screen.getByLabelText("Run for (ms)"), "40");
    expect(s.design().sim?.stop).toBeCloseTo(0.04);

    await userEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(run.mock.calls[0]![0]).toMatch(/SIN\(2\.5 2\.5 50\)/);
    expect(run.mock.calls[0]![0]).toMatch(/^\.tran 0\.00008 0\.04$/m);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("singular matrix"));

    // The driven net's own Remove, below the probe's.
    await userEvent.click(screen.getAllByRole("button", { name: "Remove" }).at(-1)!);
    expect(s.design().sim?.drives).toEqual([]);
  });
});
