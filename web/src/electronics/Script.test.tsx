import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BASICS, emptyDesign, placePart, type ElectronicsDesign } from "@bettercad/electronics";
import { runScript } from "@bettercad/electronics/script/run";
import type { EEdit } from "./actions";
import Script, { type RunScript } from "./Script";
import { eui } from "./ui";

function design(): ElectronicsDesign {
  let d = emptyDesign();
  for (const part of ["capacitor", "capacitor", "resistor"]) d = placePart(d, "sh1", BASICS[part]!(), { x: d.parts.length * 10, y: 0 }).design;
  return { ...d, parts: d.parts.map((p) => (p.ref === "C2" ? { ...p, value: "1 µF" } : p)) };
}

function setup(start: ElectronicsDesign, run: RunScript) {
  let design = start;
  const labels: string[] = [];
  const view = () => <Script design={design} edit={edit} onClose={() => {}} run={run} />;
  const edit: EEdit = (change, label) => {
    design = change(design);
    labels.push(label);
    ui.rerender(view());
  };
  const ui = render(view());
  return { labels, design: () => design };
}

// The sandbox is a worker; here the same runner runs in the test.
const inline: RunScript = (d, source) => runScript(d, source);

describe("the Script card (#764)", () => {
  beforeEach(() => localStorage.removeItem("bettercad.script"));

  it("runs a starter plug-in, shows what it would change, and keeps it as one step named after it", async () => {
    const run = vi.fn(inline);
    const s = setup(design(), run);
    await userEvent.selectOptions(screen.getByLabelText("Start from"), "Same value for all");
    expect((screen.getByLabelText("JavaScript") as HTMLTextAreaElement).value).toContain('const pattern = "C*"');
    await userEvent.click(screen.getByRole("button", { name: "Run" }));
    await waitFor(() => expect(screen.getByText("Sets C2 to 100 nF.")).toBeTruthy());
    expect(screen.getByRole("log", { name: "Script output" }).textContent).toBe("Set C2 to 100 nF");
    // The part it changes is lit up, and nothing has changed yet.
    expect(eui.get().selected).toEqual([s.design().parts.find((p) => p.ref === "C2")!.id]);
    expect(s.labels).toEqual([]);
    await userEvent.click(screen.getByRole("button", { name: "Keep" }));
    expect(s.labels).toEqual(["Run Same value for all"]);
    expect(s.design().parts.find((p) => p.ref === "C2")!.value).toBe("100 nF");
    expect(screen.queryByRole("button", { name: "Keep" })).toBeNull();
  });

  it("throws a run away, shows a script's error, and keeps the draft", async () => {
    const s = setup(design(), inline);
    const text = screen.getByLabelText("JavaScript");
    fireEvent.change(text, { target: { value: 'bc.setValue("R1", "1k")' } });
    expect(localStorage.getItem("bettercad.script")).toBe('bc.setValue("R1", "1k")');
    await userEvent.click(screen.getByRole("button", { name: "Run" }));
    await userEvent.click(await screen.findByRole("button", { name: "Throw away" }));
    expect(s.labels).toEqual([]);
    expect(s.design().parts.find((p) => p.ref === "R1")!.value).toBe("10 kΩ");

    fireEvent.change(text, { target: { value: 'bc.setValue("R9", "1k")' } });
    await userEvent.click(screen.getByRole("button", { name: "Run" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("There is no part R9"));
    expect(screen.queryByRole("button", { name: "Keep" })).toBeNull();
  });

  it("offers the files a script makes to save, and says when it only looked", async () => {
    setup(design(), inline);
    await userEvent.selectOptions(screen.getByLabelText("Start from"), "Supplier parts list");
    await userEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(await screen.findByRole("button", { name: "Save parts-list.csv" })).toBeTruthy();
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getByText("Changes nothing. It only showed what it found.")).toBeTruthy();
  });

  it("saves a script as your plug-in, opens it again, opens a plug-in file, and deletes one", async () => {
    localStorage.clear();
    setup(design(), inline);
    fireEvent.change(screen.getByLabelText("JavaScript"), { target: { value: 'bc.say("hi")' } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Say hi" } });
    fireEvent.change(screen.getByLabelText("What it does"), { target: { value: "Says hi" } });
    await userEvent.click(screen.getByRole("button", { name: "Save as a plug-in" }));
    expect(screen.getByText("Saved Say hi in Your plug-ins")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save the plug-in" })).toBeTruthy();

    // Another starter, then yours again from Start from.
    await userEvent.selectOptions(screen.getByLabelText("Start from"), "Ring of LEDs");
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Ring of LEDs");
    await userEvent.selectOptions(screen.getByLabelText("Start from"), "Say hi");
    expect((screen.getByLabelText("JavaScript") as HTMLTextAreaElement).value).toBe('bc.say("hi")');
    expect((screen.getByLabelText("What it does") as HTMLInputElement).value).toBe("Says hi");

    const file = new File(["// @bcplugin\n// @name Wave\n// @description Waves\nbc.say('wave')\n"], "wave.bcplugin.js", { type: "text/javascript" });
    await userEvent.upload(screen.getByLabelText("Plug-in file"), file);
    await waitFor(() => expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Wave"));
    expect(screen.getByText("Opened Wave. Save it to keep it in Your plug-ins.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();

    await userEvent.selectOptions(screen.getByLabelText("Start from"), "Say hi");
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByText("Deleted Say hi")).toBeTruthy();
    expect(screen.queryByRole("option", { name: "Say hi" })).toBeNull();
  });
});
