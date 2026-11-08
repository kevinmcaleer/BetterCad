import { test } from "@playwright/test";
import { Editor } from "./pages/editor";

// Temporary: why WebKit never starts the sketch in box-with-hole.
test("debug sketch start @journey", async ({ page }) => {
  page.on("console", (m) => console.log("CONSOLE", m.type(), m.text()));
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  const ed = await new Editor(page).open();
  await ed.view.preset("top");
  const dump = async (label: string) => {
    const s = await page.evaluate(() => ({
      active: document.activeElement?.outerHTML.slice(0, 200),
      armed: [...document.querySelectorAll('[aria-pressed="true"]')].map((e) => e.getAttribute("aria-label") ?? e.textContent).join("|"),
      help: [...document.querySelectorAll(".bc-armed-note, [role=status]")].map((e) => e.textContent).join(" / "),
      p: (window as unknown as { __bcView: { project(p: number[]): unknown } }).__bcView.project([30, 30, 0]),
    }));
    console.log("DUMP", label, JSON.stringify(s));
  };
  await dump("before k");
  await page.keyboard.press("k");
  await page.waitForTimeout(500);
  await dump("after k");
  await ed.view.click(30, 30);
  await page.waitForTimeout(1500);
  await dump("after click");
  console.log("TOOLBAR", await ed.sketchTools.count());
  console.log("ARIA", await page.locator("body").ariaSnapshot());
});
