import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  // Tests are independent, so CI shards split them one by one rather than file by file, and the shards finish
  // together. Workers stay at Playwright's default (half the cores): four on a 4-core runner starved the software
  // WebGL renderer, and a save's thumbnail outran its 5 s wait.
  fullyParallel: true,
  // No retries (#107): a flaky test is fixed, or tagged @quarantine so it runs in its own job that can't block a merge.
  retries: 0,
  reporter: process.env.CI ? "github" : "list",
  // Most tests run without the service worker (#94), so each new context doesn't download and cache the 25 MB app;
  // pwa.spec.ts turns it on.
  // The first-run tour (#98) is marked done, so it stays out of the way; tour.spec.ts runs it.
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "off",
    // In CI every test ends with a screenshot kept as an artifact (#107), not compared, so a failed run is easy to read.
    screenshot: process.env.CI ? "on" : "only-on-failure",
    serviceWorkers: "block",
    storageState: { cookies: [], origins: [{ origin: "http://127.0.0.1:4173", localStorage: [{ name: "bettercad.tourDone", value: "1" }] }] },
  },
  // SwiftShader gives headless Chromium WebGL 2 without a GPU, so the 3D view draws in CI.
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] } },
    },
    // The nightly (#106) also runs the end-to-end journeys (tagged @journey) in WebKit.
    ...(process.env.PW_WEBKIT ? [{ name: "webkit", use: { ...devices["Desktop Safari"] }, grep: /@journey/ }] : []),
  ],
  webServer: {
    command: "VITE_GALLERY=1 npm run build && npm run preview -- --host 127.0.0.1 --strictPort",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
