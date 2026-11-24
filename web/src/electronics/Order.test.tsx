import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BASICS, changePart, emptyDesign, placePart, pushToBoard, type ElectronicsDesign } from "@bettercad/electronics";
import { orderPack } from "@bettercad/electronics/fab/pack";
import { addHole, addTrack, addVia, setPlacement } from "@bettercad/electronics/pcb/route";
import { unzip } from "@bettercad/kernel/zip";
import { kindOf, readLayers } from "./FabPreview";
import OrderBoard from "./OrderBoard";
import { orderFiles } from "./orderFiles";
import { xlsx } from "./xlsx";

/** Two resistors on a board, with a track, a via and a mounting hole. */
function board(): ElectronicsDesign {
  const a = placePart(emptyDesign(), "sh1", BASICS.resistor!(), { x: 0, y: 0 });
  const b = placePart(a.design, "sh1", BASICS.resistor!(), { x: 25.4, y: 0 });
  let d = pushToBoard(b.design).design;
  d = setPlacement(d, a.part.id, { x: 10, y: 20 });
  d = setPlacement(d, b.part.id, { x: 30, y: 10 });
  d = addTrack(d, "", "top", [
    [5, 30],
    [20, 30],
  ]);
  d = addVia(d, "", 20, 30);
  return addHole(d, 45, 35, 3.2);
}

const text = (b: Uint8Array) => new TextDecoder().decode(b);

describe("the order files", () => {
  it("puts the Gerbers and drill files in a zip of their own, beside the lists", async () => {
    const pack = orderPack(board(), "jlcpcb", "Blinky")!;
    const files = orderFiles(pack, "csv");
    expect(files.map((f) => f.name)).toEqual(["Blinky-gerbers.zip", "Blinky-bom.csv", "Blinky-cpl.csv"]);
    const inside = unzip(new Uint8Array(await files[0]!.data));
    expect([...inside.keys()]).toEqual(pack.gerbers.map((g) => g.name));
    expect(text(inside.get("Blinky.GTL")!)).toContain("%TF.FileFunction,Copper,L1,Top*%");
    expect(text(inside.get("Blinky-PTH.DRL")!)).toContain("T1C0.300");
    expect(text(new Uint8Array(await files[1]!.data))).toBe('Comment,Designator,Footprint,LCSC Part #\r\n10 kΩ,"R1,R2",0805 (2012 metric),\r\n');
    expect(orderFiles(pack, "xlsx").map((f) => f.name)).toEqual(["Blinky-gerbers.zip", "Blinky-bom.xlsx", "Blinky-cpl.xlsx"]);
  });

  it("writes a workbook a spreadsheet opens, with text kept as text", () => {
    const book = unzip(
      xlsx(
        [
          ["Part & number", "Qty"],
          ["0805", 2],
        ],
        "BOM",
      ),
    );
    expect([...book.keys()]).toEqual(["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/worksheets/sheet1.xml"]);
    const sheet = text(book.get("xl/worksheets/sheet1.xml")!);
    expect(sheet).toContain('<c r="A1" t="inlineStr"><is><t xml:space="preserve">Part &amp; number</t></is></c>');
    expect(sheet).toContain('<c r="A2" t="inlineStr"><is><t xml:space="preserve">0805</t></is></c><c r="B2"><v>2</v></c>');
    expect(text(book.get("xl/workbook.xml")!)).toContain('<sheet name="BOM" sheetId="1" r:id="rId1"/>');
  });
});

describe("the preview's reading of files", () => {
  it("knows a layer by what the file says, then by its name", () => {
    expect(kindOf("a.gbr", "Copper,L2,Bot")).toBe("copper-bottom");
    expect(kindOf("a.gbr", "Legend,Top")).toBe("silk-top");
    expect(kindOf("board.GKO")).toBe("edge");
    expect(kindOf("board-F_Cu.gbr")).toBe("copper-top");
    expect(kindOf("board-B_Mask.gbr")).toBe("mask-bottom");
    expect(kindOf("readme.txt")).toBe("other");
  });

  it("reads back every file of a pack, bottom of the stack first", () => {
    const pack = orderPack(board(), "generic", "x")!;
    const layers = readLayers([...pack.gerbers, { name: "notes.txt", text: "hello" }]);
    expect(layers.map((l) => l.kind)).toEqual([
      "copper-bottom",
      "mask-bottom",
      "paste-bottom",
      "silk-bottom",
      "copper-top",
      "mask-top",
      "paste-top",
      "silk-top",
      "edge",
      "drill",
      "drill",
    ]);
    expect(layers.find((l) => l.kind === "drill")!.hits).toHaveLength(1);
    expect(layers.find((l) => l.kind === "copper-top")!.image!.ops.length).toBeGreaterThan(4);
  });
});

describe("the Order the board card", () => {
  it("shows what the order form asks, the checklist and the files, for the house you pick", async () => {
    const onParts = vi.fn();
    render(<OrderBoard design={board()} name="Blinky" onClose={() => {}} onParts={onParts} />);
    const facts = screen.getByLabelText("What the order form asks");
    expect(facts).toHaveTextContent("50 × 40 mm, 1.6 mm thick");
    expect(facts).toHaveTextContent("Smallest hole0.3 mm");
    const checks = within(screen.getByRole("list", { name: "Before you order" }));
    expect(checks.getByText("The outline is closed.")).toBeInTheDocument();
    expect(checks.getByText(/No part number for assembly: R1, R2/)).toBeInTheDocument();
    expect(screen.getByText(/11 files in Blinky-gerbers.zip, a parts list and a pick and place list/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open JLCPCB" })).toHaveAttribute("href", "https://jlcpcb.com/");
    expect(within(screen.getByRole("table", { name: "Drill table" })).getByRole("rowheader", { name: "3.2 mm" })).toBeInTheDocument();
    await userEvent.click(checks.getByRole("button", { name: "Open the parts list" }));
    expect(onParts).toHaveBeenCalled();
    // Any board house: no part numbers are asked for, and there is no site to open.
    await userEvent.click(screen.getByRole("button", { name: "Any board house" }));
    expect(screen.queryByText(/No part number for assembly/)).toBeNull();
    expect(screen.queryByRole("link", { name: /^Open / })).toBeNull();
    expect(screen.getByRole("button", { name: "Save the files" })).toBeEnabled();
  });

  it("is happy once every part has its number", () => {
    let d = board();
    for (const p of d.parts) d = changePart(d, p.id, { supplier: { lcsc: "C17414" } });
    render(<OrderBoard design={d} name="Blinky" onClose={() => {}} />);
    expect(screen.getByText("Every part has a part number.")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Save the files, then upload the Gerber zip on the board house's site. Nothing is sent for you.");
  });
});
