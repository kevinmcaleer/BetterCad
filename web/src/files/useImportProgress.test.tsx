import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useImportProgress } from "./useImportProgress";

type View = Parameters<typeof useImportProgress>[0];
const view = (v: Partial<View>): View => ({ bodies: new Map(), failed: new Map(), parts: [], off: false, ...v });

describe("useImportProgress", () => {
  it("is ready once the kernel's mesh for each body is on show", async () => {
    const { result, rerender } = renderHook((v: View) => useImportProgress(v), { initialProps: view({}) });
    let done = false;
    // Asked before the import's step has reached the model: not taken for gone.
    void result.current.ready("f1", ["a"]).then(() => (done = true));
    rerender(view({ parts: [{ id: "a" }] }));
    await act(async () => undefined);
    expect(done).toBe(false);
    rerender(view({ parts: [{ id: "a" }], bodies: new Map([["a", {}]]) }));
    await act(async () => undefined);
    expect(done).toBe(true);
  });

  it("is ready when the step fails or its bodies are taken away", async () => {
    const { result, rerender } = renderHook((v: View) => useImportProgress(v), { initialProps: view({ parts: [{ id: "a" }, { id: "b" }] }) });
    const states = { f1: false, f2: false };
    void result.current.ready("f1", ["a"]).then(() => (states.f1 = true));
    void result.current.ready("f2", ["b"]).then(() => (states.f2 = true));
    rerender(view({ parts: [{ id: "a" }], failed: new Map([["f1", "That file couldn't be read."]]) }));
    await act(async () => undefined);
    expect(states).toEqual({ f1: true, f2: true });
  });
});
