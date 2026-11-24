import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { PITCH, ledCircuit, onCanvas, pick, press, tools } from "./lib/electronics";

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

    // Export: an SVG whose text is text, and a netlist KiCad reads.
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
  });

  test("lay out a board: place by numbers, route a track, add a hole and text, and check it", async ({ page }) => {
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
    await expect(page.getByRole("img", { name: /^PCB: 1 part,/ })).toBeVisible();
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
