import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { BASICS, emptyDesign, placePart, pushToBoard, type ElectronicsDesign } from "@bettercad/electronics";
import type { EEdit } from "./actions";
import Calculators from "./Calculators";

function setup(start: ElectronicsDesign) {
  let design = start;
  const labels: string[] = [];
  const view = () => <Calculators design={design} edit={edit} onClose={() => {}} />;
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
const answer = () => screen.getAllByRole("definition")[0]!.closest("dl")!.textContent;

describe("the calculators (#739)", () => {
  const board = () => pushToBoard(placePart(emptyDesign(), "sh1", BASICS.resistor!(), { x: 0, y: 0 }).design).design;

  it("works out a track's width and makes it a net class's width", async () => {
    const s = setup(board());
    expect(answer()).toContain("0.302 mm");
    type(screen.getByLabelText("Current (A)"), "2");
    expect(answer()).toMatch(/Width0\.7\d+ mm/);
    await userEvent.click(screen.getByRole("button", { name: /^Use 0\.7\d mm$/ }));
    const cls = s.design().board!.classes;
    expect(cls).toHaveLength(1);
    expect(cls[0]!.trackWidth).toBeGreaterThan(0.7);
    expect(s.labels).toEqual(["Set a net class's width from the calculator"]);
  });

  it("works out a via's current, an LED's resistor and a resistor's bands", async () => {
    setup(board());
    const pick = screen.getByLabelText("Work out");
    await userEvent.selectOptions(pick, "Current a via carries");
    expect(answer()).toMatch(/Current\d\.\d+ A/);
    await userEvent.selectOptions(pick, "Resistor for an LED");
    type(screen.getByLabelText("Supply (V)"), "3.3");
    expect(answer()).toContain("Resistor130 Ω");
    await userEvent.selectOptions(pick, "Resistor colour bands");
    expect(answer()).toContain("4.7 kΩ ±5%");
    await userEvent.selectOptions(screen.getByLabelText("Band 3"), "Orange");
    expect(answer()).toContain("47 kΩ ±5%");
    type(screen.getByLabelText("Or type a value (Ω)"), "220");
    await userEvent.click(screen.getByRole("button", { name: "Show these bands" }));
    expect(screen.getByLabelText("Band 1")).toHaveValue("red");
    expect(answer()).toContain("220 Ω ±5%");
  });
});
