import { expect, test, type Page } from "@playwright/test";
import { modelRow } from "./pages/editor";
import { fakeApi } from "./fakeApi";

/** A save draws a thumbnail and uploads it, which a busy CI runner can take well over the default 5 s to do. */
const SAVE = { timeout: 15_000 };

/** Version history (#91) and share links (#92), against the in-test server in fakeApi.ts. */

const add = async (page: Page, shape: string) => {
  await page.getByRole("button", { name: "Library" }).click();
  await page.getByRole("button", { name: shape, exact: true }).click();
};

async function savedModel(page: Page) {
  await page.goto("/");
  await add(page, "Box");
  await page.getByRole("button", { name: "Share, versions and export" }).click();
  await page.getByRole("menuitem", { name: "Save to your account…" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Bracket");
  await page.getByRole("button", { name: "Save", exact: true }).last().click();
  // The toast fades after 3 s, and a busy CI runner can draw the save's thumbnail for longer; the Save button
  // is described as "Saved to your account" until the next change.
  await expect(page.getByRole("button", { name: "Save", exact: true }).first()).toHaveAccessibleDescription("Saved to your account", SAVE);
}

test("save three times, look at version 1, and restore it", async ({ page, context }) => {
  const server = await fakeApi(context);
  await server.signIn(context);
  await savedModel(page);
  await add(page, "Cylinder");
  await page.keyboard.press("ControlOrMeta+s");
  await expect.poll(() => [...server.models.values()][0]!.versions.length, SAVE).toBe(2);
  await add(page, "Sphere");
  await page.keyboard.press("ControlOrMeta+s");
  await expect.poll(() => [...server.models.values()][0]!.versions.length, SAVE).toBe(3);

  await expect(page.getByRole("button", { name: "Save", exact: true })).toHaveAccessibleDescription("Saved to your account");
  await page.getByRole("button", { name: "Share, versions and export" }).click();
  await page.getByRole("menuitem", { name: "Versions…" }).click();
  const history = page.getByRole("dialog", { name: "Version history" });
  await expect(history.getByText("Version 3 · current")).toBeVisible();
  await history.getByRole("listitem").filter({ hasText: "Version 1" }).getByRole("button", { name: "View" }).click();
  await expect(page.getByText(/Viewing version 1 from/)).toBeVisible();
  await expect(page.getByRole("treeitem", { name: /Cylinder 1/ })).toHaveCount(0);
  await expect(page.getByRole("treeitem", { name: /Box 1/ })).toBeVisible();

  // Read-only: Delete does nothing but explain.
  await page.getByRole("treeitem", { name: /Box 1/ }).click();
  await page.keyboard.press("Delete");
  await expect(page.getByText("This is an old version. Restore it to change it.")).toBeVisible();
  await expect(page.getByRole("treeitem", { name: /Box 1/ })).toBeVisible();

  // Back shows the current version again; then restore version 1.
  await history.getByRole("button", { name: "Close" }).first().click();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("treeitem", { name: /Sphere 1/ })).toBeVisible();
  await page.getByRole("button", { name: "Share, versions and export" }).click();
  await page.getByRole("menuitem", { name: "Versions…" }).click();
  await page
    .getByRole("dialog", { name: "Version history" })
    .getByRole("listitem")
    .filter({ hasText: "Version 1" })
    .getByRole("button", { name: "View" })
    .click();
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(page.getByText("Restored version 1")).toBeVisible();
  await expect(page.getByRole("treeitem", { name: /Sphere 1/ })).toHaveCount(0);
  const model = [...server.models.values()][0]!;
  expect(model.versions.at(-1)).toMatchObject({ number: 4, note: "Restored version 1" });
});

test("share a link, view it read-only, open a copy, then turn the link off", { tag: "@journey" }, async ({ page, context }) => {
  const server = await fakeApi(context);
  await server.signIn(context);
  await savedModel(page);
  await page.getByRole("button", { name: "Share, versions and export" }).click();
  await page.getByRole("menuitem", { name: "Share…" }).click();
  const link = page.getByRole("textbox", { name: "Link" });
  await expect(link).toHaveValue(/\/view\/t\d+$/);
  const token = (await link.inputValue()).split("/view/")[1]!;
  await page.getByRole("button", { name: "Close" }).last().click();

  const viewer = await context.newPage();
  await viewer.goto(`/#/view/${token}`);
  await expect(viewer.getByRole("treeitem", { name: /Box 1/ })).toBeVisible();
  await expect(viewer.getByText("by Kev")).toBeVisible();
  await modelRow(viewer).locator(".bc-row-name").dblclick();
  await expect(viewer.getByRole("textbox", { name: /^Rename / })).toHaveCount(0);
  await expect(viewer.getByRole("button", { name: "Download" })).toBeVisible();
  await viewer.getByRole("button", { name: "Open a copy" }).click();
  await expect(modelRow(viewer)).toContainText("Bracket (copy)");
  await expect(viewer).toHaveURL(/#\/$/);
  await add(viewer, "Cone");
  await expect(viewer.getByRole("treeitem", { name: /Cone 1/ })).toBeVisible();

  await page.getByRole("button", { name: "Share, versions and export" }).click();
  await page.getByRole("menuitem", { name: "Share…" }).click();
  await page.getByRole("button", { name: "Turn off the link" }).click();
  await viewer.goto(`/#/view/${token}`);
  await viewer.reload();
  await expect(viewer.getByText(/This link isn.t active any more/)).toBeVisible();
});
