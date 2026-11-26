import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { changePart, emptyDesign, inflate, type ElectronicsDesign, type LibraryPack } from "@bettercad/electronics";
import { buildBlock } from "@bettercad/electronics/blocks";
import { placeBlockKept } from "@bettercad/electronics/blockUpdate";
import { STARTER_BLOCKS } from "@bettercad/electronics/library/blocks";
import { blockFromGroup, markAsBlock, pointChoices } from "@bettercad/electronics/ownBlocks";
import type { EEdit } from "./actions";
import { staleBlocks } from "./blockVersions";
import { ElectronicsProps } from "./Electronics";
import { eui } from "./ui";

const pack = JSON.parse(readFileSync(join(__dirname, "../../../packages/electronics/library/starter.json"), "utf8")) as LibraryPack;
const lookup = (id: string) => {
  const p = pack.parts.find((x) => x.id === id);
  return p && inflate(pack, p);
};

/** A design with your own block placed at version 1, and version 2 of it in Your blocks. */
function setup(handEdit = false) {
  localStorage.clear();
  let design: ElectronicsDesign = placeBlockKept(
    emptyDesign(),
    "sh1",
    buildBlock(
      STARTER_BLOCKS.find((b) => b.id === "qwiic")!,
      lookup,
    ),
    [0, 0],
  ).design;
  const g = design.sheets[0]!.groups![0]!;
  const v1 = blockFromGroup(design, "sh1", g.id, { name: "Sensor plug", summary: "", points: pointChoices(design, "sh1", g.id) })!;
  design = markAsBlock(design, "sh1", g.id, v1);
  const v2 = {
    spec: { ...v1.spec, version: 2, changes: "Stronger pull-ups", parts: v1.spec.parts.map((p) => (p.ref.startsWith("R") ? { ...p, value: "2.2 kΩ" } : p)) },
    defs: v1.defs,
  };
  localStorage.setItem(
    "bettercad.electronics.library",
    JSON.stringify({ pack: { pack: 1, name: "Your parts", parts: [], credits: [], symbols: {}, footprints: {} }, removed: [], blocks: [v2] }),
  );
  if (handEdit) design = changePart(design, design.parts.find((p) => p.ref === "R1")!.id, { value: "10 kΩ" });
  const labels: string[] = [];
  const view = () => <ElectronicsProps design={design} edit={edit} />;
  const edit: EEdit = (change, label) => {
    design = change(design);
    labels.push(label);
    ui.rerender(view());
  };
  const ui = render(view());
  act(() => eui.set({ view: "schematic", selected: design.sheets[0]!.groups![0]!.members }));
  return { design: () => design, labels };
}

afterEach(() => act(() => eui.reset()));

describe("a placed block's Update (#773)", () => {
  it("shows the badge on the outline and the card, says what changed, and updates", async () => {
    const s = setup();
    expect([...staleBlocks(s.design(), s.design().sheets[0]!)]).toHaveLength(1);
    const update = await screen.findByRole("region", { name: "Update" });
    expect(update).toHaveTextContent("Version 2 of this block is out. You have version 1.");
    expect(within(update).getByRole("list", { name: "What changed" })).toHaveTextContent("Stronger pull-ups");
    expect(within(update).getByRole("list", { name: "What changed" })).toHaveTextContent("R1 becomes 2.2 kΩ, from 4.7 kΩ");
    await userEvent.click(within(update).getByRole("button", { name: "Update" }));
    expect(s.labels).toEqual(["Update Sensor plug"]);
    expect(
      s
        .design()
        .parts.filter((p) => p.ref.startsWith("R"))
        .map((p) => p.value),
    ).toEqual(["2.2 kΩ", "2.2 kΩ"]);
    expect(staleBlocks(s.design(), s.design().sheets[0]!).size).toBe(0);
  });

  it("asks before replacing changes made inside", async () => {
    const s = setup(true);
    const update = await screen.findByRole("region", { name: "Update" });
    expect(update).toHaveTextContent("Updating replaces your changes.");
    await userEvent.click(within(update).getByRole("button", { name: "Update" }));
    expect(s.labels).toEqual([]);
    await userEvent.click(screen.getByRole("button", { name: "Keep my copy" }));
    expect(s.labels).toEqual([]);
    await userEvent.click(within(screen.getByRole("region", { name: "Update" })).getByRole("button", { name: "Update" }));
    await userEvent.click(screen.getByRole("button", { name: "Replace my changes" }));
    expect(s.labels).toEqual(["Update Sensor plug"]);
  });
});
