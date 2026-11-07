#!/usr/bin/env node
/**
 * Viewport benchmark (#42, #108): the time to draw one frame of the hole calibration coupon (one body, about 160
 * faces) while the camera turns, in Chromium with SwiftShader as CI runs it. Needs a gallery build being served
 * (VITE_GALLERY=1 npm run build -w web && npm run preview -w web). Prints the median of 60 frames;
 * `--json out.json` writes it for the budget check.
 */
import { writeFileSync } from "node:fs";
import { chromium } from "playwright";

const args = process.argv.slice(2);
const out = args.includes("--json") ? args[args.indexOf("--json") + 1] : undefined;
const url = args.find((a) => a.startsWith("http")) ?? "http://127.0.0.1:4173/";

const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.addInitScript(() => localStorage.setItem("bettercad.tourDone", "1"));
  await page.goto(`${url}#/sample/hole-calibration`);
  await page.waitForFunction(() => "__bcView" in window, null, { timeout: 30_000 });
  await page.getByText(/Opened the hole calibration sample/).waitFor({ timeout: 30_000 });
  await page.locator(".bc-view-engine").waitFor({ state: "detached", timeout: 60_000 });
  await page.waitForTimeout(1000);
  const times = await page.evaluate(() => {
    const e = window.__bcView;
    const gl = e.renderer.getContext();
    const px = new Uint8Array(4);
    const base = e.camera;
    const ms = [];
    for (let i = 0; i < 70; i++) {
      e.setCamera({ ...base, azimuth: base.azimuth + i * 3 }, false);
      const t = performance.now();
      e.draw();
      // Reading a pixel back waits for the GPU (here SwiftShader) to finish the frame.
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      ms.push(performance.now() - t);
    }
    return ms.slice(10);
  });
  const median = [...times].sort((a, b) => a - b)[Math.floor(times.length / 2)];
  const result = { "Draw a frame of the calibration coupon": Math.round(median * 10) / 10 };
  console.log(`Draw a frame of the calibration coupon: ${result["Draw a frame of the calibration coupon"]} ms (median of ${times.length})`);
  if (out) writeFileSync(out, JSON.stringify(result, null, 2) + "\n");
} finally {
  await browser.close();
}
