import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";

export default defineConfig({
  // wasm() lets tests import .wasm files from disk, the same way the app does (kernel golden tests in #4).
  plugins: [react(), wasm()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["packages/*/src/**/*.test.{ts,tsx}", "web/src/**/*.test.{ts,tsx}"],
    css: false,
  },
});
