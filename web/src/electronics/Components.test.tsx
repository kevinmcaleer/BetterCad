import { act, render, screen, within } from "@testing-library/react";
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
});
