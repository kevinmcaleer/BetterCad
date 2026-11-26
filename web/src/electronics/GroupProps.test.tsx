import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { emptyDesign, inflate, netlist, placePart, type ElectronicsDesign, type LibraryPack } from "@bettercad/electronics";
import { buildBlock, placeBlock } from "@bettercad/electronics/blocks";
import { STARTER_BLOCKS } from "@bettercad/electronics/library/blocks";
import type { EEdit } from "./actions";
import { ElectronicsProps } from "./Electronics";
import { eui } from "./ui";

const pack = JSON.parse(readFileSync(join(__dirname, "../../../packages/electronics/library/starter.json"), "utf8")) as LibraryPack;
const lookup = (id: string) => {
  const p = pack.parts.find((x) => x.id === id);
  return p && inflate(pack, p);
};

function setup() {
  const pico = placePart(emptyDesign(), "sh1", lookup("pico")!, { x: 0, y: 0 });
  let design: ElectronicsDesign = placeBlock(
    pico.design,
    "sh1",
    buildBlock(
      STARTER_BLOCKS.find((b) => b.id === "qwiic")!,
      lookup,
    ),
    [60, 40],
  ).design;
  const labels: string[] = [];
  const view = () => <ElectronicsProps design={design} edit={edit} />;
  const edit: EEdit = (change, label) => {
    design = change(design);
    labels.push(label);
    ui.rerender(view());
  };
  const ui = render(view());
  act(() => eui.set({ view: "schematic", selected: design.sheets[0]!.groups![0]!.members }));
  return { design: () => design, labels, pico: pico.part.id };
}

afterEach(() => act(() => eui.reset()));

describe("a block in the inspector (#768, #770)", () => {
  it("says what is inside and which points are joined, and joins I2C and power from Connect to…", async () => {
    const s = setup();
    expect(await screen.findByText("QW1 · Qwiic / STEMMA QT connector")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Inside" })).toHaveTextContent("SDA pull-up");
    expect(screen.getByRole("status")).toHaveTextContent("1 of 4 points joined.");
    await userEvent.click(screen.getByRole("button", { name: "Join I2C" }));
    expect(screen.getByText(/^Joined SDA to .* GPIO0 and SCL to .* GPIO1\.$/)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("3 of 4 points joined.");
    await userEvent.click(screen.getByRole("button", { name: "Connect 3V3 to…" }));
    const options = screen.getByRole("list", { name: "Where 3V3 can go" });
    await userEvent.click(within(options).getAllByRole("button")[0]!);
    expect(s.labels).toEqual(["Join I2C", "Connect 3V3"]);
    expect(netlist(s.design()).of.get(`${s.pico}:36`)).toBe("QW1.3V3");
    expect(screen.getByRole("status")).toHaveTextContent("4 of 4 points joined.");
  });

  it("saves the block as your own, and the group becomes a copy of it (#772)", async () => {
    localStorage.clear();
    const s = setup();
    await userEvent.click(await screen.findByRole("button", { name: "Save as block" }));
    const form = screen.getByRole("form", { name: "Save as block" });
    const name = within(form).getByRole("textbox", { name: "Name" });
    await userEvent.clear(name);
    await userEvent.type(name, "Sensor plug");
    expect(within(form).getByRole("checkbox", { name: "SDA" })).toBeChecked();
    expect(within(form).getByRole("combobox", { name: "What GND is" })).toHaveValue("ground");
    await userEvent.click(within(form).getByRole("button", { name: "Save block" }));
    expect(s.labels).toEqual(["Save as block"]);
    expect(s.design().sheets[0]!.groups![0]).toMatchObject({ name: "Sensor plug", block: { version: 1, tag: "QW1" } });
    const kept = JSON.parse(localStorage.getItem("bettercad.electronics.library")!) as { blocks: { spec: { name: string; shelf: string } }[] };
    expect(kept.blocks.map((b) => b.spec)).toMatchObject([{ name: "Sensor plug", shelf: "Your blocks" }]);
    expect(await screen.findByRole("button", { name: "Save a new version" })).toBeInTheDocument();
  });
});
