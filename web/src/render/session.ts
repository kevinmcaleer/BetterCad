/**
 * The Render view's state (#197), shared by the picture and its options bar, which load together on first use.
 * Framework-free and tiny, so the shell can hold it without the path tracer.
 */
import type { CameraState } from "../viewport/camera";
import type { CameraMoveId } from "./cameraMoves";

export type LightPresetId = "studio" | "daylight" | "workbench" | "lightbox";
export type SaveSize = "view" | "double" | "4k";
/** What is behind the model and what it stands on. */
export type BackgroundId = "lightbox" | "grey" | "workbench" | "holoroom" | "replicator" | "transparent";
/** Depth of field: everything sharp, or the model sharp and what is nearer and further softly or strongly blurred. */
export type FocusId = "sharp" | "soft" | "shallow";
export const FOCUSES: { id: FocusId; label: string; title: string; /** Aperture as a share of the distance to the model. */ aperture: number }[] = [
  { id: "sharp", label: "All sharp", title: "Everything in focus", aperture: 0 },
  { id: "soft", label: "Soft focus", title: "The model sharp, the background softly blurred", aperture: 0.012 },
  { id: "shallow", label: "Shallow focus", title: "Only the middle of the model sharp, like a close-up photo", aperture: 0.035 },
];
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
/** Draw on's glow: a neon colour, or each part's own. */
export type DrawOnColour = "blue" | "amber" | "green" | "white" | "parts";
export const DRAW_COLOURS: { id: DrawOnColour; label: string }[] = [
  { id: "blue", label: "Neon blue" },
  { id: "amber", label: "Amber" },
  { id: "green", label: "Green" },
  { id: "white", label: "White" },
  { id: "parts", label: "Each part's colour" },
];
/** How long Draw on takes to draw every edge. */
export type DrawOnLength = "quick" | "normal" | "slow";
export const DRAW_LENGTHS: { id: DrawOnLength; label: string; seconds: number }[] = [
  { id: "quick", label: "Quick, 5 s", seconds: 5 },
  { id: "normal", label: "Normal, 10 s", seconds: 10 },
  { id: "slow", label: "Slow, 20 s", seconds: 20 },
];
export const drawSeconds = (l: DrawOnLength) => DRAW_LENGTHS.find((x) => x.id === l)!.seconds;

/** Draw on (the glowing build-up animation): whether it is showing, how, and where it has got. */
export interface DrawOnState {
  colour: DrawOnColour;
  length: DrawOnLength;
  playing: boolean;
  /** Seconds in, and the whole length. */
  at: number;
  total: number;
  /** Recording a video: true until it is saved. */
  recording: boolean;
}

/**
 * A camera move round the model (orbit, sweep, push in): which, how long, and where it has got. With Draw on showing,
 * the move spans Draw on's whole length and Draw on's clock drives it; on its own it has its own clock, below.
 */
export interface MoveState {
  id: CameraMoveId;
  length: DrawOnLength;
  playing: boolean;
  at: number;
  total: number;
  recording: boolean;
}

export interface RenderState {
  /** The renderer module is loading. */
  loading: boolean;
  preset: LightPresetId;
  style: RenderStyle;
  background: BackgroundId;
  focus: FocusId;
  /** Where the picture stops adding samples. */
  quality: RenderQuality;
  samples: number;
  /**
   * Not rendering: the view opens stopped, showing a first look, until you press Start. The stop button stops it
   * again, keeping the picture so far, so background renders get the GPU.
   */
  stopped: boolean;
  /** Orbiting: the picture waits for you to stop. */
  moving: boolean;
  /** No WebGL2: the browser can't render at all. */
  slow: boolean;
  /** Rendering, but slowly (under 2 samples after a few seconds): worth a passing note, not a warning. */
  sluggish: boolean;
  /** Saving a picture: 0 to 1, or null. */
  saving: number | null;
  /** Draw on is showing in place of the picture, or null. */
  drawOn: DrawOnState | null;
  /** A camera move is on, or null. */
  move: MoveState | null;
}

export interface RenderSession {
  get(): RenderState;
  set(change: Partial<RenderState>): void;
  subscribe(fn: () => void): () => void;
  /** Set by the picture once it can save. */
  save: ((size: SaveSize) => Promise<void>) | null;
  /** Set by the picture: moves its camera (the film strip's Use this view, a named view in the browser). */
  look: ((camera: CameraState) => void) | null;
  /** Set by the picture: where its camera is now, for saving a named view from the render. */
  camera: (() => CameraState) | null;
  /** Set by the picture: goes home, or looks from the front, side or top fitted round the model. */
  standard: ((view: "home" | "front" | "side" | "top") => void) | null;
  /** Set by the picture: its canvas, for the film strip's first look at a new shot. */
  canvas: (() => HTMLCanvasElement | null) | null;
  /** Set by the picture: the size it is drawn at, in CSS pixels. */
  size: (() => { width: number; height: number }) | null;
  /** Set by Draw on once it shows: plays from the start, and records a video of it. */
  replay: (() => void) | null;
  record: (() => Promise<void>) | null;
  /** Set by the picture while a camera move plays on its own (without Draw on): the same two. */
  replayMove: (() => void) | null;
  recordMove: (() => Promise<void>) | null;
}

export function renderSession(style: RenderStyle = "finishes"): RenderSession {
  let state: RenderState = {
    loading: true,
    preset: "studio",
    style,
    background: "lightbox",
    focus: "soft",
    quality: "better",
    samples: 0,
    stopped: true,
    moving: false,
    slow: false,
    sluggish: false,
    saving: null,
    drawOn: null,
    move: null,
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
    look: null,
    camera: null,
    standard: null,
    canvas: null,
    size: null,
    replay: null,
    record: null,
    replayMove: null,
    recordMove: null,
  };
}

/** "24 samples", "1 sample". */
export const samplesText = (n: number) => `${n.toLocaleString("en-GB")} ${n === 1 ? "sample" : "samples"}`;

/** Draw on as it opens: neon blue, normal length, playing. */
export const DRAW_ON_START: DrawOnState = { colour: "blue", length: "normal", playing: true, at: 0, total: 0, recording: false };

/** A camera move as it starts: playing from the start, as long as Draw on (if it is on) or normal length. */
export const moveStart = (id: CameraMoveId, length: DrawOnLength = "normal"): MoveState => ({
  id,
  length,
  playing: true,
  at: 0,
  total: drawSeconds(length),
  recording: false,
});
