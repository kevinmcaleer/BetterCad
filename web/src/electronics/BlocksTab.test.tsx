import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyDesign, netlist } from "@bettercad/electronics";
import { STARTER_BLOCKS } from "@bettercad/electronics/library/blocks";
import { searchBlocks } from "./BlocksTab";
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
});
