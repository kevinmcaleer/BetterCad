import { describe, expect, it, vi } from "vitest";
import type { ModelDoc, RenderShot } from "@bettercad/kernel/document";
import { clipName, clipOf, StripController, type StripDeps } from "./strip";
import { moveStart, renderSession } from "./session";

describe("clips on the render strip", () => {
  it("keeps what the Render view is animating as a recipe, named after it", () => {
    const s = renderSession();
    expect(clipOf(s)).toBeUndefined();
    s.set({ move: moveStart("rise", "slow") });
    expect(clipOf(s)).toEqual({ move: "rise", length: "slow" });
    expect(clipName(clipOf(s)!)).toBe("Rising sweep");
    s.set({ drawOn: { colour: "amber", length: "quick", playing: true, at: 0, total: 0, recording: false } });
    expect(clipOf(s)).toEqual({ drawOn: { colour: "amber" }, move: "rise", length: "quick" });
    expect(clipName(clipOf(s)!)).toBe("Draw on and rising sweep");
    s.set({ move: null });
    expect(clipName(clipOf(s)!)).toBe("Draw on");
  });

  it("puts the Render view on a clip and plays it, and records its video once the player is ready", async () => {
    let doc = { renders: [], features: [], looks: {} } as unknown as ModelDoc;
    const deps = (): StripDeps =>
      ({
        doc,
        edit: (f: (d: ModelDoc) => ModelDoc) => (doc = f(doc)),
        say: vi.fn(),
        newId: () => "r1",
        bodies: () => [],
        api: {},
        cloudModel: null,
      }) as unknown as StripDeps;
    const strip = new StripController(deps);
    const s = renderSession();
    s.look = vi.fn();
    const clip: RenderShot = {
      id: "c",
      name: "Orbit",
      camera: { target: [0, 0, 0], azimuth: 10, elevation: 20, distance: 100, ortho: false },
      preset: "daylight",
      style: "paper",
      background: "grey",
      focus: "sharp",
      quality: "good",
      width: 160,
      height: 90,
      auto: true,
      animation: { move: "orbit", length: "quick" },
    };
    strip.use(s, clip);
    expect(s.look).toHaveBeenCalledWith(clip.camera);
    expect(s.get()).toMatchObject({ preset: "daylight", style: "paper", drawOn: null, move: { id: "orbit", length: "quick", playing: true } });
    // The player arrives a moment later (Draw on and the move player load and start in effects).
    const recordMove = vi.fn(async () => {});
    setTimeout(() => (s.recordMove = recordMove), 150);
    await strip.record(s, clip);
    expect(recordMove).toHaveBeenCalled();
    // A plain shot turns any animation off.
    strip.use(s, { ...clip, animation: undefined });
    expect(s.get()).toMatchObject({ drawOn: null, move: null });

    // Adding to the strip while animating keeps a clip.
    s.set({ move: moveStart("push", "normal") });
    strip.add(s, clip.camera);
    expect(doc.renders).toEqual([expect.objectContaining({ name: "Push in", animation: { move: "push", length: "normal" } })]);
    strip.dispose();
  });
});
