#!/usr/bin/env node
/**
 * The app's PNG icons (#94, #108), drawn from public/favicon.svg in headless Chromium: 192 and 512 px for install,
 * and a 512 px maskable one with the mark inside the safe zone on a plain background. Rerun with
 * `npm run build:icons -w web` when the logo (#95) changes.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const pub = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const svg = readFileSync(join(pub, "favicon.svg"), "utf8");
const icons = [
  { file: "icon-192.png", size: 192, mark: 0.8, background: "transparent" },
  { file: "icon-512.png", size: 512, mark: 0.8, background: "transparent" },
  // Maskable: the platform crops to a circle or squircle, so the mark sits in the middle 60 % on a filled square.
  { file: "icon-maskable-512.png", size: 512, mark: 0.55, background: "#ffffff" },
];

const browser = await chromium.launch();
try {
  for (const i of icons) {
    const page = await browser.newPage({ viewport: { width: i.size, height: i.size } });
    const m = Math.round(i.size * i.mark);
    await page.setContent(
      `<html><body style="margin:0;width:${i.size}px;height:${i.size}px;display:grid;place-items:center;background:${i.background}">` +
        `<div style="width:${m}px;height:${m}px">${svg.replace("<svg ", `<svg width="${m}" height="${m}" `)}</div></body></html>`,
    );
    await page.screenshot({ path: join(pub, i.file), omitBackground: i.background === "transparent" });
    await page.close();
    console.log(`${i.file}: ${i.size} px`);
  }
} finally {
  await browser.close();
}
