import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { BASICS, addWire, emptyDesign, placePart, type ElectronicsDesign } from "@bettercad/electronics";
import type { EEdit } from "./actions";
import ChecksCard from "./Checks";
import { eui } from "./ui";

/** A resistor with one end wired off to nowhere and the other left open. */
function loose(): ElectronicsDesign {
  const d = placePart(emptyDesign(), "sh1", BASICS.resistor!(), { x: 0, y: 0 }).design;
  return addWire(d, "sh1", [0, 3.81], [10.16, 3.81]);
}

function setup(start: ElectronicsDesign, readOnly = false) {
  let design = start;
  const labels: string[] = [];
  const view = () => <ChecksCard design={design} edit={edit} readOnly={readOnly} onClose={() => labels.push("closed")} />;
  const edit: EEdit = (change, label) => {
    design = change(design);
    labels.push(label);
    ui.rerender(view());
  };
  const ui = render(view());
  return { labels, design: () => design };
}

afterEach(() => act(() => eui.reset()));

describe("the rules check card", () => {
  it("says so when there is nothing to check or nothing wrong", () => {
    setup(emptyDesign());
    expect(screen.getByRole("status")).toHaveTextContent("Nothing to check yet. Place some parts first.");
  });

  it("lists what it found in plain words, and goes to one when it is clicked", async () => {
    setup(loose());
    expect(screen.getByRole("status")).toHaveTextContent("1 error and 1 warning to look at.");
    const list = screen.getByRole("list", { name: "Results" });
    const pin = within(list).getByRole("button", { name: /R1 pin 2 is not connected/ });
    expect(pin).toHaveTextContent("Wire it up, or mark it Not connected if you are leaving it open on purpose.");
    await userEvent.click(pin);
    expect(eui.get().spot).toMatchObject({ sheet: "sh1", at: [0, -3.81] });
    expect(eui.get().selected).toHaveLength(1);
    expect(pin).toHaveAttribute("aria-current", "true");
    // Next steps on to the wire's open end, and round again.
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(eui.get().spot).toMatchObject({ at: [10.16, 3.81] });
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(eui.get().spot).toMatchObject({ at: [0, -3.81] });
  });

  it("waives a result with a note and brings it back", async () => {
    const { labels, design } = setup(loose());
    const first = within(screen.getByRole("list", { name: "Results" })).getAllByRole("listitem")[0]!;
    await userEvent.click(within(first).getByRole("button", { name: "Waive" }));
    await userEvent.type(screen.getByLabelText("Why it is fine"), "Test point{Enter}");
    expect(labels).toEqual(["Waive a check"]);
    expect(design().checks?.waived).toEqual({ "pin-open:R1.2": "Test point" });
    expect(screen.getByRole("status")).toHaveTextContent("1 warning to look at. 1 waived.");
    expect(screen.getByRole("button", { name: /Waived.*Test point/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Bring back" }));
    expect(design().checks?.waived).toEqual({});
  });

  it("lets each rule be an error, a warning or ignored, kept with the model", async () => {
    const { design } = setup(loose());
    await userEvent.click(screen.getByRole("button", { name: "Choose the rules" }));
    await userEvent.selectOptions(screen.getByLabelText("A wire ends in mid air"), "Ignore");
    expect(design().checks?.levels).toEqual({ "wire-open": "ignore" });
    expect(screen.getByRole("status")).toHaveTextContent("1 error to look at.");
  });

  it("shows results without the ways to change them on a shared model", () => {
    setup(loose(), true);
    expect(screen.getByRole("list", { name: "Results" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Waive" })).toBeNull();
  });
});
