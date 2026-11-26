import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { emptyDesign, inflate, pushToBoard, type LibraryPack } from "@bettercad/electronics";
import { buildBlock, placeBlock } from "@bettercad/electronics/blocks";
import { STARTER_BLOCKS } from "@bettercad/electronics/library/blocks";
import BoardProps from "./BoardProps";
import { eui } from "./ui";

const pack = JSON.parse(readFileSync(join(__dirname, "../../../packages/electronics/library/starter.json"), "utf8")) as LibraryPack;
const lookup = (id: string) => {
  const p = pack.parts.find((x) => x.id === id);
  return p && inflate(pack, p);
};

afterEach(() => eui.set({ selected: [], net: null }));

describe("a block's parts on the board (#774)", () => {
  it("picks the whole group from one of its parts", async () => {
    const placed = placeBlock(
      emptyDesign(),
      "sh1",
      buildBlock(
        STARTER_BLOCKS.find((b) => b.id === "qwiic")!,
        lookup,
      ),
      [0, 0],
    ).design;
    const design = pushToBoard(placed).design;
    const [first] = design.parts;
    render(<BoardProps design={design} edit={() => {}} part={first!.id} selected={[first!.id]} />);
    await userEvent.click(screen.getByRole("button", { name: "Pick the group: Qwiic / STEMMA QT connector" }));
    expect([...eui.get().selected].sort()).toEqual(design.parts.map((p) => p.id).sort());
  });
});
