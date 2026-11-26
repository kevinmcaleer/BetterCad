import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { ElectronicsDesign } from "@bettercad/electronics";
import { sampleBoard } from "@bettercad/electronics/sample";
import { netLength } from "@bettercad/electronics/pcb/shove";
import type { EEdit } from "./actions";
import BoardProps from "./BoardProps";

function setup(start: ElectronicsDesign, selected: string[]) {
  let design = start;
  const labels: string[] = [];
  const edit: EEdit = (change, label) => {
    design = change(design);
    labels.push(label);
    ui.rerender(<BoardProps design={design} edit={edit} selected={selected} />);
  };
  const ui = render(<BoardProps design={design} edit={edit} selected={selected} />);
  return { labels, design: () => design };
}

describe("length matching in the inspector (#745)", () => {
  it("matches the nets of the tracks picked, then says they are matched", async () => {
    const d = sampleBoard();
    const ids = ["MOTOR_A1", "MOTOR_A2"].map((n) => d.board!.tracks.find((t) => t.net === n)!.id);
    const s = setup(d, ids);
    await userEvent.click(await screen.findByRole("button", { name: "Match 2 lengths" }));
    expect(s.labels).toEqual(["Match lengths"]);
    expect(Math.abs(netLength(s.design(), "MOTOR_A1") - netLength(s.design(), "MOTOR_A2"))).toBeLessThanOrEqual(0.1);
    expect(screen.getByRole("status")).toHaveTextContent(/All 2 are within 0.1 mm of/);
    expect(s.design().board!.matched).toHaveLength(1);
  });
});
