import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PITCH, ledCircuit, onCanvas, pick, press, tools } from "./lib/electronics";

const STEP = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "packages", "kernel", "src", "testdata", "step", "cog-on-flat.step");

const axe = async (page: import("@playwright/test").Page) => {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
};

/** Electronics (#606): a schematic, pushed to a board, with the 3D model one click away. */
test.describe("on a wide screen", () => {
  // The ribbon, as ribbon.spec.ts turns it on: the Electronics tab holds the open view's tools.
  test.use({ viewport: { width: 1440, height: 900 } });
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.removeItem("bettercad.toolbar"));
  });

  test("draw a schematic, push it to a PCB and come back to the model", { tag: "@journey" }, async ({ page }) => {
    await page.goto("/");
    await page.getByRole("group", { name: "View cube" }).getByRole("button", { name: "Fit", exact: true }).waitFor();
    await page.getByRole("tab", { name: "Electronics" }).click();
    await page.getByRole("button", { name: "Schematic", exact: true }).click();

    // The schematic takes the view: its own tools on the Electronics tab, the switcher, and a way to start.
    await expect(page.getByRole("img", { name: "Schematic, Sheet 1: 0 parts, 0 nets" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Schematic" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText("Start with a part.")).toBeVisible();
    await expect(page.getByRole("group", { name: "View cube" }).getByRole("button", { name: "Fit", exact: true })).toBeHidden();

    await ledCircuit(page);
    await expect(page.getByRole("img", { name: "Schematic, Sheet 1: 2 parts, 1 net" })).toBeVisible();
    // The browser lists the design, and the part card shows a picked part.
    const tree = page.getByRole("tree");
    await expect(tree.getByRole("button", { name: /^Electronics/ })).toContainText("2 parts");
    await page.mouse.click(...(await onCanvas(page, -25.4, 0)));
    await expect(page.getByLabel("Value")).toHaveValue("10 kΩ");
    await page.getByLabel("Value").fill("330 Ω");
    await page.keyboard.press("Escape");
    await axe(page);

    // Push to PCB says what it will do first.
    await tools(page)
      .getByRole("button", { name: /^Push to PCB/ })
      .click();
    const card = page.getByRole("group", { name: "Push to PCB options" });
    await expect(card.getByRole("listitem")).toHaveText(["Make a 2-layer board, 1.6 mm thick", "Add D1 beside the board", "Add R1 beside the board"]);
    await card.getByRole("button", { name: "Make the board" }).click();
    await expect(page.getByRole("tab", { name: "PCB" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("img", { name: /^PCB: 2 parts/ })).toBeVisible();
    const status = page.getByRole("status", { name: "Electronics status" });
    await expect(status).toContainText("1 connection left to route");
    await expect(status).toContainText("Board 50 × 40 mm");
    await expect(page.getByRole("region", { name: "Layers" }).getByRole("button", { name: "Top copper", exact: true })).toHaveAttribute("aria-pressed", "true");
    await axe(page);

    // A new part on the schematic leaves the board one change behind, and says so on the tab.
    await page.keyboard.press("1");
    await expect(page.getByRole("tab", { name: "Schematic" })).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("p");
    await pick(page, "Capacitor");
    await page.mouse.click(...(await onCanvas(page, 25.4, 0)));
    await page.keyboard.press("Escape");
    await expect(page.getByRole("img", { name: "1 change behind the schematic" })).toBeVisible();
    await page.getByRole("button", { name: "PCB is 1 change behind" }).click();
    await page.getByRole("group", { name: "Update the board options" }).getByRole("button", { name: "Update the board" }).click();
    await expect(page.getByRole("img", { name: /^PCB: 3 parts/ })).toBeVisible();

    // 3 goes back to the model, with its own tools; undo takes the last change away without leaving it.
    await page.keyboard.press("3");
    await expect(page.getByRole("group", { name: "View cube" }).getByRole("button", { name: "Fit", exact: true })).toBeVisible();
    await expect(page.getByRole("img", { name: /^PCB/ })).toBeHidden();
    await tree.getByRole("button", { name: /^Schematic/ }).dblclick();
    await expect(page.getByRole("img", { name: "Schematic, Sheet 1: 3 parts, 1 net" })).toBeVisible();
  });

  test("make a part of your own from a pin list and a package, then place it", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("group", { name: "View cube" }).waitFor();
    await page.getByRole("tab", { name: "Electronics" }).click();
    await page.getByRole("button", { name: "Schematic", exact: true }).click();
    await tools(page)
      .getByRole("button", { name: /^Components/ })
      .click();
    const card = page.getByRole("group", { name: "Components options" });
    await card.getByRole("button", { name: "New part" }).click();
    const editor = page.getByRole("dialog", { name: "New part" });
    await editor.getByLabel("Name").fill("Level shifter");
    await editor.getByRole("tab", { name: "Symbol" }).click();
    await editor.getByLabel("Pins").fill("1 VCC power\n2 A io\n3 B io\n4 GND power");
    await editor.getByRole("tab", { name: "Footprint" }).click();
    await editor.getByLabel("Package").selectOption({ label: "DIP, through hole" });
    await expect(editor.getByRole("img", { name: "Footprint Level shifter DIP-8" })).toBeVisible();
    await expect(editor.getByRole("list", { name: "Checks" })).toHaveText("Every pin has a pad. Ready to save.");
    await axe(page);
    await editor.getByRole("button", { name: "Save to your parts" }).click();
    await expect(card.getByText("Level shifter is in your parts.")).toBeVisible();
    await card.getByRole("button", { name: "Place" }).click();
    await page.mouse.click(...(await onCanvas(page, 0, 0)));
    await page.keyboard.press("Escape");
    await expect(page.getByRole("img", { name: "Schematic, Sheet 1: 1 part, 0 nets" })).toBeVisible();
    // It is still there after a reload: your parts are kept in this browser.
    await page.reload();
    await page.getByRole("group", { name: "View cube" }).waitFor();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("bettercad.electronics.library") ?? "{}").pack?.parts?.[0]?.name)).toBe("Level shifter");
  });

  test("draw a symbol by hand: shapes, pins, a second unit, undo and redo", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("group", { name: "View cube" }).waitFor();
    await page.getByRole("tab", { name: "Electronics" }).click();
    await page.getByRole("button", { name: "Schematic", exact: true }).click();
    await tools(page)
      .getByRole("button", { name: /^Components/ })
      .click();
    const card = page.getByRole("group", { name: "Components options" });
    await card.getByRole("button", { name: "New part" }).click();
    const editor = page.getByRole("dialog", { name: "New part" });
    await editor.getByLabel("Name").fill("Two gates");
    await editor.getByRole("tab", { name: "Symbol" }).click();
    // Drawing by hand starts from the box the pin list made.
    await editor.getByLabel("The symbol is").selectOption({ label: "Drawn by hand" });
    const drawing = editor.getByRole("img", { name: /^Symbol drawing/ });
    await expect(drawing).toHaveAccessibleName("Symbol drawing: 4 pins, 1 shape");
    const at = async (x: number, y: number): Promise<[number, number]> => {
      const [scale, ox, oy] = (await drawing.getAttribute("data-view"))!.split(" ").map(Number) as [number, number, number];
      const box = (await drawing.boundingBox())!;
      return [box.x + ox + x * scale, box.y + oy - y * scale];
    };
    const bar = editor.getByRole("toolbar", { name: "Symbol tools" });

    // A second unit with its own outline and a pin.
    await editor.getByLabel("Units").fill("2");
    await editor.getByLabel("Units").press("Enter");
    await editor.getByLabel("Showing").selectOption({ label: "Unit B" });
    await expect(drawing).toHaveAccessibleName("Symbol drawing, unit B: 0 pins, 0 shapes");
    await editor.getByRole("button", { name: "Copy unit A's drawing here" }).click();
    await expect(drawing).toHaveAccessibleName("Symbol drawing, unit B: 0 pins, 1 shape");
    await bar.getByRole("button", { name: "Circle" }).click();
    await page.mouse.click(...(await at(0, 0)));
    await page.mouse.click(...(await at(1.27, 0)));
    await expect(drawing).toHaveAccessibleName("Symbol drawing, unit B: 0 pins, 2 shapes");
    await bar.getByRole("button", { name: "Pin", exact: true }).click();
    await page.mouse.click(...(await at(-7.62, 0)));
    await expect(drawing).toHaveAccessibleName("Symbol drawing, unit B: 1 pin, 2 shapes");
    await expect(editor.getByLabel("Number")).toHaveValue("5");
    await editor.getByLabel("What it does").selectOption({ label: "Output" });
    await editor.getByLabel("Side").selectOption({ label: "Right" });

    // Undo takes the last change back, and redo returns it. Esc puts the tool down before it closes the editor.
    await editor.getByRole("button", { name: "Undo" }).click();
    await editor.getByRole("button", { name: "Undo" }).click();
    await editor.getByRole("button", { name: "Undo" }).click();
    await expect(drawing).toHaveAccessibleName("Symbol drawing, unit B: 0 pins, 2 shapes");
    await editor.getByRole("button", { name: "Redo" }).click();
    await expect(drawing).toHaveAccessibleName("Symbol drawing, unit B: 1 pin, 2 shapes");
    await editor.getByRole("button", { name: "Redo" }).click();
    await editor.getByRole("button", { name: "Redo" }).click();
    await expect(editor.getByRole("button", { name: "Redo" })).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(bar.getByRole("button", { name: "Select" })).toHaveAttribute("aria-pressed", "true");
    await axe(page);

    await editor.getByRole("tab", { name: "Footprint" }).click();
    await editor.getByLabel("Package").selectOption({ label: "DIP, through hole" });
    await expect(editor.getByRole("list", { name: "Checks" })).toHaveText("Every pin has a pad. Ready to save.");
    await editor.getByRole("button", { name: "Save to your parts" }).click();
    await expect(card.getByText("Two gates is in your parts.")).toBeVisible();
    // The part keeps both units, and the second unit's pin is the one drawn here.
    const saved = await page.evaluate(() => localStorage.getItem("bettercad.electronics.library") ?? "");
    expect(saved).toContain('"units":2');
    expect(saved).toMatch(/"number":"5","name":"5","type":"output"/);
  });

  test("edit a footprint pad by pad: a pad's own mask and paste, a new pad, undo and redo", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("group", { name: "View cube" }).waitFor();
    await page.getByRole("tab", { name: "Electronics" }).click();
    await page.getByRole("button", { name: "Schematic", exact: true }).click();
    await tools(page)
      .getByRole("button", { name: /^Components/ })
      .click();
    const card = page.getByRole("group", { name: "Components options" });
    await card.getByRole("button", { name: "New part" }).click();
    const editor = page.getByRole("dialog", { name: "New part" });
    await editor.getByLabel("Name").fill("Own pads");
    await editor.getByRole("tab", { name: "Footprint" }).click();
    // Editing pad by pad starts from the footprint the package's sizes made.
    await editor.getByLabel("Edit it pad by pad").check();
    const drawing = editor.getByRole("img", { name: /^Footprint drawing/ });
    await expect(drawing).toHaveAccessibleName("Footprint drawing: 4 pads, 5 outlines", { timeout: 20_000 });
    await expect(editor.getByLabel("Package")).toBeDisabled();
    const at = async (x: number, y: number): Promise<[number, number]> => {
      const [scale, ox, oy] = (await drawing.getAttribute("data-view"))!.split(" ").map(Number) as [number, number, number];
      const box = (await drawing.boundingBox())!;
      return [box.x + ox + x * scale, box.y + oy - y * scale];
    };
    const bar = editor.getByRole("toolbar", { name: "Footprint tools" });

    // Pad 1 gets a wider mask opening of its own and no paste.
    await page.mouse.click(...(await at(-2.475, 0.635)));
    await expect(editor.getByLabel("Number")).toHaveValue("1");
    await expect(editor.getByLabel("Width")).toHaveValue("1.95");
    await editor.getByLabel("Mask opening").selectOption({ label: "Its own gap" });
    await editor.getByLabel("Mask gap").fill("0.1");
    await editor.getByLabel("Mask gap").press("Enter");
    await editor.getByLabel("Solder paste").selectOption({ label: "None" });

    // A fifth pad, shaped like the last, then turned into a hole with copper round it.
    await bar.getByRole("button", { name: "Pad" }).click();
    await page.mouse.click(...(await at(0, 0)));
    await expect(drawing).toHaveAccessibleName("Footprint drawing: 5 pads, 5 outlines");
    await expect(editor.getByLabel("Number")).toHaveValue("5");
    await editor.getByLabel("Kind").selectOption({ label: "Through hole" });
    await expect(editor.getByLabel("Hole")).toBeVisible();
    await expect(editor.getByLabel("Solder paste")).toBeHidden();

    // Undo takes the hole and the pad back, redo returns the pad, and Esc puts the tool down first.
    await editor.getByRole("button", { name: "Undo" }).click();
    await editor.getByRole("button", { name: "Undo" }).click();
    await expect(drawing).toHaveAccessibleName("Footprint drawing: 4 pads, 5 outlines");
    await editor.getByRole("button", { name: "Redo" }).click();
    await expect(drawing).toHaveAccessibleName("Footprint drawing: 5 pads, 5 outlines");
    await page.keyboard.press("Escape");
    await expect(bar.getByRole("button", { name: "Select" })).toHaveAttribute("aria-pressed", "true");
    await expect(editor).toBeVisible();
    await axe(page);

    await editor.getByRole("button", { name: "Save to your parts" }).click();
    await expect(card.getByText("Own pads is in your parts.")).toBeVisible();
    const pads = await page.evaluate(() => {
      const pack = JSON.parse(localStorage.getItem("bettercad.electronics.library") ?? "{}").pack;
      return (Object.values(pack.footprints)[0] as { pads: Record<string, unknown>[] }).pads;
    });
    expect(pads).toHaveLength(5);
    expect(pads[0]).toMatchObject({ number: "1", maskMargin: 0.1, noPaste: true });
    expect(pads[4]).toMatchObject({ number: "5", kind: "smd" });
  });

  test("check the rules, copy a circuit, edit the parts in a table and export the schematic", async ({ page }) => {
    await page.addInitScript(() => delete (window as unknown as Record<string, unknown>).showSaveFilePicker);
    await page.goto("/");
    await page.getByRole("group", { name: "View cube" }).waitFor();
    await page.getByRole("tab", { name: "Electronics" }).click();
    await page.getByRole("button", { name: "Schematic", exact: true }).click();
    await ledCircuit(page);

    // The rules check lists the two pins left open, goes to one, and clears as they are dealt with.
    await page.keyboard.press("e");
    const checks = page.getByRole("group", { name: "Rules check options" });
    await expect(checks.getByRole("status")).toHaveText("2 errors to look at.");
    await checks.getByRole("button", { name: /R1 pin 2 is not connected/ }).click();
    await expect(page.getByRole("heading", { name: /^R1/ })).toBeVisible();
    await axe(page);
    // Going to a result brings it to the middle; Fit brings both pins back out from under the cards.
    await page.keyboard.press("f");
    await tools(page)
      .getByRole("button", { name: /^(Not connected|No connect)/ })
      .click();
    await press(page, -10 * PITCH, -3.81);
    await press(page, 3.81, 0);
    await page.keyboard.press("Escape");
    await page.keyboard.press("e");
    await expect(checks.getByRole("status")).toHaveText("No problems found.");
    await checks.getByRole("button", { name: "Close" }).click();

    // A copy gets fresh names, and Renumber puts them in order.
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("ControlOrMeta+d");
    await expect(page.getByRole("img", { name: "Schematic, Sheet 1: 4 parts, 2 nets" })).toBeVisible();
    await tools(page).getByRole("button", { name: "Renumber" }).click();
    await page.keyboard.press("Escape");

    // The table changes a value, read as shorthand.
    await page.keyboard.press("t");
    const table = page.getByRole("dialog", { name: "Parts" });
    await expect(table.getByRole("rowheader")).toHaveText(["D1", "D2", "R1", "R2"]);
    await table.getByLabel("Value of R2").fill("4k7");
    await table.getByLabel("Value of R2").press("Enter");
    await expect(table.getByLabel("Value of R2")).toHaveValue("4.7 kΩ");
    await axe(page);
    await page.keyboard.press("Escape");

    // Export: an SVG whose text is text, a netlist KiCad reads, and a whole KiCad project.
    const exported = async (format: string) => {
      await tools(page).getByRole("button", { name: "Export" }).click();
      const dialog = page.getByRole("dialog", { name: "Export schematic" });
      await dialog.getByRole("button", { name: format, exact: true }).click();
      const [download] = await Promise.all([page.waitForEvent("download"), dialog.getByRole("button", { name: "Export", exact: true }).click()]);
      const stream = await download.createReadStream();
      const chunks: Buffer[] = [];
      for await (const c of stream) chunks.push(c as Buffer);
      return { name: download.suggestedFilename(), text: Buffer.concat(chunks).toString("utf8") };
    };
    const svg = await exported("SVG");
    expect(svg.name).toBe("Untitled model.svg");
    expect(svg.text).toMatch(/<text class="visible"[^>]*>R2<\/text>/);
    expect(svg.text).toContain(">4.7 kΩ</text>");
    const net = await exported("Netlist");
    expect(net.text).toContain('(export (version "E")');
    expect(net.text).toContain('(comp (ref "R2")\n      (value "4.7 kΩ")');
    const pdf = await exported("PDF");
    expect(pdf.text.slice(0, 5)).toBe("%PDF-");
    // The whole design as a KiCad project: a zip that holds the schematic and the library of its parts.
    const kicad = await exported("KiCad");
    expect(kicad.name).toBe("Untitled model KiCad.zip");
    expect(kicad.text.slice(0, 2)).toBe("PK");
    for (const file of ["Untitled_model.kicad_sch", "Untitled_model.kicad_sym", "Untitled_model.kicad_pro", "CREDITS.md"]) expect(kicad.text).toContain(file);
  });

  // The whole way (#667): two parts, a wire, a board, a routed track, a clean check and the files to order.
  test("lay out a board: place by numbers, route a track, add a hole and text, check it and save the order files", { tag: "@journey" }, async ({ page }) => {
    // A long journey: on a CI runner, two to three times slower than a laptop, it runs close to the usual 30 s.
    test.setTimeout(120_000);
    // No save dialog here: the files arrive as a download.
    await page.addInitScript(() => {
      delete (window as unknown as Record<string, unknown>).showSaveFilePicker;
    });
    await page.goto("/");
    await page.getByRole("group", { name: "View cube" }).waitFor();
    await page.getByRole("tab", { name: "Electronics" }).click();
    await page.getByRole("button", { name: "Schematic", exact: true }).click();
    await ledCircuit(page);
    await tools(page)
      .getByRole("button", { name: /^Push to PCB/ })
      .click();
    await page.getByRole("group", { name: "Push to PCB options" }).getByRole("button", { name: "Make the board" }).click();
    const canvas = page.getByRole("img", { name: /^PCB: 2 parts/ });
    await expect(canvas).toBeVisible();
    const status = page.getByRole("status", { name: "Electronics status" });

    // A part picked on the schematic stays picked on the board, where its place can be typed.
    for (const [x, to] of [
      [-10 * PITCH, 15],
      [0, 30],
    ] as const) {
      await page.keyboard.press("1");
      await page.mouse.click(...(await onCanvas(page, x, 0)));
      await page.keyboard.press("2");
      // A change lands a moment after Enter and redraws the fields, so each is typed until it has stuck.
      for (const [label, value] of [
        ["X (mm)", String(to)],
        ["Y (mm)", "20"],
      ] as const)
        await expect(async () => {
          await page.getByLabel(label).fill(value);
          await page.getByLabel(label).press("Enter");
          await page.waitForTimeout(150);
          await expect(page.getByLabel(label)).toHaveValue(value, { timeout: 1000 });
        }).toPass();
      await canvas.focus();
    }
    await page.keyboard.press("Escape");
    await page.keyboard.press("f");

    // The board check lists the connection still to route, and goes to it.
    await page.keyboard.press("e");
    const check = page.getByRole("group", { name: "Board check options" });
    await expect(check.getByRole("status")).toHaveText("1 error to look at.");
    await expect(check.getByRole("button", { name: /still has 1 connection to route/ })).toBeVisible();
    await axe(page);
    await check.getByRole("button", { name: "Close" }).click();

    // Route: from the resistor's pad, a bend, then onto the LED's pad. A track never runs over another net's pad.
    await tools(page)
      .getByRole("button", { name: /^Route/ })
      .click();
    const bar = page.getByRole("group", { name: "Tool options" });
    await expect(bar.getByRole("status")).toHaveText("Click a pad to start a track.");
    await press(page, 14.2, 20);
    await expect(bar.getByRole("status")).toContainText("Routing Net-(D1-1) on the top side");
    await press(page, 15.8, 20);
    await expect(bar.getByRole("status")).toContainText("Too close to R1 pad 2");
    await press(page, 22, 24);
    await press(page, 29.2, 20);
    await expect(status).toContainText("Every connection is routed");
    await expect(bar.getByRole("status")).toHaveText("Click a pad to start a track.");
    await page.keyboard.press("Escape");

    // Slide the track's middle piece down 2 mm (#640): the slanted pieces either side shorten to meet it, so the
    // track is shorter, still on both pads, and still bent at 45°.
    const length = page.locator("dl").filter({ hasText: "Length" });
    await press(page, 21, 24);
    await expect(length).toContainText("18.35 mm");
    await page.mouse.move(...(await onCanvas(page, 21, 24)));
    await page.mouse.down();
    await page.mouse.move(...(await onCanvas(page, 21.3, 23)), { steps: 3 });
    await page.mouse.move(...(await onCanvas(page, 21.5, 22)), { steps: 3 });
    await page.mouse.up();
    await expect(length).toContainText("16.69 mm");
    await expect(status).toContainText("Every connection is routed");
    await page.keyboard.press("ControlOrMeta+z");
    await expect(length).toContainText("18.35 mm");
    await page.keyboard.press("Escape");

    // A mounting hole and a line of silkscreen text.
    await page.keyboard.press("h");
    await press(page, 45, 35);
    await page.keyboard.press("t");
    await press(page, 20, 34);
    await page.getByLabel("Text for the silkscreen").fill("Blinky v1");
    await page.getByLabel("Text for the silkscreen").press("Enter");
    await page.keyboard.press("Escape");
    await press(page, 45, 35);
    await expect(page.getByLabel("Screw")).toHaveValue("M3");

    // Board setup: the size, and a board house's rules with where they came from.
    await page.keyboard.press("Escape");
    await page.keyboard.press("b");
    const setup = page.getByRole("group", { name: "Board setup options" });
    await setup.getByLabel("Width (mm)").fill("40");
    await setup.getByLabel("Width (mm)").press("Enter");
    await expect(status).toContainText("Board 40 × 40 mm");
    await setup.getByLabel("Made by").selectOption({ label: "JLCPCB, 2 layers" });
    await expect(setup.getByRole("link", { name: "jlcpcb.com" })).toBeVisible();
    await axe(page);

    // The hole now hangs over the narrower board's edge, and the check says so.
    await tools(page)
      .getByRole("button", { name: /^Board check/ })
      .click();
    await expect(check.getByRole("status")).toHaveText("1 error to look at.");
    await expect(check.getByRole("button", { name: /A mounting hole is off the board/ })).toBeVisible();
    const undo = page.getByRole("banner").getByRole("button", { name: /^Undo/ });
    await undo.click();
    await undo.click();
    await expect(status).toContainText("Board 50 × 40 mm");
    await expect(check.getByRole("status")).toHaveText("No problems found. The board is ready to make.");
    await check.getByRole("button", { name: "Close" }).click();

    // With the check clean, the order pack says so and saves as one zip.
    await tools(page)
      .getByRole("button", { name: /^Order/ })
      .click();
    const order = page.getByRole("dialog", { name: "Order the board" });
    // The order pack is its own chunk, and a busy runner can take a while to fetch it.
    await expect(order).toBeVisible({ timeout: 20_000 });
    await expect(order.getByRole("list", { name: "Before you order" })).toContainText("The board check is clean.");
    const [download] = await Promise.all([page.waitForEvent("download"), order.getByRole("button", { name: "Save the files" }).click()]);
    expect(download.suggestedFilename()).toMatch(/\.zip$/);
    await expect(order.getByRole("status")).toContainText("Saved");
  });

  // The sample board's schematic and board as pictures, in each theme (#667). CI keeps the baselines.
  for (const theme of ["light", "dark", "holoroom"] as const) {
    test(`the sample board's schematic and PCB in ${theme} @visual`, async ({ page }) => {
      test.setTimeout(90_000);
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.addInitScript((t) => localStorage.setItem("bettercad.theme", t), theme);
      await page.goto("/");
      await page.getByRole("group", { name: "View cube" }).waitFor();
      await page.getByRole("tab", { name: "Electronics" }).click();
      await page.getByRole("button", { name: "Schematic", exact: true }).click();
      await page.getByRole("button", { name: "Open the sample board" }).click();
      const schematic = page.getByRole("img", { name: /^Schematic, Sheet 1: \d+ parts/ });
      await expect(schematic).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText("Start with a part.")).toBeHidden();
      await expect(page.getByText(/^Opened the pico servo board sample/)).toBeHidden({ timeout: 20_000 });
      await page.keyboard.press("f");
      // A first picture is taken twice to see that it holds still, which is slow on a runner with no graphics card.
      await expect(schematic).toHaveScreenshot(`sample-schematic-${theme}.png`, { maxDiffPixelRatio: 0.01, timeout: 30_000 });
      await page.keyboard.press("2");
      const board = page.getByRole("img", { name: /^PCB: 8 parts/ });
      await expect(board).toBeVisible();
      await page.keyboard.press("f");
      await expect(board).toHaveScreenshot(`sample-pcb-${theme}.png`, { maxDiffPixelRatio: 0.01, timeout: 30_000 });
    });
  }

  // The sample board in each theme (#667): the schematic, the board and the order pack hold up to axe.
  for (const theme of ["light", "dark", "holoroom"] as const) {
    test(`the schematic, the board and the order pack have no axe violations in ${theme}`, async ({ page }) => {
      test.setTimeout(90_000);
      await page.addInitScript((t) => localStorage.setItem("bettercad.theme", t), theme);
      await page.goto("/");
      await page.getByRole("group", { name: "View cube" }).waitFor();
      await page.getByRole("tab", { name: "Electronics" }).click();
      await page.getByRole("button", { name: "Schematic", exact: true }).click();
      await page.getByRole("button", { name: "Open the sample board" }).click();
      await expect(page.getByRole("img", { name: /^Schematic, Sheet 1: \d+ parts/ })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText("Start with a part.")).toBeHidden();
      await page.keyboard.press("e");
      await expect(page.getByRole("group", { name: /check options$/ })).toBeVisible();
      await axe(page);
      await page.keyboard.press("Escape");
      await page.keyboard.press("2");
      await expect(page.getByRole("img", { name: /^PCB: 8 parts/ })).toBeVisible();
      await axe(page);
      await tools(page)
        .getByRole("button", { name: /^Order/ })
        .click();
      const dialog = page.getByRole("dialog", { name: "Order the board" });
      // The order pack is its own chunk, and a busy runner can take a while to fetch it.
      await expect(dialog).toBeVisible({ timeout: 20_000 });
      await dialog.getByRole("button", { name: "Preview the files" }).click();
      await expect(dialog.getByRole("region", { name: "Preview of the files" }).getByRole("img", { name: /seen from the top/ })).toBeVisible();
      await axe(page);
    });
  }

  test("give a part a STEP file for its body, and see it on the board in 3D", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/");
    await page.getByRole("group", { name: "View cube" }).waitFor();
    await page.getByRole("tab", { name: "Electronics" }).click();
    await page.getByRole("button", { name: "Schematic", exact: true }).click();
    await tools(page)
      .getByRole("button", { name: /^Components/ })
      .click();
    const card = page.getByRole("group", { name: "Components options" });
    await card.getByRole("button", { name: "New part" }).click();
    const editor = page.getByRole("dialog", { name: "New part" });
    await editor.getByLabel("Name").fill("Cog block");
    await editor.getByRole("tab", { name: "3D body" }).click();
    await editor.getByLabel("Body", { exact: true }).selectOption({ label: "A STEP file or a BetterCad model" });
    // The file holds two solids: a flat block with a cog on it.
    await editor.getByLabel("File", { exact: true }).setInputFiles(STEP);
    await expect(editor.getByText(/^cog-on-flat\.step: 2 solids, [\d.]+ × [\d.]+ × [\d.]+ mm\.$/)).toBeVisible({ timeout: 60_000 });
    await expect(editor.getByText("Footprint and body")).toBeVisible();
    await editor.getByLabel("Lift").fill("0.2");
    await editor.getByLabel("Lift").press("Enter");
    await axe(page);
    await editor.getByRole("button", { name: "Save to your parts" }).click();
    await expect(card.getByText("Cog block is in your parts.")).toBeVisible();

    // Placed and pushed to a board, the part stands in the model as the file's two solids, not a box.
    await card.getByRole("button", { name: "Place" }).click();
    await page.mouse.click(...(await onCanvas(page, 0, 0)));
    await page.keyboard.press("Escape");
    await tools(page)
      .getByRole("button", { name: /^Push to PCB/ })
      .click();
    await page.getByRole("group", { name: "Push to PCB options" }).getByRole("button", { name: "Make the board" }).click();
    await expect(page.getByRole("img", { name: /^PCB: 1 part/ })).toBeVisible();
    await page.keyboard.press("3");
    const timeline = page.getByRole("region", { name: "Timeline" });
    await expect(timeline.getByRole("button", { name: /^Board, 1\.6 mm thick, 1 part/ })).toBeVisible();
    await expect(page.getByRole("treeitem", { name: /^U1/ })).toHaveCount(2);
    type View = { __bcView: { bodyCounts(): { id: string; vertices: number }[] } };
    await expect
      .poll(
        () => page.evaluate(() => (window as unknown as View).__bcView.bodyCounts().filter((b) => /^f[^/]*\/.+/.test(b.id) && !b.id.endsWith("/board")).length),
        {
          timeout: 60_000,
        },
      )
      .toBe(2);
    await expect(timeline.getByRole("button", { name: /problem:/ })).toHaveCount(0);
  });

  test("the board stands in the model, with a body for each part", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("group", { name: "View cube" }).waitFor();
    await page.getByRole("tab", { name: "Electronics" }).click();
    await page.getByRole("button", { name: "Schematic", exact: true }).click();
    await ledCircuit(page);
    await tools(page)
      .getByRole("button", { name: /^Push to PCB/ })
      .click();
    await page.getByRole("group", { name: "Push to PCB options" }).getByRole("button", { name: "Make the board" }).click();
    await expect(page.getByRole("img", { name: /^PCB: 2 parts/ })).toBeVisible();

    // Making the board adds one Board step, and the 3D view shows it as a component of bodies.
    await page.keyboard.press("3");
    const timeline = page.getByRole("region", { name: "Timeline" });
    await expect(timeline.getByRole("button", { name: /^Board, 1\.6 mm thick, 2 parts/ })).toBeVisible();
    await expect(timeline.getByRole("button", { name: /problem:/ })).toHaveCount(0);
    for (const name of [/^Board/, /^R1/, /^D1/]) await expect(page.getByRole("treeitem", { name }).first()).toBeVisible();

    // Undo takes the board and its step back together.
    await page.keyboard.press("ControlOrMeta+z");
    await expect(timeline.getByRole("button", { name: /^Board,/ })).toHaveCount(0);
  });

  test("order the board: check it, preview the files and save them for a board house", async ({ page }) => {
    // No save dialog here: the files arrive as a download.
    await page.addInitScript(() => {
      delete (window as unknown as Record<string, unknown>).showSaveFilePicker;
    });
    await page.goto("/");
    await page.getByRole("group", { name: "View cube" }).waitFor();
    await page.getByRole("tab", { name: "Electronics" }).click();
    await page.getByRole("button", { name: "Schematic", exact: true }).click();
    await ledCircuit(page);
    await tools(page)
      .getByRole("button", { name: /^Push to PCB/ })
      .click();
    await page.getByRole("group", { name: "Push to PCB options" }).getByRole("button", { name: "Make the board" }).click();
    await expect(page.getByRole("img", { name: /^PCB: 2 parts/ })).toBeVisible();

    await tools(page)
      .getByRole("button", { name: /^Order/ })
      .click();
    const dialog = page.getByRole("dialog", { name: "Order the board" });
    // The order pack is its own chunk, and a busy runner can take a while to fetch it.
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    await expect(dialog.getByLabel("What the order form asks")).toContainText("mm thick");
    const checks = dialog.getByRole("list", { name: "Before you order" });
    await expect(checks).toContainText("The outline is closed.");
    await expect(checks).toContainText("No part number for assembly: D1, R1.");

    // The preview reads the files back: nine Gerber layers, and no drill file for a board with no holes.
    await dialog.getByRole("button", { name: "Preview the files" }).click();
    const preview = dialog.getByRole("region", { name: "Preview of the files" });
    await expect(preview.getByRole("img", { name: "The files to send, seen from the top: 9 of 9 layers shown" })).toBeVisible();
    // The same files as the made board looks, and where the pick and place list puts each part's pin 1.
    await preview.getByRole("button", { name: "As made" }).click();
    await expect(preview.getByRole("img", { name: /as the made board looks from the top, green mask/ })).toBeVisible();
    await preview.getByRole("button", { name: "Layers" }).click();
    await preview.getByRole("button", { name: "Pin 1" }).click();
    await expect(preview.getByRole("img", { name: /pin 1 marked on 2 parts$/ })).toBeVisible();
    await expect(preview.getByRole("status")).toContainText("the ring is its pad 1");
    await preview.getByRole("button", { name: "Pin 1" }).click();
    await preview.getByRole("checkbox", { name: "Top silkscreen" }).click();
    await expect(preview.getByRole("img", { name: /8 of 9 layers shown/ })).toBeVisible();
    await preview.getByRole("button", { name: "From the bottom" }).click();
    await expect(preview.getByRole("img", { name: /seen from the bottom/ })).toBeVisible();

    // Fill in a part number from the parts list, and the checklist follows.
    await checks.getByRole("button", { name: "Open the parts list" }).click();
    const parts = page.getByRole("dialog", { name: "Parts" });
    for (const ref of ["D1", "R1"]) {
      await parts.getByLabel(`LCSC number of ${ref}`).fill("C17414");
      await parts.getByLabel(`LCSC number of ${ref}`).press("Enter");
    }
    await parts.getByRole("button", { name: "Close" }).click();
    await expect(dialog.getByRole("list", { name: "Before you order" })).toContainText("Every part has a part number.");

    // One zip for JLCPCB: the Gerber zip, the parts list and the pick and place list.
    const [download] = await Promise.all([page.waitForEvent("download"), dialog.getByRole("button", { name: "Save the files" }).click()]);
    expect(download.suggestedFilename()).toMatch(/-jlcpcb\.zip$/);
    await expect(dialog.getByRole("status")).toContainText("Saved");
  });

  test("open the Pico servo board sample: the board in the model, its PCB, and files ready to order", { tag: "@journey" }, async ({ page }) => {
    test.setTimeout(90_000);
    // The empty schematic offers it.
    await page.goto("/");
    await page.getByRole("group", { name: "View cube" }).waitFor();
    await page.getByRole("tab", { name: "Electronics" }).click();
    await page.getByRole("button", { name: "Schematic", exact: true }).click();
    await page.getByRole("button", { name: "Open the sample board" }).click();
    await expect(page.getByText("Opened the pico servo board sample. Its schematic and board are under Electronics.")).toBeVisible({ timeout: 20_000 });
    await page.keyboard.press("3");
    const timeline = page.getByRole("region", { name: "Timeline" });
    await expect(timeline.getByRole("button", { name: /^Board, 1\.6 mm thick, 8 parts/ })).toBeVisible({ timeout: 20_000 });
    await expect(timeline.getByRole("button", { name: /problem:/ })).toHaveCount(0);
    for (const name of [/^Board/, /^J1/, /^R1/, /^D1/]) await expect(page.getByRole("treeitem", { name }).first()).toBeVisible();

    // The board wears its copper and silkscreen: its name is printed in white on the mask, along the bottom edge. A
    // big board's picture is still loading when the board is first drawn, and it has to show once it is in.
    type View = { __bcView: { project(p: number[]): { x: number; y: number }; preset(p: string): void } };
    await page.evaluate(() => (window as unknown as View).__bcView.preset("top"));
    const ink = async () => {
      const [a, b] = await page.evaluate(() => {
        const v = (window as unknown as View).__bcView;
        return [v.project([22, 4.2, 9.6]), v.project([38, 1, 9.6])];
      });
      const box = (await page.getByTestId("view-canvas").boundingBox())!;
      const clip = { x: box.x + Math.min(a.x, b.x), y: box.y + Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
      if (clip.width < 8 || clip.height < 4) return 0;
      const png = (await page.screenshot({ clip })).toString("base64");
      // Light pixels: the mask is green and has little red or blue in it.
      return page.evaluate(async (src) => {
        const img = new Image();
        img.src = `data:image/png;base64,${src}`;
        await img.decode();
        const c = document.createElement("canvas");
        c.width = img.width;
        c.height = img.height;
        const o = c.getContext("2d")!;
        o.drawImage(img, 0, 0);
        const d = o.getImageData(0, 0, c.width, c.height).data;
        let n = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i]! > 150 && d[i + 2]! > 150) n++;
        return n;
      }, png);
    };
    await expect.poll(ink, { timeout: 20_000 }).toBeGreaterThan(20);

    await page.getByRole("tab", { name: "Electronics" }).click();
    await page.getByRole("button", { name: "PCB", exact: true }).first().click();
    await expect(page.getByRole("img", { name: /^PCB: 8 parts/ })).toBeVisible();
    await tools(page)
      .getByRole("button", { name: /^Order/ })
      .click();
    const dialog = page.getByRole("dialog", { name: "Order the board" });
    // The order pack is its own chunk, and a busy runner can take a while to fetch it.
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    const checks = dialog.getByRole("list", { name: "Before you order" });
    await expect(checks).toContainText("The outline is closed.");
    await expect(checks).toContainText("The board check is clean.");
    await dialog.getByRole("button", { name: "Preview the files" }).click();
    await expect(dialog.getByRole("region", { name: "Preview of the files" }).getByRole("img", { name: /seen from the top/ })).toBeVisible();
  });

  test("open a KiCad project and an Eagle one: the schematic, the board, and what did not come across", async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto("/");
    await page.getByRole("group", { name: "View cube" }).waitFor();
    await page.getByRole("tab", { name: "Electronics" }).click();
    await page.getByRole("button", { name: "Schematic", exact: true }).click();
    await page.getByRole("button", { name: "Open a KiCad or Eagle project" }).click();
    const dialog = page.getByRole("dialog", { name: "Open a project" });
    // The sample board as BetterCad writes it for KiCad, read back in.
    const golden = "../packages/electronics/src/kicad/golden";
    await dialog.getByLabel("Project files").setInputFiles([`${golden}/sample.kicad_sch`, `${golden}/sample.kicad_pcb`]);
    await expect(dialog.getByRole("status")).toContainText("Found 8 parts on 1 sheet, and a board with 8 parts placed");
    await axe(page);
    await dialog.getByRole("button", { name: "Open", exact: true }).click();
    await expect(page.getByRole("img", { name: /^Schematic, Sheet 1: 8 parts/ })).toBeVisible();
    // The board came with it, routed, and matches the schematic.
    await page.keyboard.press("2");
    await expect(page.getByRole("img", { name: /^PCB: 8 parts/ })).toBeVisible();
    const status = page.getByRole("status", { name: "Electronics status" });
    await expect(status).not.toContainText("left to route");
    await expect(page.getByRole("tab", { name: "PCB" })).not.toContainText("behind");
    // One undo takes it all away again.
    await page.keyboard.press("ControlOrMeta+z");
    await page.keyboard.press("1");
    await expect(page.getByRole("img", { name: "Schematic, Sheet 1: 0 parts, 0 nets" })).toBeVisible();

    // An Eagle schematic and board open the same way, from the tools this time.
    await tools(page).getByRole("button", { name: /^Open/ }).click();
    const eagle = "../packages/electronics/src/eagle/fixtures";
    await dialog.getByLabel("Project files").setInputFiles([`${eagle}/turns.sch`, `${eagle}/turns.brd`]);
    await expect(dialog.getByRole("status")).toContainText("Found 7 parts on 2 sheets, and a board with 7 parts placed");
    await expect(dialog.getByRole("list", { name: "What did not come across" })).toContainText("1 curved track came in as short straight pieces");
    await dialog.getByRole("button", { name: "Open", exact: true }).click();
    await expect(page.getByRole("img", { name: "Schematic, Sheet 1: 11 parts, 7 nets" })).toBeVisible();
    await page.keyboard.press("2");
    await expect(page.getByRole("img", { name: /^PCB: 7 parts/ })).toBeVisible();
  });

  test("print a picture on the silkscreen", async ({ page }) => {
    // Says what the page held when a step fails, since a runner's screenshots cannot always be fetched.
    const seen: string[] = [];
    page.on("console", (m) => (m.type() === "error" || m.type() === "warning") && seen.push(`${m.type()}: ${m.text()}`));
    page.on("pageerror", (e) => seen.push(`pageerror: ${e.message}`));
    page.on("framenavigated", (f) => f === page.mainFrame() && seen.push(`navigated: ${f.url()}`));
    try {
      await page.goto("/");
      await page.getByRole("group", { name: "View cube" }).waitFor();
      await page.getByRole("tab", { name: "Electronics" }).click();
      await page.getByRole("button", { name: "Schematic", exact: true }).click();
      await ledCircuit(page);
      await tools(page)
        .getByRole("button", { name: /^Push to PCB/ })
        .click();
      await page.getByRole("group", { name: "Push to PCB options" }).getByRole("button", { name: "Make the board" }).click();
      await expect(page.getByRole("img", { name: /^PCB: 2 parts/ })).toBeVisible();
      await expect(tools(page).getByRole("button", { name: /^Picture/ })).toBeVisible();
      const file = page.getByLabel("A picture for the silkscreen");
      const svg = (fill: string) => ({
        name: "logo.svg",
        mimeType: "image/svg+xml",
        buffer: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><circle cx="20" cy="20" r="15" fill="${fill}"/></svg>`),
      });
      // Nothing dark in it: nothing to print, and you are told why.
      await file.setInputFiles(svg("white"));
      await expect(page.getByRole("group", { name: "Picture" }).getByRole("status")).toContainText("nothing dark in it to print");
      await file.setInputFiles(svg("black"));
      const card = page.getByRole("group", { name: "Picture" });
      await expect(card.getByLabel("Width (mm)")).toBeVisible();
      // Twice as wide as it is tall, like the file.
      const w = Number(await card.getByLabel("Width (mm)").inputValue());
      expect(Number(await card.getByLabel("Height (mm)").inputValue())).toBeCloseTo(w / 2, 1);
      await card.getByLabel("Side").selectOption("Bottom silkscreen");
      await expect(card.getByLabel("Side")).toHaveValue("silk-bottom");
      await card.getByRole("button", { name: "Swap ink and bare board" }).click();
      await expect(card.getByLabel("Width (mm)")).toHaveValue(String(w));
    } catch (e) {
      console.log("PICTURE TEST FAILED. Page said:\n" + seen.join("\n"));
      console.log(
        await page
          .locator("body")
          .ariaSnapshot()
          .catch((x) => `no snapshot: ${x}`),
      );
      throw e;
    }
  });

  test("pour copper, keep it out of an area, and delete a part from the board and the schematic", async ({ page }) => {
    // A long journey: on a CI runner, two to three times slower than a laptop, it runs close to the usual 30 s.
    test.setTimeout(90_000);
    await page.goto("/");
    await page.getByRole("group", { name: "View cube" }).waitFor();
    await page.getByRole("tab", { name: "Electronics" }).click();
    await page.getByRole("button", { name: "Schematic", exact: true }).click();
    await ledCircuit(page);
    await tools(page)
      .getByRole("button", { name: /^Push to PCB/ })
      .click();
    await page.getByRole("group", { name: "Push to PCB options" }).getByRole("button", { name: "Make the board" }).click();
    const canvas = page.getByRole("img", { name: /^PCB: 2 parts/ });
    await expect(canvas).toBeVisible();
    const status = page.getByRole("status", { name: "Electronics status" });
    for (const [x, to] of [
      [-10 * PITCH, 15],
      [0, 30],
    ] as const) {
      await page.keyboard.press("1");
      await page.mouse.click(...(await onCanvas(page, x, 0)));
      await page.keyboard.press("2");
      for (const [label, value] of [
        ["X (mm)", String(to)],
        ["Y (mm)", "20"],
      ] as const)
        await expect(async () => {
          await page.getByLabel(label).fill(value);
          await page.getByLabel(label).press("Enter");
          await page.waitForTimeout(150);
          await expect(page.getByLabel(label)).toHaveValue(value, { timeout: 1000 });
        }).toPass();
      await canvas.focus();
    }
    await page.keyboard.press("Escape");
    await page.keyboard.press("f");
    await expect(status).toContainText("1 connection left to route");

    // A pour over the whole board on the net joins its two pads, so nothing is left to route.
    await tools(page).getByRole("button", { name: /^Pour/ }).click();
    const bar = page.getByRole("group", { name: "Tool options" });
    await expect(bar.getByRole("status")).toContainText("Click the corners of the area to fill on the top side");
    await expect(bar.getByLabel("Net to pour")).toHaveValue("Net-(D1-1)");
    await bar.getByRole("button", { name: "Whole board" }).click();
    await expect(status).toContainText("Every connection is routed");
    await page.keyboard.press("Escape");

    // Picked by its edge, the pour says how it joins its pads.
    await press(page, 0, 30);
    const props = page.getByRole("group", { name: "Pour" });
    await expect(props.getByLabel("Net")).toHaveValue("Net-(D1-1)");
    await props.getByLabel("Join pads with spokes").click();
    await expect(props.getByLabel("Join pads with spokes")).not.toBeChecked();
    await axe(page);
    await page.keyboard.press("Escape");

    // A keep-out right across the board cuts the pour in two, and the connection is open again.
    await page.keyboard.press("o");
    await press(page, 22, -2);
    await press(page, 24, -2);
    await press(page, 24, 42);
    await expect(bar.getByRole("status")).toContainText("Click the next corner");
    await press(page, 22, 42);
    await bar.getByRole("button", { name: "Done" }).click();
    await expect(status).toContainText("1 connection left to route");
    await page.keyboard.press("Escape");
    const undo = page.getByRole("banner").getByRole("button", { name: /^Undo/ });
    await undo.click();
    await expect(status).toContainText("Every connection is routed");

    // Deleting a part on the board asks first, then takes it off the schematic too. One undo brings both back.
    await press(page, 15, 20);
    await page.keyboard.press("Delete");
    const ask = page.getByRole("group", { name: "Delete parts" });
    await expect(ask.getByRole("status")).toContainText("Delete R1 from the schematic too?");
    await ask.getByRole("button", { name: "Delete" }).click();
    // The delete lands after the design's code answers; on a busy CI runner that has taken over five seconds.
    await expect(page.getByRole("img", { name: /^PCB: 1 part,/ })).toBeVisible({ timeout: 20_000 });
    await page.keyboard.press("1");
    await expect(page.getByRole("img", { name: /^Schematic, .*: 1 part,/ })).toBeVisible();
    await undo.click();
    await expect(page.getByRole("img", { name: /^Schematic, .*: 2 parts,/ })).toBeVisible();
    await page.keyboard.press("2");
    await expect(page.getByRole("img", { name: /^PCB: 2 parts/ })).toBeVisible();
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("the schematic and the board work by touch, with the tools along the bottom", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("banner").getByRole("button", { name: "More tools" }).click();
    const sheet = page.getByRole("dialog", { name: "More tools" });
    await sheet.getByRole("tab", { name: "Electronics" }).click();
    await sheet.getByRole("button", { name: "Schematic", exact: true }).click();
    await expect(page.getByRole("toolbar", { name: "Schematic tools" })).toBeVisible();

    await ledCircuit(page, true);
    // The rules check opens from the tools along the bottom and fits the screen.
    await tools(page)
      .getByRole("button", { name: /^Rules check/ })
      .click();
    const checks = page.getByRole("group", { name: "Rules check options" });
    await expect(checks.getByRole("status")).toHaveText("2 errors to look at.");
    await checks.getByRole("button", { name: /R1 pin 2 is not connected/ }).tap();
    const box = (await checks.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    await checks.getByRole("button", { name: "Close" }).tap();
    await tools(page)
      .getByRole("button", { name: /^Push to PCB/ })
      .click();
    await page.getByRole("group", { name: "Push to PCB options" }).getByRole("button", { name: "Make the board" }).click();
    await expect(page.getByRole("status", { name: "Electronics status" })).toContainText("1 connection left to route");
    // Nothing runs off the side of the screen, and the layers fold to one chip.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    const layers = page.getByRole("region", { name: "Layers" });
    await expect(layers.getByRole("button", { name: "Bottom copper", exact: true })).toBeHidden();
    await layers.getByRole("button", { name: "Top copper", exact: true }).first().click();
    await expect(layers.getByRole("button", { name: "Bottom copper", exact: true })).toBeVisible();
    await layers.getByRole("button", { name: "Top copper", exact: true }).first().click();

    // Routing by touch: tap the tool, tap a pad, tap where the track goes. The options stay on the screen.
    await tools(page)
      .getByRole("button", { name: /^Route/ })
      .click();
    const bar = page.getByRole("group", { name: "Tool options" });
    await expect(bar.getByRole("status")).toHaveText("Click a pad to start a track.");
    await press(page, 61.64, 38.27, true);
    await expect(bar.getByRole("status")).toContainText("Routing Net-(D1-1)");
    // The parts are still parked beside the board, where no track may go.
    await press(page, 58, 30, true);
    await expect(bar.getByRole("status")).toContainText("Too close to the board's edge");
    const at = (await bar.boundingBox())!;
    expect(at.x).toBeGreaterThanOrEqual(0);
    expect(at.x + at.width).toBeLessThanOrEqual(390);
    await bar.getByRole("button", { name: "Done" }).tap();
    await tools(page)
      .getByRole("button", { name: /^Route/ })
      .click();
    // A pour by touch: tap the tool, then Whole board. Its options fit the screen too.
    await tools(page).getByRole("button", { name: /^Pour/ }).click();
    await expect(bar.getByLabel("Net to pour")).toHaveValue("Net-(D1-1)");
    await bar.getByRole("button", { name: "Whole board" }).tap();
    expect((await bar.boundingBox())!.x + (await bar.boundingBox())!.width).toBeLessThanOrEqual(390);
    await tools(page).getByRole("button", { name: /^Pour/ }).click();
    await tools(page)
      .getByRole("button", { name: /^Board check/ })
      .click();
    const board = page.getByRole("group", { name: "Board check options" });
    await expect(board.getByRole("button", { name: /D1 is off the board/ })).toBeVisible();
    await expect(board.getByRole("button", { name: /The pour on Net-\(D1-1\)/ })).toBeVisible();
    expect((await board.boundingBox())!.x + (await board.boundingBox())!.width).toBeLessThanOrEqual(390);
    await board.getByRole("button", { name: "Close" }).tap();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.getByRole("tab", { name: "3D" }).click();
    await expect(page.getByRole("toolbar", { name: "PCB tools" })).toBeHidden();
  });
});
