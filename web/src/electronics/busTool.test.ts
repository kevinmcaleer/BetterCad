import { describe, expect, it } from "vitest";
import { emptyDesign, type ElectronicsDesign, type P2 } from "@bettercad/electronics";
import type { EEdit } from "./actions";
import { commitLabel } from "./SchematicCanvas";

describe("the Bus tool's name field (#756)", () => {
  it("names a new bus, renames it, and takes a wire off it", () => {
    let d: ElectronicsDesign = emptyDesign();
    const steps: string[] = [];
    const edit: EEdit = (change, label) => {
      d = change(d);
      steps.push(label);
    };
    const run: P2[] = [
      [0, 10.16],
      [0, -10.16],
    ];
    commitLabel(edit, "sh1", { at: run[0]!, bus: run }, "");
    expect(d.sheets[0]!.buses ?? []).toEqual([]);
    commitLabel(edit, "sh1", { at: run[0]!, bus: run }, "D[0..3]");
    const bus = d.sheets[0]!.buses![0]!;
    expect(bus).toMatchObject({ name: "D[0..3]", pts: run });
    commitLabel(edit, "sh1", { at: run[0]!, id: bus.id, bus: true }, "A[0..3]");
    expect(d.sheets[0]!.buses![0]!.name).toBe("A[0..3]");
    commitLabel(edit, "sh1", { at: [1, 0], entry: bus.id }, "A0");
    expect(d.sheets[0]!.busEntries).toHaveLength(1);
    expect(d.sheets[0]!.labels.map((l) => l.name)).toEqual(["A0"]);
    expect(steps).toEqual(["Bus", "Rename bus", "Take a wire off a bus"]);
  });
});
