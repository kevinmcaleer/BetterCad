import { afterEach, describe, expect, it, vi } from "vitest";
import { decalTexture } from "./decals";

afterEach(() => vi.unstubAllGlobals());

describe("a decal's picture", () => {
  it("lets go of the blank texture it started with, so the picture is sent whole at its own size", () => {
    // A texture keeps the size it was first drawn at. The blank 2 px one may already be on screen when a big picture
    // (a board's copper and silkscreen) finishes loading, and the picture then never showed.
    const made: { onload?: () => void; naturalWidth: number; naturalHeight: number; src?: string }[] = [];
    vi.stubGlobal(
      "Image",
      class {
        naturalWidth = 1500;
        naturalHeight = 1450;
        onload?: () => void;
        constructor() {
          made.push(this);
        }
      },
    );
    const loaded = vi.fn();
    const t = decalTexture("data:image/png;base64,AAAA", loaded);
    const freed = vi.fn();
    t.addEventListener("dispose", freed);
    const before = t.version;
    expect((t.image as HTMLCanvasElement).width).toBe(2);
    made[0]!.onload!();
    expect(freed).toHaveBeenCalledTimes(1);
    expect(t.version).toBeGreaterThan(before);
    // The picture, with its clear border round it.
    expect((t.image as HTMLCanvasElement).width).toBe(Math.round(1500 / 0.96));
    expect((t.image as HTMLCanvasElement).height).toBe(Math.round(1450 / 0.96));
    expect(loaded).toHaveBeenCalledTimes(1);
  });
});
