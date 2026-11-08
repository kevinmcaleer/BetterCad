/**
 * The Render view's state (#197), shared by the picture and its options bar, which load together on first use.
 * Framework-free and tiny, so the shell can hold it without the path tracer.
 */
export type LightPresetId = "studio" | "daylight" | "workbench" | "lightbox";
export type SaveSize = "view" | "double" | "4k";
/** What is behind the model and what it stands on. */
export type BackgroundId = "lightbox" | "grey" | "workbench" | "holodeck";
/** How long the picture keeps clearing: each step adds samples and takes longer. */
export type RenderQuality = "good" | "better" | "best";
export const QUALITIES: { id: RenderQuality; label: string; samples: number }[] = [
  { id: "good", label: "Good", samples: 128 },
  { id: "better", label: "Better", samples: 512 },
  { id: "best", label: "Best", samples: 2048 },
];
export const samplesFor = (q: RenderQuality) => QUALITIES.find((x) => x.id === q)!.samples;
/** Each body's colour and finish, or every part in matte paper white (a clay render). */
export type RenderStyle = "finishes" | "paper";

export interface RenderState {
  /** The renderer module is loading. */
  loading: boolean;
  preset: LightPresetId;
  style: RenderStyle;
  background: BackgroundId;
  /** Where the picture stops adding samples. */
  quality: RenderQuality;
  samples: number;
  /** Orbiting: the picture waits for you to stop. */
  moving: boolean;
  /** No WebGL2, or under 2 samples after a few seconds. */
  slow: boolean;
  /** Saving a picture: 0 to 1, or null. */
  saving: number | null;
}

export interface RenderSession {
  get(): RenderState;
  set(change: Partial<RenderState>): void;
  subscribe(fn: () => void): () => void;
  /** Set by the picture once it can save. */
  save: ((size: SaveSize) => Promise<void>) | null;
}

export function renderSession(style: RenderStyle = "finishes"): RenderSession {
  let state: RenderState = {
    loading: true,
    preset: "studio",
    style,
    background: "lightbox",
    quality: "better",
    samples: 0,
    moving: false,
    slow: false,
    saving: null,
  };
  const subs = new Set<() => void>();
  return {
    get: () => state,
    set(change) {
      state = { ...state, ...change };
      for (const f of subs) f();
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    save: null,
  };
}

/** "24 samples", "1 sample". */
export const samplesText = (n: number) => `${n.toLocaleString("en-GB")} ${n === 1 ? "sample" : "samples"}`;
