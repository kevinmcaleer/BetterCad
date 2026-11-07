import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  reporter: process.env.CI ? "github" : "list",
  // Most tests run without the service worker (#94), so each new context doesn't download and cache the 25 MB app;
  // pwa.spec.ts turns it on.
  // The first-run tour (#98) is marked done, so it stays out of the way; tour.spec.ts runs it.
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "off",
    serviceWorkers: "block",
    storageState: { cookies: [], origins: [{ origin: "http://127.0.0.1:4173", localStorage: [{ name: "bettercad.tourDone", value: "1" }] }] },
  },
  // SwiftShader gives headless Chromium WebGL 2 without a GPU, so the 3D view draws in CI.
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] } },
    },
  ],
  webServer: {
    command: "VITE_GALLERY=1 npm run build && npm run preview -- --host 127.0.0.1 --strictPort",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
