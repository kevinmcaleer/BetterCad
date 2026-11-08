/**
 * The Render view's state (#197), shared by the picture and its options bar, which load together on first use.
 * Framework-free and tiny, so the shell can hold it without the path tracer.
 */
export type LightPresetId = "studio" | "daylight" | "workbench";
export type SaveSize = "view" | "double" | "4k";
/** Each body's colour and finish, or every part in matte paper white (a clay render). */
export type RenderStyle = "finishes" | "paper";

export interface RenderState {
  /** The renderer module is loading. */
  loading: boolean;
  preset: LightPresetId;
  style: RenderStyle;
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

export function renderSession(): RenderSession {
  let state: RenderState = { loading: true, preset: "studio", style: "finishes", samples: 0, moving: false, slow: false, saving: null };
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
