import { afterEach, describe, expect, it, vi } from "vitest";

const made: FakeRender[] = [];
class FakeRender {
  lost = false;
  traced = 0;
  constructor(readonly canvas: HTMLCanvasElement) {
    canvas.width = 1920;
    canvas.height = 1080;
    made.push(this);
  }
  setBodies() {}
  setPreset() {}
  setStyle() {}
  setBackground() {}
  setFocus() {}
  async prepareFrames() {}
  async traceFrame(_c: unknown, samples: number, _s: AbortSignal, onSample: (n: number) => void) {
    // The first tracer's card resets on frame 2.
    if (made.length === 1 && this.traced === 1) {
      const { ContextLost } = await import("./pathRender");
      throw new ContextLost();
    }
    this.traced++;
    onSample(samples);
  }
  dispose() {}
  renderer = { forceContextLoss() {} };
}

vi.mock("./pathRender", () => ({
  PathRender: FakeRender,
  ContextLost: class ContextLost extends Error {},
}));

afterEach(() => {
  vi.unstubAllGlobals();
  made.length = 0;
});

describe("video render", () => {
  it("starts a new tracer in a new canvas when the graphics card drops the first, and carries on from the same frame", async () => {
    vi.stubGlobal(
      "VideoEncoder",
      class {
        static isConfigSupported = async () => ({ supported: true });
        state = "configured";
        encodeQueueSize = 0;
        configure() {}
        encode() {}
        async flush() {}
        close() {
          this.state = "closed";
        }
      },
    );
    const frames: HTMLCanvasElement[] = [];
    vi.stubGlobal(
      "VideoFrame",
      class {
        constructor(c: HTMLCanvasElement) {
          frames.push(c);
        }
        close() {}
      },
    );
    const { filmVideo } = await import("./renderVideo");
    const first = document.createElement("canvas");
    first.setAttribute("aria-label", "The video frame being rendered");
    const canvases: HTMLCanvasElement[] = [];
    const done: number[] = [];
    const blob = await filmVideo(
      {
        bodies: [],
        cut: null,
        preset: "studio",
        style: "finishes",
        background: "lightbox",
        aperture: 0,
        samples: 4,
        frames: 3,
        at: () => ({ target: [0, 0, 0], azimuth: 0, elevation: 0, distance: 10, ortho: false }) as never,
        ext: "webm",
        seeThrough: false,
      },
      first,
      (n) => done.push(n),
      () => {},
      new AbortController().signal,
      (c) => canvases.push(c),
    );
    expect(blob.type).toBe("video/webm");
    expect(made).toHaveLength(2);
    expect(canvases).toHaveLength(1);
    expect(canvases[0]).not.toBe(first);
    expect(canvases[0].getAttribute("aria-label")).toBe("The video frame being rendered");
    // Frame 1 from the first canvas, frames 2 and 3 from the new one.
    expect(frames).toEqual([first, canvases[0], canvases[0]]);
    expect(done).toEqual([1, 2, 3]);
  });
});
