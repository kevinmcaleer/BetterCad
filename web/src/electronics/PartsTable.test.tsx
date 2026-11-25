import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { BASICS, changePart, emptyDesign, placePart, type ElectronicsDesign } from "@bettercad/electronics";
import type { EEdit } from "./actions";
import PartsTable, { fillColumn, tableRows } from "./PartsTable";

function three(): ElectronicsDesign {
  let d = emptyDesign();
  d = placePart(d, "sh1", BASICS.resistor!(), { x: 0, y: 0 }).design;
  d = placePart(d, "sh1", BASICS.capacitor!(), { x: 10, y: 0 }).design;
  d = placePart(d, "sh1", BASICS.resistor!(), { x: 20, y: 0 }).design;
  return placePart(d, "sh1", BASICS.gnd!(), { x: 30, y: 0 }).design;
}

function setup(start: ElectronicsDesign) {
  let design = start;
  const labels: string[] = [];
  const view = () => <PartsTable design={design} edit={edit} onClose={() => undefined} />;
  const edit: EEdit = (change, label) => {
    design = change(design);
    labels.push(label);
    ui.rerender(view());
  };
  const ui = render(view());
  return { labels, design: () => design };
}

describe("the parts table", () => {
  it("lists the real parts in name order", () => {
    setup(three());
    expect(screen.getAllByRole("rowheader").map((r) => r.textContent)).toEqual(["C1", "R1", "R2"]);
  });

  it("changes a value, reading shorthand, when you leave the cell", async () => {
    const { labels, design } = setup(three());
    const value = screen.getByLabelText("Value of R2");
    await userEvent.clear(value);
    await userEvent.type(value, "4k7{Enter}");
    expect(labels).toEqual(["Change R2"]);
    expect(design().parts.find((p) => p.ref === "R2")!.value).toBe("4.7 kΩ");
  });

  it("fills the rows below from a pasted column, as one step", () => {
    const { labels, design } = setup(three());
    fireEvent.paste(screen.getByLabelText("LCSC number of R1"), { clipboardData: { getData: () => "C25804\r\nC17414\r\nC99999\n" } });
    expect(labels).toEqual(["Paste 2 values"]);
    expect(design().parts.map((p) => [p.ref, p.supplier?.lcsc])).toEqual([
      ["R1", "C25804"],
      ["C1", undefined],
      ["R2", "C17414"],
      ["#PWR1", undefined],
    ]);
  });

  it("marks a part as not fitted", async () => {
    const { design } = setup(three());
    await userEvent.click(screen.getByLabelText("C1 is fitted"));
    expect(design().parts.find((p) => p.ref === "C1")!.fitted).toBe(false);
  });

  it("skips blank lines of a pasted column", () => {
    const d = three();
    const ids = tableRows(d).map((p) => p.id);
    const next = fillColumn(d, ids, "mpn", ["", "RC0603", ""]);
    expect(tableRows(next).map((p) => p.supplier?.mpn)).toEqual([undefined, "RC0603", undefined]);
  });

  it("offers LCSC numbers for common resistors and capacitors, and fills them in when you ask (#661)", async () => {
    // 0603 parts at their starting values: 10 kΩ and 100 nF are both common.
    const start = three();
    const small = start.parts.reduce((d, p) => {
      const pkg = d.defs[p.def]?.packages.findIndex((k) => k.footprint.name.includes("0603")) ?? -1;
      return pkg >= 0 ? changePart(d, p.id, { pkg }) : d;
    }, start);
    const { labels, design } = setup(small);
    expect(screen.getByRole("status")).toHaveTextContent(/^C1, R1 and R2 match common parts with an LCSC number, read from JLCPCB on \d{4}-\d{2}-\d{2}\./);
    await userEvent.click(screen.getByRole("button", { name: "Fill in their numbers" }));
    expect(labels).toEqual(["Fill in 3 part numbers"]);
    expect(design().parts.find((p) => p.ref === "R1")!.supplier).toMatchObject({ lcsc: "C25804", mpn: "0603WAF1002T5E" });
    expect(screen.getByLabelText("LCSC number of C1")).toHaveValue("C14663");
    expect(screen.getByRole("status")).toHaveTextContent("Filled in the numbers for C1, R1 and R2. Check each part suits your circuit: C1 is ±10%, 50 V, X7R");
    expect(screen.queryByRole("button", { name: /^Fill in/ })).toBeNull();
  });
});
