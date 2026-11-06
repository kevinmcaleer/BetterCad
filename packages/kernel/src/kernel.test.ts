import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { instantiateWasm, kernelStatus } from "./index";

describe("kernel", () => {
  it("reports that the kernel is not loaded yet", () => {
    expect(kernelStatus()).toEqual({ ready: false, engine: "opencascade.js" });
  });
  it("loads a WASM module from disk in Node, as the kernel's golden tests will", async () => {
    const bytes = await readFile(join(__dirname, "testdata", "add.wasm"));
    const exports = await instantiateWasm<{ add: (a: number, b: number) => number }>(bytes);
    expect(exports.add(2, 40)).toBe(42);
  });
  it("imports a WASM module through the Vite wasm plugin", async () => {
    const mod = (await import("./testdata/add.wasm")) as unknown as { add: (a: number, b: number) => number };
    expect(mod.add(1, 2)).toBe(3);
  });
});
