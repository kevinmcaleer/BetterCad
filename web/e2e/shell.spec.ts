import { expect, test } from "@playwright/test";
import { bodyRows, modelRow } from "./pages/editor";

test("the editor shell loads with its slots", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Untitled model · BetterCad");
  await expect(page.getByRole("banner").getByRole("toolbar", { name: "Model tools" })).toBeVisible();
  await expect(page.getByRole("toolbar", { name: "View tools" })).toBeVisible();
  await expect(modelRow(page)).toContainText("Untitled model");
  await expect(page.getByRole("application", { name: /3D view/ })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Properties" })).toBeVisible();
});

test("keyboard: tools, undo and the command palette", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Extrude" })).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("e");
  await expect(page.getByRole("button", { name: "Extrude" })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Extrude" })).toHaveAttribute("aria-pressed", "false");

  await page.getByRole("button", { name: "Library" }).click();
  await page.getByRole("button", { name: "Box", exact: true }).click();
  await expect(bodyRows(page)).toHaveCount(1);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(bodyRows(page)).toHaveCount(0);

  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("combobox", { name: "Command" }).fill("holodeck");
  await page.keyboard.press("Enter");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "holodeck");
});

test("the saved theme applies before first paint", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  const first = await page.evaluate(() => document.documentElement.dataset.theme);
  expect(first).toBe("dark");
  await page.evaluate(() => localStorage.setItem("bettercad.theme", "holodeck"));
  await page.reload();
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("holodeck");
});

test("the component gallery renders every theme", async ({ page }) => {
  await page.goto("/#/gallery");
  for (const name of ["Light", "Dark", "Holodeck"]) {
    await expect(page.getByRole("region", { name })).toBeVisible();
  }
});

test("Esc backs out one layer at a time", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Library" }).click();
  await page.getByRole("button", { name: "Box", exact: true }).click();
  await expect(page.getByRole("treeitem", { name: /Box 1/ })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("application", { name: /3D view/ }).focus();
  await page.keyboard.press("m");
  await expect(page.getByRole("button", { name: "Move" })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Move" })).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("treeitem", { name: /Box 1/ })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("treeitem", { name: /Box 1/ })).toHaveAttribute("aria-selected", "false");
});

test("parts: multi-select, edit size for both, rename inline", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Library" }).click();
  await page.getByRole("button", { name: "Box", exact: true }).click();
  await page.getByRole("button", { name: "Library" }).click();
  await page.getByRole("button", { name: "Box", exact: true }).click();
  await expect(bodyRows(page)).toHaveCount(2);
  await page.getByText("Box 1", { exact: true }).click();
  await page.getByText("Box 2", { exact: true }).click({ modifiers: ["Shift"] });
  await expect(page.getByRole("complementary", { name: "Properties" })).toContainText("2 parts");
  const w = page.getByRole("textbox", { name: "W (mm)" });
  await w.fill("40/2 + 5");
  await w.press("Enter");
  await expect(w).toHaveValue("25");
  await page.getByText("Box 1", { exact: true }).click();
  await expect(w).toHaveValue("25");
  await page.keyboard.press("F2");
  await page.getByRole("textbox", { name: "Rename Box 1" }).fill("Base plate");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("treeitem", { name: /Base plate/ })).toBeVisible();
});

test("a narrow window gets the tools along the bottom, and sheets", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const tools = page.getByRole("toolbar", { name: "Model tools" });
  await expect(tools).toBeVisible();
  expect((await tools.boundingBox())!.y).toBeGreaterThan(700);
  await expect(page.getByRole("complementary", { name: "Properties" })).toBeHidden();
  await page.getByRole("button", { name: "Show properties" }).click();
  await expect(page.getByRole("complementary", { name: "Properties" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("complementary", { name: "Properties" })).toBeHidden();
});

test("timeline: each step shows, and the marker rolls the model back", async ({ page }) => {
  await page.goto("/");
  const timeline = page.getByRole("region", { name: "Timeline" });
  await page.getByRole("button", { name: "Library" }).click();
  await page.getByRole("button", { name: "Box", exact: true }).click();
  await page.getByRole("button", { name: "Library" }).click();
  await page.getByRole("button", { name: "Box", exact: true }).click();
  await expect(timeline.getByRole("button", { name: /^Box \d/ })).toHaveCount(2);
  await expect(bodyRows(page)).toHaveCount(2);

  await page.keyboard.press("Alt+ArrowLeft");
  await expect(bodyRows(page)).toHaveCount(1);
  await expect(timeline.getByRole("button", { name: /^Box 2.*not built/ })).toBeVisible();

  await timeline.getByRole("button", { name: /^Box 1/ }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Suppress" }).click();
  await expect(bodyRows(page)).toHaveCount(0);

  await page.keyboard.press("Alt+End");
  await expect(bodyRows(page)).toHaveCount(1);
  await page.getByRole("button", { name: "History" }).click();
  await expect(page.getByRole("tree", { name: "History" }).getByRole("treeitem")).toHaveCount(2);
});

test("browser: the model's folders, eyes, and a sketch on an origin plane", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Library" }).click();
  await page.getByRole("button", { name: "Box", exact: true }).click();
  const tree = page.getByRole("tree", { name: "Browser" });
  await expect(tree.getByRole("treeitem", { name: /Untitled model/ })).toBeVisible();
  await expect(tree.getByRole("treeitem", { name: /Joints/ })).toContainText("None yet");
  await tree.getByRole("button", { name: "Hide Bodies" }).click();
  await expect(tree.getByRole("treeitem", { name: /Box 1/ })).toHaveClass(/bc-off/);
  await tree.getByRole("button", { name: "Show Bodies" }).click();
  await expect(tree.getByRole("treeitem", { name: /Box 1/ })).not.toHaveClass(/bc-off/);

  await tree.getByRole("button", { name: "Show what is in Origin" }).click();
  await tree.getByRole("button", { name: "Show XY plane" }).click();
  await expect(tree.getByRole("treeitem", { name: /XY plane/ })).not.toHaveClass(/bc-off/);
  await tree.getByText("XZ plane").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Sketch on the XZ plane" }).click();
  await expect(page.getByText("Sketching on the XZ plane. Enter finishes.")).toBeVisible();
});
