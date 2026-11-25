import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BASICS, changePart, emptyDesign, placePart, pushToBoard, type ElectronicsDesign } from "@bettercad/electronics";
import { orderPack, pinOnes } from "@bettercad/electronics/fab/pack";
import { addHole, addTrack, addVia, setPlacement } from "@bettercad/electronics/pcb/route";
import { unzip } from "@bettercad/kernel/zip";
import FabPreview, { boardLoops, kindOf, readLayers } from "./FabPreview";
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

describe("the preview's As made view (#657)", () => {
  it("finds the board's shape in the outline file: the edge first, then cut-outs", () => {
    const d = board();
    const slot = [
      { x: 20, y: 10 },
      { x: 30, y: 10 },
      { x: 30, y: 14 },
      { x: 20, y: 14 },
    ];
    const pack = orderPack({ ...d, board: { ...d.board!, cutouts: [slot] } }, "generic", "x")!;
    const loops = boardLoops(readLayers(pack.gerbers).find((l) => l.kind === "edge")!.image);
    expect(loops).toHaveLength(2);
    const span = (l: [number, number][], i: 0 | 1) => Math.max(...l.map((p) => p[i])) - Math.min(...l.map((p) => p[i]));
    expect([span(loops[0]!, 0), span(loops[0]!, 1)]).toEqual([50, 40]);
    expect([span(loops[1]!, 0), span(loops[1]!, 1)]).toEqual([10, 4]);
    // Lines that do not close are no shape at all.
    expect(
      boardLoops({
        ops: [
          {
            kind: "draw",
            dark: true,
            pen: 0.1,
            pts: [
              [0, 0],
              [5, 0],
              [5, 5],
            ],
          },
        ],
        skipped: [],
        box: null,
      } as never),
    ).toEqual([]);
  });

  it("switches between the layers and the made board, with the mask colour to pick", async () => {
    const pack = orderPack(board(), "generic", "x")!;
    render(<FabPreview files={pack.gerbers} mask="blue" />);
    expect(screen.getByRole("img", { name: /^The files to send, seen from the top: 11 of 11 layers shown$/ })).toBeInTheDocument();
    expect(screen.queryByLabelText("Mask colour")).toBeNull();
    await userEvent.click(within(screen.getByRole("group", { name: "Drawn as" })).getByRole("button", { name: "As made" }));
    expect(screen.getByRole("img", { name: /as the made board looks from the top, blue mask/ })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("The files do not say the mask colour, so pick it here.");
    await userEvent.selectOptions(screen.getByLabelText("Mask colour"), "Black");
    await userEvent.click(screen.getByRole("button", { name: "From the bottom" }));
    expect(screen.getByRole("img", { name: /as the made board looks from the bottom, black mask/ })).toBeInTheDocument();
  });
});

describe("the preview's pin 1 marks (#659)", () => {
  it("marks where the list puts each part and its pin 1, side by side with the pads", async () => {
    let d = board();
    const [r1, r2] = d.parts;
    d = setPlacement(d, r2!.id, { side: "bottom" });
    // The resistor is turned half way round for the line.
    const fixed: ElectronicsDesign = { ...d, defs: { ...d.defs, [r1!.def]: { ...d.defs[r1!.def]!, pnp: { rotation: 180 } } } };
    for (const [design, note] of [
      [d, /^The cross is where the list puts each part, the ring is its pad 1 and the dot is where pin 1 lands\.$/],
      [fixed, /pin 1 lands\. 1 has a correction of its own, so the dot sits off the ring by that much\.$/],
    ] as const) {
      const pack = orderPack(design, "generic", "x")!;
      const { unmount } = render(<FabPreview files={pack.gerbers} place={pinOnes(design, pack.place)} />);
      expect(screen.getByRole("status")).toHaveTextContent("Drawn from the files themselves");
      await userEvent.click(screen.getByRole("button", { name: "Pin 1" }));
      expect(screen.getByRole("img", { name: /seen from the top: 11 of 11 layers shown, pin 1 marked on 1 part$/ })).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent(note);
      unmount();
    }
    const pack = orderPack(fixed, "generic", "x")!;
    render(<FabPreview files={pack.gerbers} place={pinOnes(fixed, pack.place)} />);
    await userEvent.click(screen.getByRole("button", { name: "Pin 1" }));
    await userEvent.click(screen.getByRole("button", { name: "From the bottom" }));
    expect(screen.getByRole("img", { name: /seen from the bottom: .*pin 1 marked on 1 part$/ })).toBeInTheDocument();
  });

  it("has no pin 1 button without a list", () => {
    const pack = orderPack(board(), "generic", "x")!;
    render(<FabPreview files={pack.gerbers} />);
    expect(screen.queryByRole("button", { name: "Pin 1" })).toBeNull();
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

  it("makes a panel: rows, columns, how the boards join, and the size to order (#662)", async () => {
    render(<OrderBoard design={board()} name="Blinky" onClose={() => {}} />);
    await userEvent.click(screen.getByRole("checkbox", { name: "Order a panel of boards" }));
    const facts = screen.getByLabelText("What the order form asks");
    // Two by two, held by tabs off 5 mm rails, 2 mm apart: 102 × 96 mm.
    expect(facts).toHaveTextContent("102 × 96 mm");
    expect(facts).toHaveTextContent("4 on a panel, held by tabs");
    expect(screen.getByText(/4 boards on a 102 × 96 mm panel/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "V-cuts" }));
    expect(facts).toHaveTextContent("100 × 90 mm");
    expect(screen.queryByLabelText(/^Gap/)).toBeNull();
    expect(screen.getByText(/12 files in Blinky-gerbers.zip/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: "Order a panel of boards" }));
    expect(facts).toHaveTextContent("50 × 40 mm");
  });

  it("is happy once every part has its number", () => {
    let d = board();
    for (const p of d.parts) d = changePart(d, p.id, { supplier: { lcsc: "C17414" } });
    render(<OrderBoard design={d} name="Blinky" onClose={() => {}} />);
    expect(screen.getByText("Every part has a part number.")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Save the files, then upload the Gerber zip on the board house's site. Nothing is sent for you.");
  });
});
