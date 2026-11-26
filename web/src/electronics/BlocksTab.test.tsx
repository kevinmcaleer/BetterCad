import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyDesign, netlist } from "@bettercad/electronics";
import { STARTER_BLOCKS } from "@bettercad/electronics/library/blocks";
import { buildBlock, placeBlock } from "@bettercad/electronics/blocks";
import { blockFileText, blockFromGroup, pointChoices } from "@bettercad/electronics/ownBlocks";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { inflate, type LibraryPack } from "@bettercad/electronics";
import BlocksTab, { searchBlocks } from "./BlocksTab";
import { ComponentsCard } from "./Components";
import { eui } from "./ui";

vi.mock("./starter", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const pack = JSON.parse(readFileSync(join(__dirname, "../../../packages/electronics/library/starter.json"), "utf8")) as unknown;
  return { loadStarter: () => Promise.resolve(pack), basicsPack: () => pack };
});

afterEach(() => act(() => eui.reset()));

describe("the Blocks tab (#768)", () => {
  it("finds blocks by what they do and by their points", () => {
    expect(searchBlocks(STARTER_BLOCKS, "motor").map((b) => b.id)).toEqual(expect.arrayContaining(["drv8833", "tb6612fng", "stepper-carrier"]));
    expect(searchBlocks(STARTER_BLOCKS, "lipo charger").map((b) => b.id)).toContain("lipo-charger");
    expect(searchBlocks(STARTER_BLOCKS, "sda").map((b) => b.id)).toEqual(expect.arrayContaining(["qwiic", "i2c-level-shifter"]));
    expect(searchBlocks(STARTER_BLOCKS, "")).toHaveLength(19);
  });

  it("shows a block in plain words, then places it as a group with its points", async () => {
    render(<ComponentsCard onClose={() => undefined} />);
    await userEvent.click(screen.getByRole("tab", { name: "Blocks" }));
    const panel = await screen.findByRole("tabpanel", { name: "Blocks" });
    await userEvent.type(within(panel).getByLabelText("Find a block"), "motor");
    await userEvent.click(within(panel).getByRole("button", { name: /Two DC motors \(DRV8833\)/ }));
    const card = within(panel).getByRole("region", { name: "Two DC motors (DRV8833)" });
    expect(card).toHaveTextContent("Drives two small DC motors");
    expect(within(card).getByRole("list", { name: "Connection points" })).toHaveTextContent("VMPower in, 2.7 to 10.8 V, must be joined");
    expect(await within(card).findByRole("img", { name: "Drawing of Two DC motors (DRV8833)" })).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: /DRV8833 datasheet/ })).toHaveAttribute("href", "http://www.ti.com/lit/ds/symlink/drv8833.pdf");
    await userEvent.click(within(card).getByRole("button", { name: "Place" }));
    const ui = eui.get();
    expect(ui).toMatchObject({ schTool: "place", card: null });
    const placed = ui.placingBlock!.place(emptyDesign(), "sh1", [0, 0]);
    expect(placed.design.sheets[0]!.groups![0]).toMatchObject({ name: "Two DC motors (DRV8833)", block: { tag: "MD1" } });
    expect(netlist(placed.design).nets.map((n) => n.name)).toContain("MD1.VM");
  });

  it("opens on the tab used last", async () => {
    const first = render(<ComponentsCard onClose={() => undefined} />);
    await userEvent.click(screen.getByRole("tab", { name: "Blocks" }));
    first.unmount();
    render(<ComponentsCard onClose={() => undefined} />);
    expect(screen.getByRole("tab", { name: "Blocks" })).toHaveAttribute("aria-selected", "true");
    await userEvent.click(screen.getByRole("tab", { name: "Parts" }));
    expect(screen.getByLabelText("Find a part")).toBeInTheDocument();
  });

  it("puts your own blocks on Your blocks, and opens one from a file (#772)", async () => {
    const pack = JSON.parse(readFileSync(join(__dirname, "../../../packages/electronics/library/starter.json"), "utf8")) as LibraryPack;
    const lookup = (id: string) => {
      const p = pack.parts.find((x) => x.id === id);
      return p && inflate(pack, p);
    };
    const d = placeBlock(
      emptyDesign(),
      "sh1",
      buildBlock(
        STARTER_BLOCKS.find((b) => b.id === "qwiic")!,
        lookup,
      ),
      [0, 0],
    ).design;
    const g = d.sheets[0]!.groups![0]!;
    const own = blockFromGroup(d, "sh1", g.id, { name: "Sensor plug", summary: "A socket for sensors.", points: pointChoices(d, "sh1", g.id) })!;
    const saved = vi.fn();
    const removed = vi.fn();
    const { rerender } = render(<BlocksTab own={[]} onSave={saved} onRemove={removed} />);
    const file = new File([blockFileText(own)], "sensor-plug.bcblock.json", { type: "application/json" });
    await userEvent.upload(screen.getByLabelText("A BetterCad block file"), file);
    expect(saved).toHaveBeenCalledWith(own);
    expect(await screen.findByRole("status")).toHaveTextContent("Sensor plug is on Your blocks.");
    rerender(<BlocksTab own={[own]} onSave={saved} onRemove={removed} />);
    const shelf = screen.getByRole("region", { name: "Your blocks" });
    await userEvent.click(within(shelf).getByRole("button", { name: /Sensor plug/ }));
    expect(screen.getByText("Your own block, version 1.")).toBeInTheDocument();
    expect(await screen.findByRole("img", { name: "Drawing of Sensor plug" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(removed).toHaveBeenCalledWith(own.spec.id);
  });
});
