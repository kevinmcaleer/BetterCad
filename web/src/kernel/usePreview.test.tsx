import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newDoc } from "@bettercad/kernel/document";
import type { BodyMesh } from "@bettercad/kernel";
import { usePreview, type PreviewRequest } from "./usePreview";

const mesh = {} as BodyMesh;

function fakeCall(result: { bodies: { id: string; mesh: BodyMesh }[]; failed: [string, string][] }) {
  const cancel = vi.fn();
  const call = vi.fn(() => Object.assign(Promise.resolve(result), { cancel }));
  return { call: call as never, spy: call, cancel };
}

const req = (over: Partial<PreviewRequest> = {}): PreviewRequest => ({ doc: newDoc(), upTo: 1, step: "preview", show: ["a"], ...over });

describe("usePreview", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("waits for the settings to stay still, then builds once and shows the changed body", async () => {
    const k = fakeCall({
      bodies: [
        { id: "a", mesh },
        { id: "b", mesh },
      ],
      failed: [],
    });
    const { result, rerender } = renderHook(({ r }) => usePreview(k.call, r), { initialProps: { r: req() } });
    rerender({ r: req({ upTo: 2 }) });
    rerender({ r: req({ upTo: 3 }) });
    expect(k.spy).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(k.spy).toHaveBeenCalledTimes(1);
    expect(result.current.bodies).toEqual([{ id: "a", mesh }]);
    expect(result.current.error).toBeNull();
  });

  it("says why the step does not build", async () => {
    const k = fakeCall({ bodies: [{ id: "a", mesh }], failed: [["preview", "The radius is too big for these edges."]] });
    const { result } = renderHook(() => usePreview(k.call, req()));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(result.current.bodies).toBeNull();
    expect(result.current.error).toBe("The radius is too big for these edges.");
  });

  it("dims the bodies a combine uses up and clears when the tool goes", async () => {
    const k = fakeCall({ bodies: [{ id: "a", mesh }], failed: [] });
    const { result, rerender } = renderHook(({ r }) => usePreview(k.call, r), { initialProps: { r: req({ dim: ["b"] }) as PreviewRequest | null } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(result.current.bodies).toEqual([
      { id: "a", mesh },
      { id: "b", dim: true },
    ]);
    rerender({ r: null });
    expect(result.current.bodies).toBeNull();
  });
});
