import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BASICS, addWire, emptyDesign, netlist, placePart, pushToBoard, type ElectronicsDesign } from "@bettercad/electronics";
import type { Command } from "../state/commands";
import { showView, type EEdit } from "./actions";
import { forgetFiles, keepFile } from "./partBlobs";
import ElectronicsView, { ElectronicsProps, ElectronicsRibbon, onDesign } from "./Electronics";
import { eui } from "./ui";

// The starter library is fetched in the app; here it is read from the file the app would fetch.
vi.mock("./starter", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const pack = JSON.parse(readFileSync(join(__dirname, "../../../packages/electronics/library/starter.json"), "utf8")) as unknown;
  return { loadStarter: () => Promise.resolve(pack), basicsPack: () => pack };
});

/** A resistor and an LED, top pins wired together. */
function ledAndResistor(): ElectronicsDesign {
  let d = emptyDesign();
  const sheet = d.sheets[0]!.id;
  d = placePart(d, sheet, BASICS.resistor!(), { x: -25.4, y: 0 }).design;
  d = placePart(d, sheet, BASICS.led!(), { x: 0, y: 0 }).design;
  return addWire(d, sheet, [-25.4, 3.81], [0, 3.81]);
}

/** The view over a design held here, as the editor's history store would hold it. */
function setup(start?: ElectronicsDesign, opts: { readOnly?: boolean; ribbon?: boolean } = {}) {
  let design = start;
  const labels: string[] = [];
  const commands: Command[] = [];
  const registry = {
    register: (list: Command[]) => {
      commands.push(...list);
      return () => void commands.splice(0);
    },
  };
  const view = () => <ElectronicsView design={design} edit={edit} registry={registry} {...opts} />;
  const edit: EEdit = (change, label) => {
    design = change(design ?? emptyDesign());
    labels.push(label);
    ui.rerender(view());
  };
  const ui = render(view());
  return { labels, commands, design: () => design };
}

afterEach(() => act(() => eui.reset()));

describe("the electronics workspace", () => {
  it("opens on an empty schematic that says how to start", async () => {
    act(() => showView("schematic"));
    setup();
    expect(screen.getByRole("img", { name: /^Schematic/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Schematic" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Start with a part.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Read the electronics guide" })).toHaveAttribute("href", expect.stringMatching(/docs\/electronics-guide\.md$/));
    await userEvent.click(within(screen.getByText("Start with a part.").parentElement!).getByRole("button", { name: /Components/ }));
    const card = await screen.findByRole("group", { name: "Components options" });
    await userEvent.type(within(card).getByLabelText("Find a part"), "led");
    await userEvent.click(await within(card).findByRole("button", { name: /^LED \(0603\)/ }));
    expect(within(card).getByRole("img", { name: "Symbol of LED" })).toBeInTheDocument();
    expect(within(card).getByText(/^From/)).toHaveTextContent("From KiCad libraries 9.0.0, CC-BY-SA 4.0 with exception.");
    await userEvent.selectOptions(within(card).getByLabelText("Package"), "LED D5.0mm");
    await userEvent.click(within(card).getByRole("button", { name: "Place" }));
    expect(eui.get()).toMatchObject({ schTool: "place", card: null });
    expect(eui.get().placing?.name).toBe("LED");
    expect(eui.get().placing?.packages[eui.get().placingPkg]?.footprint.name).toBe("LED_D5.0mm");
    expect(screen.getByRole("status", { name: "Electronics status" })).toHaveTextContent("Placing LED. Click to place, Esc to stop.");
  });

  it("says what is not connected, and lists what Push to PCB will do before it does it", async () => {
    act(() => showView("schematic"));
    const s = setup(ledAndResistor());
    expect(screen.getByRole("status", { name: "Electronics status" })).toHaveTextContent("2 pins or wire ends are not connected");
    await userEvent.click(screen.getByRole("button", { name: "Push to PCB" }));
    const card = screen.getByRole("group", { name: "Push to PCB options" });
    expect(
      within(card)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["Make a 2-layer board, 1.6 mm thick", "Add D1 beside the board", "Add R1 beside the board"]);
    await userEvent.click(within(card).getByRole("button", { name: "Make the board" }));
    expect(s.labels).toEqual(["Push to PCB"]);
    expect(s.design()?.board?.placements).toHaveLength(2);
    // The board is made, and you are taken to it.
    expect(screen.getByRole("tab", { name: "PCB" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByRole("img", { name: /^PCB/ })).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Electronics status" })).toHaveTextContent("1 connection left to route");
    expect(screen.getByRole("status", { name: "Electronics status" })).toHaveTextContent("Board 50 × 40 mm");
  });

  it("marks the PCB tab when the schematic has moved on, and the strip opens the list of changes", async () => {
    const pushed = pushToBoard(ledAndResistor()).design;
    const more = placePart(pushed, pushed.sheets[0]!.id, BASICS.capacitor!(), { x: 25.4, y: 0 }).design;
    act(() => showView("schematic"));
    setup(more);
    expect(within(screen.getByRole("tab", { name: /^PCB/ })).getByRole("img", { name: "1 change behind the schematic" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "PCB is 1 change behind" }));
    expect(within(screen.getByRole("group", { name: "Update the board options" })).getByRole("listitem")).toHaveTextContent("Add C1 beside the board");
  });

  it("carries the selected part from the schematic to the board and back", () => {
    const d = pushToBoard(ledAndResistor()).design;
    const r1 = d.parts.find((p) => p.ref === "R1")!;
    const symbol = d.sheets[0]!.symbols.find((y) => y.part === r1.id)!;
    act(() => {
      showView("schematic", d);
      eui.set({ selected: [symbol.id] });
    });
    act(() => showView("pcb", d));
    expect(eui.get().selected).toEqual([r1.id]);
    act(() => showView("schematic", d));
    expect(eui.get().selected).toEqual([symbol.id]);
    act(() => showView(null, d));
    expect(eui.get()).toMatchObject({ view: null, selected: [] });
  });

  it("the PCB with no board sends you to the schematic", async () => {
    act(() => showView("pcb"));
    setup(ledAndResistor());
    expect(screen.getByText("There is no board yet.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Go to the schematic" }));
    expect(eui.get().view).toBe("schematic");
  });

  it("shows the layers on the board, picks the one to work on and hides one", async () => {
    act(() => showView("pcb"));
    setup(pushToBoard(ledAndResistor()).design);
    const layers = await screen.findByRole("region", { name: "Layers" });
    await userEvent.click(within(layers).getByRole("button", { name: "Bottom copper" }));
    expect(eui.get().layer).toBe("bottom");
    await userEvent.click(within(layers).getByRole("button", { name: "Show top silkscreen" }));
    expect(eui.get().hidden).toEqual(["silk-top"]);
  });

  it("registers its shortcuts while it is open: 1, 2 and 3 switch views, W arms the wire", () => {
    act(() => showView("schematic"));
    const s = setup(ledAndResistor());
    const key = (k: string) => s.commands.find((c) => c.keys?.includes(k))!;
    expect(s.commands.every((c) => c.scope === "electronics")).toBe(true);
    act(() => key("w").run({} as never));
    expect(eui.get().schTool).toBe("wire");
    act(() => key("2").run({} as never));
    expect(eui.get().view).toBe("pcb");
    act(() => key("3").run({} as never));
    expect(eui.get().view).toBeNull();
  });

  it("copies and pastes with fresh names, duplicates, and renumbers in one step", async () => {
    act(() => showView("schematic"));
    const { labels, commands, design } = setup(ledAndResistor());
    const run = (id: string) => act(() => void commands.find((c) => c.id === id)!.run({} as never));
    const symbols = () => design()!.sheets[0]!.symbols;
    act(() => eui.set({ selected: [symbols()[0]!.id] }));
    run("electronics.copy");
    run("electronics.paste");
    expect(design()!.parts.map((p) => p.ref)).toEqual(["R1", "D1", "R2"]);
    // The copy is what is picked now, so Duplicate copies the copy.
    await act(async () => {});
    expect(eui.get().selected).toEqual([symbols()[2]!.id]);
    await userEvent.click(within(screen.getByRole("toolbar", { name: "Schematic tools" })).getByRole("button", { name: "Duplicate" }));
    expect(design()!.parts.map((p) => p.ref)).toEqual(["R1", "D1", "R2", "R3"]);
    expect(symbols()[3]).toMatchObject({ x: symbols()[2]!.x + 5.08, y: symbols()[2]!.y - 5.08 });
    run("electronics.renumber");
    expect(labels).toEqual(["Paste", "Duplicate", "Renumber"]);
    expect(
      design()!
        .parts.map((p) => p.ref)
        .sort(),
    ).toEqual(["D1", "R1", "R2", "R3"]);
  });

  it("opens the rules check from the tools and from the status strip, and shows what it found before a push", async () => {
    act(() => showView("schematic"));
    setup(ledAndResistor());
    const tools = within(screen.getByRole("toolbar", { name: "Schematic tools" }));
    await userEvent.click(tools.getByRole("button", { name: "Rules check" }));
    const card = await screen.findByRole("group", { name: "Rules check options" });
    expect(within(card).getByRole("status")).toHaveTextContent("2 errors to look at.");
    await userEvent.click(within(card).getByRole("button", { name: "Close" }));
    await userEvent.click(within(screen.getByRole("status", { name: "Electronics status" })).getByRole("button", { name: /not connected/ }));
    expect(await screen.findByRole("group", { name: "Rules check options" })).toBeInTheDocument();
    await userEvent.click(tools.getByRole("button", { name: "Push to PCB" }));
    const push = screen.getByRole("group", { name: "Push to PCB options" });
    expect(await within(push).findByText(/The rules check found 2 errors\./)).toBeInTheDocument();
    expect(within(push).getByRole("button", { name: "Make the board" })).toBeEnabled();
    await userEvent.click(tools.getByRole("button", { name: "Parts table" }));
    expect(await screen.findByRole("dialog", { name: "Parts" })).toBeInTheDocument();
  });

  it("a view-only model can look but not change", () => {
    act(() => showView("schematic"));
    setup(ledAndResistor(), { readOnly: true });
    for (const name of ["Components", "Wire", "Net label", "Push to PCB"])
      expect(screen.getByRole("button", { name })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: "Fit" })).toBeEnabled();
  });

  it("keeps the compact tools away while the ribbon shows them", () => {
    act(() => showView("schematic"));
    setup(ledAndResistor(), { ribbon: true });
    expect(screen.queryByRole("toolbar", { name: "Schematic tools" })).not.toBeInTheDocument();
    render(<ElectronicsRibbon />);
    expect(screen.getByRole("button", { name: /^Wire/ })).toBeInTheDocument();
  });
});

describe("the part card", () => {
  it("edits the picked part's value and package, and lists its pins with their nets", () => {
    let d = ledAndResistor();
    const r1 = d.parts.find((p) => p.ref === "R1")!;
    const symbol = d.sheets[0]!.symbols.find((y) => y.part === r1.id)!;
    const edit = vi.fn<EEdit>((change) => {
      d = change(d);
    });
    act(() => {
      showView("schematic", d);
      eui.set({ selected: [symbol.id] });
    });
    render(<ElectronicsProps design={d} edit={edit} />);
    fireEvent.change(screen.getByLabelText("Value"), { target: { value: "330 Ω" } });
    expect(edit).toHaveBeenLastCalledWith(expect.any(Function), "Change the value", expect.stringContaining(r1.id));
    expect(d.parts.find((p) => p.id === r1.id)?.value).toBe("330 Ω");
    expect((screen.getByLabelText("Package") as HTMLSelectElement).options.length).toBeGreaterThan(1);
    const net = netlist(d).of.get(`${r1.id}:1`)!;
    expect(screen.getByText(net)).toBeInTheDocument();
    expect(screen.getByText("Not connected")).toBeInTheDocument();
  });

  it("reads shorthand when you leave the value, and marks a part as not fitted", async () => {
    let d = ledAndResistor();
    const edit: EEdit = (change) => {
      d = change(d);
    };
    act(() => {
      showView("schematic", d);
      eui.set({ selected: [d.sheets[0]!.symbols[0]!.id] });
    });
    const ui = render(<ElectronicsProps design={d} edit={edit} />);
    fireEvent.change(screen.getByLabelText("Value"), { target: { value: "4k7" } });
    ui.rerender(<ElectronicsProps design={d} edit={edit} />);
    fireEvent.blur(screen.getByLabelText("Value"));
    expect(d.parts[0]!.value).toBe("4.7 kΩ");
    await userEvent.click(screen.getByLabelText("Fitted"));
    expect(d.parts[0]!.fitted).toBe(false);
    fireEvent.change(screen.getByLabelText("Maker's part number"), { target: { value: "RC0603FR-074K7L" } });
    expect(d.parts[0]!.supplier).toEqual({ mpn: "RC0603FR-074K7L" });
  });

  it("with nothing picked, sums the design up", () => {
    act(() => showView("schematic"));
    render(<ElectronicsProps design={pushToBoard(ledAndResistor()).design} edit={() => {}} />);
    expect(screen.getByText("50 × 40 mm, 2 layers")).toBeInTheDocument();
  });
});

describe("onDesign", () => {
  it("starts a design on the first change and leaves the model alone when nothing changes", () => {
    const doc = { features: [] } as never as Parameters<ReturnType<typeof onDesign>>[0];
    expect(onDesign((d) => d)(doc).electronics?.sheets).toHaveLength(1);
    const made = onDesign((d) => placePart(d, d.sheets[0]!.id, BASICS.led!(), { x: 0, y: 0 }).design)(doc);
    expect(made.electronics?.parts).toHaveLength(1);
    expect(onDesign((d) => d)(made)).toBe(made);
  });

  it("brings the file of a part's STEP body into the model with the part (#628)", () => {
    const doc = { features: [], blobs: { other: "abc" } } as never as Parameters<ReturnType<typeof onDesign>>[0];
    const led = BASICS.led!();
    const def = {
      ...led,
      packages: led.packages.map((k) => ({ ...k, model: { source: { kind: "step" as const, blob: "bfile", size: [2, 1, 1] as [number, number, number] } } })),
    };
    const place = onDesign((d) => placePart(d, d.sheets[0]!.id, def, { x: 0, y: 0 }).design);
    // Not held in this browser: the part still places, and its body is a box until the file turns up.
    expect(place(doc).blobs).toEqual({ other: "abc" });
    keepFile("bfile", "U1RFUA==");
    const made = place(doc);
    expect(made.blobs).toEqual({ other: "abc", bfile: "U1RFUA==" });
    // Once it is in the model it is left alone.
    expect(onDesign((d) => ({ ...d }))(made).blobs).toBe(made.blobs);
    forgetFiles();
  });
});
