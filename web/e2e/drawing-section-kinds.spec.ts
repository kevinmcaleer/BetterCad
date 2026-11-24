import { expect, test } from "@playwright/test";
import { runCommand } from "./pages/editor";

/** Half, stepped and slanted sections (#571): the Section view card's Cut and Turn the line, on the bracket's top view. */
test("cut a half, a stepped and a slanted section from a view", { tag: "@journey" }, async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await page.getByRole("button", { name: "Open the bracket sample" }).click();
  await expect(page.locator(".bc-view-engine")).toHaveCount(0, { timeout: 60_000 });
  await runCommand(page, "New drawing");
  const start = page.getByRole("dialog", { name: "New drawing" });
  await start.getByLabel("Page size").selectOption("A3");
  await start.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("region", { name: "Drawing: Drawing 1" })).toBeVisible();
  await page.keyboard.press("b");
  const base = page.getByRole("dialog", { name: "Base view" });
  await expect(base.getByRole("status")).toHaveText(/Click the sheet/, { timeout: 30_000 });
  await base.getByLabel("Direction").selectOption({ label: "Top" });
  await expect(base.getByRole("status")).toHaveText(/Click the sheet/, { timeout: 30_000 });
  await base.getByRole("button", { name: "Place" }).click();
  const top = page.getByRole("button", { name: /^Top view, / });
  await expect(top.locator(".bc-view-visible")).toHaveAttribute("d", /A/, { timeout: 30_000 });

  const arm = async () => {
    await top.click();
    await page.getByRole("button", { name: "Section view", exact: true }).click();
    const card = page.getByRole("dialog", { name: "Section view" });
    await expect(card.getByRole("status")).toHaveText(/Click the view where the cut goes/, { timeout: 30_000 });
    return card;
  };
  const drawn = async (name: RegExp) => {
    const section = page.getByRole("button", { name });
    await expect(section.locator(".bc-view-visible")).toHaveAttribute("d", /M/, { timeout: 30_000 });
    await expect(section.locator(".bc-view-thin")).toHaveAttribute("d", /M/);
    return section;
  };

  // Half: cut from the middle on, marked with one arrow and one letter.
  let card = await arm();
  await card.getByLabel("Cut", { exact: true }).selectOption("Half the view");
  await expect(card.getByRole("status")).toHaveText(/Click the view where the cut stops/);
  await card.getByRole("button", { name: "Cut through the middle" }).click();
  const half = await drawn(/^Section A-A, /);
  await expect(top.locator(".bc-cut-text")).toHaveText(["A"]);
  await expect(top.locator(".bc-cut-arrow")).toHaveCount(1);
  // Half the view is whole, so a half section keeps fewer cut faces than a full one: its hatching stops at the middle.
  const box = (await half.locator(".bc-view-thin").boundingBox())!;
  const whole = (await half.locator(".bc-view-hit").boundingBox())!;
  expect(box.width).toBeLessThan(whole.width * 0.75);

  // Stepped: two places on the view, then Make the section. The cutting line jogs between them.
  card = await arm();
  await card.getByLabel("Cut", { exact: true }).selectOption("Stepped");
  const make = card.getByRole("button", { name: "Make the section" });
  await expect(make).toHaveAttribute("aria-disabled", "true");
  const hit = (await top.locator(".bc-view-hit").boundingBox())!;
  await page.mouse.click(hit.x + hit.width * 0.2, hit.y + hit.height * 0.3);
  await expect(card.getByRole("status")).toHaveText(/1 place picked/);
  await page.mouse.click(hit.x + hit.width * 0.8, hit.y + hit.height * 0.7);
  await expect(card.getByRole("status")).toHaveText(/2 places picked/);
  await make.click();
  await expect(card).toHaveCount(0);
  await drawn(/^Section B-B, /);
  await expect(top.locator(".bc-cut-text")).toHaveText(["A", "B", "B"]);

  // Slanted: the line turned 30°, and the section seen square on to it.
  card = await arm();
  const turn = card.getByLabel("Turn the line");
  await turn.fill("30");
  await turn.press("Enter");
  await card.getByRole("button", { name: "Cut through the middle" }).click();
  await drawn(/^Section C-C, /);
  await expect(top.locator(".bc-cut-text")).toHaveText(["A", "B", "B", "C", "C"]);

  // Undo takes the last one off, and redo brings it back.
  await page.keyboard.press("Control+z");
  await expect(page.getByRole("button", { name: /^Section C-C, / })).toHaveCount(0);
  await page.keyboard.press("Control+Shift+z");
  await expect(page.getByRole("button", { name: /^Section C-C, / })).toHaveCount(1);
});
