import { expect, test } from "@playwright/test";
import { fakeApi } from "./fakeApi";

/** The empty editor and the sample models (#99). */

test("the empty editor offers three ways in and the samples, and goes once the model has a step", async ({ page }) => {
  await page.goto("/");
  const welcome = page.getByRole("region", { name: "Start with a shape, a sketch, or open a file" });
  await expect(welcome).toBeVisible();
  await expect(welcome.getByText("or drop an STL, STEP or .bcad here")).toBeVisible();
  await expect(welcome.getByRole("button", { name: /sample$/ })).toHaveCount(3);
  await welcome.getByRole("button", { name: "Add a shape" }).click();
  await page.getByRole("button", { name: "Box", exact: true }).click();
  await expect(welcome).toBeHidden();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(welcome).toBeVisible();
  // Sketch hides it while a plane is picked.
  await welcome.getByRole("button", { name: "Sketch" }).click();
  await expect(welcome).toBeHidden();
});

test("a sample opens as a new model driven by parameters", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open the bracket sample" }).click();
  await expect(page.getByText("Opened the bracket sample. Change it in Parameters.")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Model name" })).toHaveValue("Bracket");
  await expect(page.getByRole("treeitem", { name: /Bracket/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "Start with a shape, a sketch, or open a file" })).toBeHidden();
  await page.getByRole("button", { name: "Parameters" }).click();
  const hole = page.getByRole("textbox", { name: "Expression for hole" });
  await expect(hole).toHaveValue("4.5");
  await hole.fill("6");
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Value of hole")).toHaveText("6 mm");
});

test("the library's empty state links to the samples", async ({ page, context }) => {
  const server = await fakeApi(context);
  await server.signIn(context);
  await page.goto("/#/library");
  await expect(page.getByText("No models yet")).toBeVisible();
  await page.getByRole("button", { name: "Open the phone stand sample" }).click();
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByRole("textbox", { name: "Model name" })).toHaveValue("Phone stand");
});
