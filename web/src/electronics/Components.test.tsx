import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BASICS, packOf, type LibraryPack } from "@bettercad/electronics";
import { ComponentsCard } from "./Components";
import { eui } from "./ui";

const starter = JSON.parse(readFileSync(join(__dirname, "../../../packages/electronics/library/starter.json"), "utf8")) as LibraryPack;
const load = vi.hoisted(() => vi.fn());
vi.mock("./starter", () => ({
  loadStarter: load,
  basicsPack: () => {
    const def = BASICS.resistor!();
    return packOf(
      "BetterCad basics",
      "MIT",
      [{ name: "BetterCad basics", licence: "MIT", url: "" }],
      [{ id: "resistor", name: def.name, category: "Basics", prefix: def.prefix, from: 0, def }],
    );
  },
}));

afterEach(() => {
  act(() => eui.reset());
  localStorage.clear();
  load.mockReset();
});

async function open() {
  load.mockResolvedValue(starter);
  render(<ComponentsCard onClose={() => {}} />);
  const card = screen.getByRole("group", { name: "Components options" });
  const parts = await within(card).findByRole("list", { name: "Parts" });
  return { card, parts };
}

describe("the Components panel", () => {
  it("finds parts by what you type and by shelf", async () => {
    const { card, parts } = await open();
    await userEvent.type(within(card).getByLabelText("Find a part"), "qwiic");
    expect(
      within(parts)
        .getAllByRole("button")
        .map((b) => b.getAttribute("aria-label")),
    ).toEqual(["JST SH, 4 pins (Qwiic, STEMMA QT) (JST SH SM04B-SRSS-TB 1x04-1MP)"]);
    await userEvent.clear(within(card).getByLabelText("Find a part"));
    await userEvent.selectOptions(within(card).getByLabelText("Shelf"), "Motor drivers");
    expect(within(parts).getAllByRole("button")).toHaveLength(8);
    await userEvent.type(within(card).getByLabelText("Find a part"), "zzzz");
    expect(within(parts).getByText("Nothing matches. Try a shorter word.")).toBeInTheDocument();
  });

  it("shows a picked part: its drawings, packages, body and where it came from, then places it", async () => {
    const { card, parts } = await open();
    expect(within(card).queryByRole("button", { name: "Place" })).not.toBeInTheDocument();
    await userEvent.type(within(card).getByLabelText("Find a part"), "resistor");
    await userEvent.click(within(parts).getByRole("button", { name: "Resistor (0603)" }));
    const part = within(card).getByRole("region", { name: "Resistor" });
    expect(within(part).getByRole("img", { name: "Symbol of Resistor" })).toBeInTheDocument();
    expect(within(part).getByRole("img", { name: "Footprint R_0603_1608Metric" })).toBeInTheDocument();
    expect(within(part).getByText("Body: a box, 1.6 × 0.83 × 0.45 mm")).toBeInTheDocument();
    await userEvent.selectOptions(within(part).getByLabelText("Package"), "0805");
    expect(within(part).getByRole("img", { name: "Footprint R_0805_2012Metric" })).toBeInTheDocument();
    expect(within(part).getByRole("link", { name: "KiCad libraries 9.0.0" })).toHaveAttribute("href", "https://www.kicad.org/libraries/license/");
    await userEvent.click(within(card).getByRole("button", { name: "Place" }));
    expect(eui.get()).toMatchObject({ schTool: "place", card: null, placingPkg: 2 });
    expect(eui.get().placing).toMatchObject({ name: "Resistor", value: "10 kΩ", source: { licence: "CC-BY-SA 4.0 with exception" } });
  });

  it("places on a double-click, and keeps what you placed and what you starred at the top", async () => {
    const first = await open();
    await userEvent.type(within(first.card).getByLabelText("Find a part"), "bc817");
    await userEvent.dblClick(within(first.parts).getByRole("button", { name: "BC817 (SOT-23)" }));
    expect(eui.get().placing?.name).toBe("BC817");
    await userEvent.click(within(first.parts).getByRole("button", { name: "BC817 (SOT-23)" }));
    const star = within(first.card).getByRole("button", { name: "Star BC817" });
    expect(star).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(star);
    expect(star).toHaveAttribute("aria-pressed", "true");
    await userEvent.clear(within(first.card).getByLabelText("Find a part"));
    expect(within(within(first.card).getByRole("list", { name: "Starred parts" })).getByRole("button", { name: "BC817 (SOT-23)" })).toBeInTheDocument();
    expect(
      within(within(first.card).getByRole("list", { name: "Parts you placed lately" })).getByRole("button", { name: "BC817 (SOT-23)" }),
    ).toBeInTheDocument();
  });

  it("falls back to the built-in basics when the library cannot be fetched, and says so", async () => {
    load.mockRejectedValue(new Error("offline"));
    render(<ComponentsCard onClose={() => {}} />);
    const card = screen.getByRole("group", { name: "Components options" });
    expect(within(card).getByRole("status")).toHaveTextContent("Fetching the parts library.");
    const parts = await within(card).findByRole("list", { name: "Parts" });
    expect(within(card).getByText(/The parts library did not load, so these are the basics\./)).toBeInTheDocument();
    expect(within(parts).getAllByRole("button")).toHaveLength(1);
  });

  it("makes a part of your own, shows it on your shelf, and lets you change and delete it", async () => {
    const { card, parts } = await open();
    await userEvent.click(within(card).getByRole("button", { name: "New part" }));
    const editor = await screen.findByRole("dialog", { name: "New part" });
    expect(within(editor).getByRole("button", { name: "Save to your parts" })).toHaveAttribute("aria-disabled", "true");
    expect(within(editor).getByRole("list", { name: "Checks" })).toHaveTextContent("Give the part a name.");
    await userEvent.type(within(editor).getByLabelText("Name"), "Level shifter");
    await userEvent.click(within(editor).getByRole("tab", { name: "Symbol" }));
    const pins = within(editor).getByLabelText("Pins");
    await userEvent.clear(pins);
    await userEvent.type(pins, "1 VCC power{Enter}2 A io{Enter}3 B io{Enter}9 GND power");
    expect(within(editor).getByRole("list", { name: "Checks" })).toHaveTextContent("Level shifter SO-4 has no pad for pin 9.");
    await userEvent.click(within(editor).getByRole("tab", { name: "Footprint" }));
    await userEvent.selectOptions(within(editor).getByLabelText("Package"), "DIP, through hole");
    const count = within(editor).getByLabelText("Pins");
    await userEvent.clear(count);
    await userEvent.type(count, "10{Enter}");
    expect(within(editor).getByRole("list", { name: "Checks" })).toHaveTextContent("Every pin has a pad. Ready to save.");
    expect(within(editor).getByRole("img", { name: "Footprint Level shifter DIP-10" })).toBeInTheDocument();
    await userEvent.click(within(editor).getByRole("button", { name: "Save to your parts" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(within(card).getByText("Level shifter is in your parts.")).toBeInTheDocument();
    expect(within(card).getByLabelText("Shelf")).toHaveDisplayValue("Your parts (1)");
    expect(within(parts).getByRole("button", { name: "Level shifter (Level shifter DIP-10)" })).toHaveAttribute("aria-pressed", "true");
    expect(within(card).getByText(/^From/)).toHaveTextContent("From You, CC0 1.0 (no rights kept).");

    await userEvent.click(within(card).getByRole("button", { name: "Edit" }));
    const again = await screen.findByRole("dialog", { name: "Edit part" });
    await userEvent.type(within(again).getByLabelText("Shelf"), "Chips");
    await userEvent.click(within(again).getByRole("button", { name: "Save" }));
    expect(JSON.parse(localStorage.getItem("bettercad.electronics.library")!).pack.parts).toMatchObject([{ id: "level-shifter", category: "Chips" }]);

    await userEvent.click(within(card).getByRole("button", { name: "Delete" }));
    expect(within(card).getByText("Level shifter is out of your parts. Designs that use it keep their own copy.")).toBeInTheDocument();
    expect(within(parts).getByText("Nothing matches. Try a shorter word.")).toBeInTheDocument();
  });

  it("makes your own copy of a library part, with its credit kept", async () => {
    const { card, parts } = await open();
    await userEvent.type(within(card).getByLabelText("Find a part"), "bc817");
    await userEvent.click(within(parts).getByRole("button", { name: "BC817 (SOT-23)" }));
    await userEvent.click(within(card).getByRole("button", { name: "Edit a copy" }));
    const editor = await screen.findByRole("dialog", { name: "New part" });
    expect(within(editor).getByLabelText("Name")).toHaveValue("BC817 copy");
    expect(within(editor).getByLabelText("Licence")).toHaveDisplayValue("CC-BY-SA 4.0 with exception");
    expect(within(editor).getByLabelText("Credit")).toHaveValue("KiCad libraries 9.0.0");
    await userEvent.click(within(editor).getByRole("tab", { name: "Footprint" }));
    expect(within(editor).getByLabelText("Package")).toHaveDisplayValue("Keep its footprints (1)");
    await userEvent.click(within(editor).getByRole("button", { name: "Save to your parts" }));
    expect(within(parts).getByRole("button", { name: "BC817 copy (SOT-23)" })).toBeInTheDocument();
  });

  it("imports KiCad files: says what it found and left out, then adds the parts", async () => {
    const { card, parts } = await open();
    await userEvent.click(within(card).getByRole("button", { name: "Import KiCad" }));
    const dialog = await screen.findByRole("dialog", { name: "Import KiCad parts" });
    const data = join(__dirname, "../../../packages/electronics/src/kicad/testdata");
    const file = (path: string, name: string) => new File([readFileSync(join(data, path), "utf8")], name);
    await userEvent.upload(within(dialog).getByLabelText("KiCad files"), [
      file("external/Espressif.kicad_sym", "Espressif.kicad_sym"),
      file("external/SOT-23-3.kicad_mod", "SOT-23-3.kicad_mod"),
    ]);
    expect(await within(dialog).findByRole("status")).toHaveTextContent("Found 1 symbol and 1 footprint: 1 part to add.");
    expect(within(dialog).getByRole("list", { name: "Left out or worth a look" })).toHaveTextContent(
      "ESP32-C3-MINI-1: Its footprint ESP32-C3-MINI-1 was not among the files, so it came in with no footprint.",
    );
    await userEvent.upload(within(dialog).getByLabelText("KiCad files"), [file("external/ESP32-C3-MINI-1.kicad_mod", "ESP32-C3-MINI-1.kicad_mod")]);
    await waitFor(() => expect(within(dialog).getByRole("list", { name: "Parts found" })).toHaveTextContent("ESP32-C3-MINI-1, ESP32-C3-MINI-1"));
    await userEvent.type(within(dialog).getByLabelText("Where they are from"), "Espressif");
    await userEvent.selectOptions(within(dialog).getByLabelText("Their licence"), "CC-BY-SA 4.0 with the KiCad libraries exception");
    await userEvent.click(within(dialog).getByRole("button", { name: "Add 1 part" }));
    expect(within(card).getByText("Added 1 part to your parts.")).toBeInTheDocument();
    await userEvent.click(within(parts).getByRole("button", { name: "ESP32-C3-MINI-1 (ESP32-C3-MINI-1)" }));
    expect(within(card).getByText(/^From/)).toHaveTextContent("From Espressif, CC-BY-SA 4.0 with the KiCad libraries exception.");
  });

  it("opens a library file, and says when a file is not one", async () => {
    const { card } = await open();
    const theirs = packOf(
      "Theirs",
      "x",
      [{ name: "A friend", licence: "MIT", url: "" }],
      [{ id: "friend", name: "Friend's part", category: "Sensors", prefix: "U", from: 0, def: BASICS.resistor!() }],
    );
    const input = within(card).getByLabelText("A BetterCad library file");
    await userEvent.upload(input, new File([JSON.stringify(theirs)], "theirs.bcparts.json", { type: "application/json" }));
    expect(await within(card).findByText("Added 1 part from theirs.bcparts.json.")).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Export" })).toBeInTheDocument();
    await userEvent.upload(input, new File(["{}"], "model.json", { type: "application/json" }));
    expect(await within(card).findByText("model.json is not a BetterCad parts library.")).toBeInTheDocument();
  });
});
