/**
 * Writes the sample models (#99) to public/samples/ from the document API: <id>.bcad, and a <id>.png thumbnail drawn
 * by the real app (a gallery build) in headless Chromium, the same picture a save makes. Run with `npm run build:samples -w web` after
 * a change to a sample or to the file format, and commit the result. `--no-thumbnails` skips the browser.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { saveBcad } from "@bettercad/kernel/bcad";
import { SAMPLES } from "@bettercad/kernel/samples";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "public", "samples");
// A fixed date, so a sample's file only changes when the model does.
const WHEN = new Date("2026-11-07T00:00:00Z");

mkdirSync(out, { recursive: true });
const write = (id: string, thumbnail?: string) => {
  const s = SAMPLES.find((x) => x.id === id)!;
  const text = saveBcad(s.build(), { id: `sample-${id}`, created: WHEN.toISOString(), now: WHEN, thumbnail });
  writeFileSync(join(out, `${id}.bcad`), text);
  return text.length;
};
for (const s of SAMPLES) write(s.id);

if (!process.argv.includes("--no-thumbnails")) {
  const { build, preview } = await import("vite");
  const { chromium } = await import("playwright");
  // A gallery build exposes the view to scripts (window.__bcView), the way the e2e tests use it.
  process.env.VITE_GALLERY = "1";
  const dist = join(root, "node_modules", ".samples-build");
  await build({ root, configFile: join(root, "vite.config.ts"), build: { outDir: dist, emptyOutDir: true }, logLevel: "error" });
  const server = await preview({
    root,
    configFile: join(root, "vite.config.ts"),
    build: { outDir: dist },
    preview: { port: 5199, strictPort: true },
    logLevel: "error",
  });
  const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader"] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, colorScheme: "light" });
    page.on("pageerror", (e) => console.error("page:", e.message));
    page.on("console", (m) => m.type() === "error" && console.error("console:", m.text()));
    for (const s of SAMPLES) {
      await page.goto(`http://localhost:5199/#/sample/${s.id}`);
      await page
        .waitForFunction(() => performance.getEntriesByName("bc:kernel", "mark").length > 0, null, { timeout: 30_000 })
        .catch(async (e) => {
          console.error(
            await page.evaluate(() => [location.hash, performance.getEntriesByType("mark").map((m) => m.name), document.body.innerText.slice(0, 300)]),
          );
          throw e;
        });
      await page.waitForFunction(() => location.hash === "#/");
      // Let the kernel's meshes land, then frame the model and draw it.
      await page.waitForTimeout(1500);
      const png = await page.evaluate(async () => {
        const view = (window as unknown as { __bcView: { fit(): void; thumbnail(w: number, h: number): string | null } }).__bcView;
        view.fit();
        await new Promise((r) => setTimeout(r, 800));
        return view.thumbnail(320, 200);
      });
      if (!png) throw new Error(`No thumbnail for ${s.id}`);
      writeFileSync(join(out, `${s.id}.png`), Buffer.from(png.split(",")[1]!, "base64"));
      const size = write(s.id, png);
      console.log(`${s.id}: ${(size / 1024).toFixed(1)} KB`);
    }
  } finally {
    await browser.close();
    await new Promise((r) => server.httpServer.close(r));
  }
} else {
  for (const s of SAMPLES) console.log(`${s.id}: ${(readFileSync(join(out, `${s.id}.bcad`)).length / 1024).toFixed(1)} KB, no thumbnail`);
}
