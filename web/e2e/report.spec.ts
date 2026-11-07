import { expect, test } from "@playwright/test";

/** Help > Report a problem (#109). */
test("report a problem with the model attached, and see what else is sent", async ({ page }) => {
  let sent: { description: string; model: string | null; info: { actions: { id: string }[]; browser: string } } | null = null;
  await page.route("**/api/report", async (route) => {
    sent = JSON.parse(route.request().postData()!);
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: "2f3a9c01" }) });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Library" }).click();
  await page.getByRole("button", { name: "Box", exact: true }).click();

  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type("Report a problem");
  await page.getByRole("option", { name: /Report a problem/ }).click();
  const dialog = page.getByRole("dialog", { name: "Report a problem" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "What happened" })).toHaveAttribute("placeholder", "What were you doing when it went wrong?");
  await expect(dialog.getByRole("checkbox", { name: "Attach my model" })).toBeChecked();
  await dialog.getByText("What else is sent").click();
  await expect(dialog.getByText(/Last \d+ actions:/)).toBeVisible();
  await dialog.getByRole("textbox", { name: "What happened" }).fill("The box went missing");
  await dialog.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Sent. Report 2f3a9c01")).toBeVisible();
  await expect(dialog).toHaveCount(0);
  expect(sent!.description).toBe("The box went missing");
  expect(sent!.model).toContain('"bettercad"');
  expect(sent!.info.actions.some((a) => a.id === "edit")).toBe(true);
});

test("offline, the report downloads as a .zip instead", async ({ page }) => {
  await page.route("**/api/report", (route) => route.abort("internetdisconnected"));
  await page.goto("/");
  await expect(page.getByTestId("view-canvas")).toBeVisible();
  await page.waitForTimeout(500);
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type("Report a problem");
  await page.getByRole("option", { name: /Report a problem/ }).click();
  const dialog = page.getByRole("dialog", { name: "Report a problem" });
  // Nothing is open, so there's no model to attach.
  await expect(dialog.getByRole("checkbox", { name: /Attach my model/ })).toBeDisabled();
  await dialog.getByRole("button", { name: "Send" }).click();
  await expect(dialog.getByText(/You're offline, or the server can't be reached/)).toBeVisible();
  const download = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Download the report" }).click();
  expect((await download).suggestedFilename()).toMatch(/^bettercad-report-\d{4}-\d{2}-\d{2}\.zip$/);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("an error nothing handled offers a report with its details", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("view-canvas")).toBeVisible();
  await page.evaluate(() => setTimeout(() => Promise.reject(new Error("The sky fell in")), 0));
  await expect(page.getByText("Something went wrong: The sky fell in")).toBeVisible();
  await page.getByRole("button", { name: "Report this" }).click();
  await expect(page.getByRole("dialog", { name: "Report a problem" }).getByRole("textbox", { name: "What happened" })).toHaveValue(/The sky fell in/);
});
