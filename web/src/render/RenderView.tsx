import { lazy, Suspense, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  Banner,
  Button,
  ESC,
  Icon,
  IconButton,
  MenuButton,
  RibbonButton,
  RibbonGroup,
  useEscape,
  ViewCube,
  type IconName,
  type MenuEntry,
} from "@bettercad/ui";
import { BACKGROUNDS } from "./backgrounds";
import { LIGHT_PRESETS, PathRender, type RenderBody } from "./pathRender";
import {
  DRAW_COLOURS,
  DRAW_LENGTHS,
  DRAW_ON_START,
  drawSeconds,
  FOCUSES,
  FRAME_SAMPLES,
  moveStart,
  PLAY_MODES,
  QUALITIES,
  samplesFor,
  samplesText,
  filmProgress,
  type DrawOnState,
  type Filming,
  type MoveState,
  type PlayMode,
  type RenderSession,
  type SaveSize,
} from "./session";
import { DEFAULT_CAMERA, lookFrom, orbit, pan, PRESETS, rollBy, viewRotation, zoom, type CameraState } from "../viewport/camera";
import { fit } from "../viewport/fitSphere";
import { Box3, Sphere, Vector3 } from "three";
import type { Section } from "../viewport/engine";
import type { CutPlane } from "./cut";
import { CAMERA_MOVES, cameraAt, cameraMove, framingOf, movePreset } from "./cameraMoves";
import { canRenderVideo, frameCount, recordCanvas, VIDEO_HEIGHT, VIDEO_WIDTH, videoExt, videoType } from "./video";

/** Under this many samples after SLOW_MS, the browser can't render this well. */
const SLOW_MS = 8000;
const SLOW_SAMPLES = 2;
/** Samples a saved picture gets at least, so a quick save isn't a noisy one. */
const SAVE_SAMPLES = 64;

export const SLOW_TEXT = "Your browser can't render this well. Export glTF to render in Blender.";
/** A passing note, in a toast, when the picture is coming but slowly (a tablet, say). */
export const SLUGGISH_TEXT = "Rendering is slow on this device. The picture still clears, just give it longer.";

/** The section as a plane through its pushed origin. */
function cutPlane(s: Section | null): CutPlane | null {
  if (!s) return null;
  const l = Math.hypot(...s.normal) || 1;
  const n: [number, number, number] = [s.normal[0] / l, s.normal[1] / l, s.normal[2] / l];
  return { normal: n, point: [s.origin[0] + n[0] * s.offset, s.origin[1] + n[1] * s.offset, s.origin[2] + n[2] * s.offset] };
}

/** Draw on loads on first use: its player and bloom pass stay out of the render chunk. */
const DrawOnPicture = lazy(() => import("./DrawOn"));

/** Tests cap the samples so a software GPU finishes. */
const testMax = () => (window as unknown as { __bcRenderMax?: number }).__bcRenderMax;

const useSession = (s: RenderSession) => useSyncExternalStore(s.subscribe, s.get);

export interface RenderPictureProps {
  session: RenderSession;
  bodies: RenderBody[];
  /** The section tool's cut, if one is on: the picture shows the model cut there too. */
  section?: Section | null;
  /** Where the modelling view's camera is; the picture starts from it. */
  camera: CameraState;
  /** The camera moved in the render view, so the modelling view can follow when you go back. */
  onCamera: (c: CameraState) => void;
  /**
   * Saves the picture's PNG. Called at once on the click with the picture still being made, so it can ask where to
   * save while the browser allows it.
   */
  onSave: (png: Promise<Blob>, size: SaveSize) => Promise<void>;
  /** The model's home view, if one is set; otherwise home is the corner view, fitted to the model. */
  home?: CameraState | null;
  onSetHome?: (camera: CameraState) => void;
  onResetHome?: () => void;
  /** Saves Draw on's video. Called at once on the click with the video still recording. */
  onSaveVideo?: (video: Promise<Blob | null>, ext: "mp4" | "webm", name?: string) => Promise<void>;
  /**
   * Runs a video render in the background (the render jobs' `film`), so it outlives the view. Without it, Video
   * render does nothing.
   */
  onFilm?: (start: Filming, work: (update: (change: Partial<Filming>) => void, signal: AbortSignal) => Promise<Blob>) => Promise<Blob>;
}

/** The corner view (or the front, side or top), fitted round the bodies: home when the model has none of its own. */
function cornerView(bodies: RenderBody[], aspect: number, from: "iso" | "front" | "side" | "top" = "iso"): CameraState {
  const box = new Box3();
  const p = new Vector3();
  for (const b of bodies) {
    const pos = b.mesh.positions;
    for (let i = 0; i < pos.length; i += 3) box.expandByPoint(p.set(pos[i], pos[i + 1], pos[i + 2]).applyMatrix4(b.matrix));
  }
  if (box.isEmpty()) return { ...DEFAULT_CAMERA, ...PRESETS[from] };
  const s = box.getBoundingSphere(new Sphere());
  return fit({ ...DEFAULT_CAMERA, ...PRESETS[from] }, [s.center.x, s.center.y, s.center.z], s.radius, aspect);
}

/**
 * The Render view's picture (#197): a path-traced image of the model that clears over a few seconds. Drag to orbit
 * (right drag pans, the wheel zooms); the picture waits while you move and starts again when you stop.
 */
export function RenderPicture({
  session,
  bodies,
  section = null,
  camera,
  onCamera,
  onSave,
  home = null,
  onSetHome,
  onResetHome,
  onSaveVideo,
  onFilm,
}: RenderPictureProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const sectionRef = useRef(section);
  sectionRef.current = section;
  const r = useRef<PathRender | null>(null);
  const cam = useRef(camera);
  const state = useSession(session);
  // Goes up when the graphics card drops the picture's context: a new canvas and tracer take over.
  const [gen, setGen] = useState(0);

  // Start once (and again after a dropped context): the tracer, its size, the camera and the loop.
  useEffect(() => {
    const el = canvas.current!;
    let pr: PathRender;
    try {
      pr = new PathRender(el, { alpha: true, onSample: (n) => session.get().samples !== n && session.set({ samples: n }) });
    } catch {
      session.set({ loading: false, slow: true });
      return;
    }
    r.current = pr;
    pr.maxSamples = testMax() ?? samplesFor(session.get().quality);
    const fit = () => pr.setSize(Math.max(1, el.clientWidth), Math.max(1, el.clientHeight));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    pr.setCamera(cam.current);
    session.set({ loading: false, samples: 0 });
    pr.start();
    session.save = async (size) => {
      const w = el.clientWidth,
        h = el.clientHeight;
      const [sw, sh] = size === "4k" ? [3840, 2160] : size === "double" ? [w * 2, h * 2] : [el.width, el.height];
      session.set({ saving: 0 });
      const stop = new AbortController();
      const png = pr.snapshot(Math.round(sw), Math.round(sh), testMax() ?? Math.max(SAVE_SAMPLES, pr.samples), (f) => session.set({ saving: f }), stop.signal);
      png.catch(() => {});
      try {
        await onSave(png, size);
      } finally {
        // Cancelled in the picker: stop rendering a picture nobody will keep.
        stop.abort();
        await png.catch(() => {});
        session.set({ saving: null });
      }
    };
    const lost = () => setGen((g) => g + 1);
    el.addEventListener("webglcontextlost", lost);
    return () => {
      el.removeEventListener("webglcontextlost", lost);
      ro.disconnect();
      session.save = null;
      pr.dispose();
      r.current = null;
    };
    // The tracer lives as long as the view; bodies, preset and camera update it below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gen]);

  useEffect(() => r.current?.setBodies(bodies, cutPlane(section)), [bodies, section, gen]);
  useEffect(() => r.current?.setPreset(state.preset), [state.preset, gen]);
  useEffect(() => r.current?.setStyle(state.style), [state.style, gen]);
  useEffect(() => {
    const pr = r.current;
    pr?.hold(state.stopped);
    if (!pr || state.stopped) return;
    // Started: a slow GPU shows in the first few seconds of samples.
    const from = pr.samples;
    const slow = window.setTimeout(() => pr.samples - from < SLOW_SAMPLES && session.set({ sluggish: true }), SLOW_MS);
    return () => window.clearTimeout(slow);
    // r.current is set in the effect above, which runs first.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.stopped, gen]);
  useEffect(() => r.current?.setBackground(state.background), [state.background, gen]);
  useEffect(() => r.current?.setFocus(FOCUSES.find((f) => f.id === state.focus)!.aperture), [state.focus, gen]);
  useEffect(() => {
    if (r.current) r.current.maxSamples = testMax() ?? samplesFor(state.quality);
  }, [state.quality, gen]);

  const [rotation, setRotation] = useState(() => viewRotation(cam.current));
  const move = useCallback(
    (c: CameraState) => {
      cam.current = c;
      r.current?.setCamera(c);
      setRotation(viewRotation(c));
      onCamera(c);
    },
    [onCamera],
  );
  /** Dragging the picture or the view cube: the picture waits until you stop. */
  const hold = useCallback(
    (on: boolean) => {
      r.current?.pause(on);
      session.set({ moving: on });
    },
    [session],
  );

  // Orbit, pan and zoom with the modelling view's own camera moves.
  useEffect(() => {
    const el = canvas.current!;
    let last: { x: number; y: number; button: number } | null = null;
    const down = (e: PointerEvent) => {
      // Grabbing the picture stops a camera move where it is, so you can look round from there.
      const m = session.get().move;
      if (m?.playing && !m.recording && !session.get().drawOn) session.set({ move: { ...m, playing: false } });
      last = { x: e.clientX, y: e.clientY, button: e.button };
      el.setPointerCapture(e.pointerId);
      hold(true);
    };
    const drag = (e: PointerEvent) => {
      if (!last) return;
      const dx = e.clientX - last.x,
        dy = e.clientY - last.y;
      last = { ...last, x: e.clientX, y: e.clientY };
      move(last.button === 0 && !e.shiftKey ? orbit(cam.current, -dx * 0.4, dy * 0.4) : pan(cam.current, dx, dy, el.clientHeight));
    };
    const up = () => {
      if (!last) return;
      last = null;
      hold(false);
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const b = el.getBoundingClientRect();
      const nx = ((e.clientX - b.left) / b.width) * 2 - 1,
        ny = 1 - ((e.clientY - b.top) / b.height) * 2;
      move(zoom(cam.current, Math.exp(e.deltaY * 0.0015), nx, ny, b.width / Math.max(1, b.height)));
    };
    const menu = (e: Event) => e.preventDefault();
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", drag);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("wheel", wheel, { passive: false });
    el.addEventListener("contextmenu", menu);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", drag);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      el.removeEventListener("wheel", wheel);
      el.removeEventListener("contextmenu", menu);
    };
  }, [move, hold, session]);

  const goHome = useCallback(() => {
    const el = canvas.current!;
    move(home ? { ...home, ortho: false } : cornerView(bodies, el.clientWidth / Math.max(1, el.clientHeight)));
  }, [move, home, bodies]);
  useEffect(() => {
    session.look = move;
    session.camera = () => cam.current;
    session.standard = (v) => {
      const el = canvas.current!;
      if (v === "home") goHome();
      else move(cornerView(bodies, el.clientWidth / Math.max(1, el.clientHeight), v));
    };
    session.canvas = () => canvas.current;
    session.size = () => ({ width: canvas.current?.clientWidth ?? 0, height: canvas.current?.clientHeight ?? 0 });
    return () => {
      session.look = null;
      session.camera = null;
      session.standard = null;
      session.size = null;
      session.canvas = null;
    };
  }, [session, move, goHome, bodies]);

  // Esc leaves Draw on first, back to the picture, then a camera move.
  useEscape(!!state.drawOn, () => session.set({ drawOn: null }), ESC.tool);
  useEscape(!state.drawOn && !!state.move && !state.move.recording, () => session.set({ move: null }), ESC.tool);

  // A camera move on its own (Draw on plays its own): a clock turns the picture's camera round the model, showing the
  // quick preview as it goes, and the picture clears again where it ends.
  const solo = !state.drawOn && state.move ? state.move : null;
  const soloId = solo?.id ?? null;
  const soloLength = solo?.length ?? "normal";
  /** Where the last move started from, and where it left the camera: a new length or Play again starts there too. */
  const moveFrom = useRef<{ from: CameraState; left: CameraState } | null>(null);
  useEffect(() => {
    const pr = r.current;
    const el = canvas.current!;
    if (!soloId || !pr) return;
    const total = drawSeconds(soloLength);
    const plan = cameraMove(soloId, total);
    const framing = framingOf(
      bodies.map((b) => ({ positions: b.mesh.positions, matrix: b.matrix.elements })),
      1,
    );
    let t = 0,
      last = performance.now(),
      frame = 0,
      told = -1,
      playing = false;
    // Where the move starts from: your view as the move begins, kept for Play again unless you have looked round since.
    const kept = moveFrom.current;
    let from = kept && cam.current === kept.left ? kept.from : cam.current,
      shown: CameraState | null = null;
    const ends: (() => void)[] = [];
    const patch = (c: Partial<MoveState>) => {
      const m = session.get().move;
      if (m) session.set({ move: { ...m, ...c } });
    };
    const at = (time: number) => (framing ? cameraAt(plan, from, { ...framing, aspect: el.clientWidth / Math.max(1, el.clientHeight) }, time) : from);
    const show = (c: CameraState) => {
      shown = cam.current = c;
      pr.setCamera(c);
      setRotation(viewRotation(c));
    };
    const halt = () => {
      if (!playing) return;
      playing = false;
      // Leave the camera where the move got to, so orbiting and the cube carry on from there.
      if (shown) {
        move(shown);
        moveFrom.current = { from, left: shown };
      }
      pr.pause(false);
    };
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (!playing) return;
      t = Math.min(total, t + dt);
      show(at(t));
      if (Math.floor(t * 10) !== told) {
        told = Math.floor(t * 10);
        patch({ at: t, total });
      }
      if (t >= total) {
        halt();
        patch({ playing: false, at: total, total });
        for (const f of ends.splice(0)) f();
      }
    };
    const begin = () => {
      if (t >= total) t = 0;
      if (t === 0 && shown && cam.current !== shown) from = cam.current;
      shown = null;
      playing = true;
      last = performance.now();
      pr.pause(true);
    };
    const sync = () => {
      const m = session.get().move;
      const want = !!m?.playing && !session.get().drawOn;
      if (want && !playing) begin();
      else if (!want && playing) halt();
    };
    const replay = () => {
      t = 0;
      if (shown && cam.current !== shown) from = cam.current;
      told = -1;
      patch({ playing: true, at: 0, total });
      sync();
    };
    session.replayMove = replay;
    session.recordMove = async () => {
      const m = session.get().move;
      const clear = session.get().background === "transparent";
      const type = videoType(clear);
      if (!m || m.recording || !type) return;
      const done = new Promise<void>((resolve) => ends.push(resolve));
      session.set({ move: { ...m, recording: true } });
      const video = recordCanvas(el, () => done, undefined, clear).then((v) => v?.blob ?? null);
      replay();
      try {
        await onSaveVideo?.(video, type.startsWith("video/mp4") ? "mp4" : "webm", movePreset(m.id).label.toLowerCase());
      } finally {
        await video.catch(() => null);
        patch({ recording: false, playing: false });
      }
    };
    patch({ total, at: 0 });
    const unsubscribe = session.subscribe(sync);
    sync();
    frame = requestAnimationFrame(tick);
    return () => {
      unsubscribe();
      cancelAnimationFrame(frame);
      halt();
      for (const f of ends.splice(0)) f();
      session.replayMove = null;
      session.recordMove = null;
    };
    // A new move, length or model starts it again; the camera and callbacks are read through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soloId, soloLength, bodies, session]);

  // Video render: the camera move path-traced frame by frame, as pictures are, into a full HD video. It runs in the
  // background with its own path tracer, so it keeps going when you leave the Render view.
  const saveVideo = useRef(onSaveVideo);
  saveVideo.current = onSaveVideo;
  const filmRef = useRef(onFilm);
  filmRef.current = onFilm;
  useEffect(() => {
    session.renderVideo = async () => {
      const m = session.get().move;
      const run = filmRef.current;
      if (!run || !m || session.get().filming || !canRenderVideo()) return;
      const now = session.get();
      // On the Transparent background: a WebM, which keeps it see-through (an MP4 can't).
      const clear = now.background === "transparent";
      const ext = clear ? "webm" : videoExt();
      const seconds = drawSeconds(m.length);
      const plan = cameraMove(m.id, seconds);
      const frames = frameCount(seconds);
      const kept = moveFrom.current;
      const from = kept && cam.current === kept.left ? kept.from : cam.current;
      const framing = framingOf(
        bodies.map((b) => ({ positions: b.mesh.positions, matrix: b.matrix.elements })),
        VIDEO_WIDTH / VIDEO_HEIGHT,
      );
      const samples = testMax() ?? FRAME_SAMPLES[now.quality];
      const label = movePreset(m.id).label;
      const setup = {
        bodies,
        cut: cutPlane(sectionRef.current),
        preset: now.preset,
        style: now.style,
        background: now.background,
        aperture: FOCUSES.find((f) => f.id === now.focus)!.aperture,
        samples,
        frames,
        at: (i: number) => (framing ? cameraAt(plan, from, framing, (i / (frames - 1)) * seconds) : from),
        ext,
        seeThrough: clear,
      };
      const film = document.createElement("canvas");
      film.className = "bc-render-film";
      film.setAttribute("role", "img");
      film.setAttribute("aria-label", "The video frame being rendered");
      session.set({ move: { ...m, playing: false }, drawOn: null, stopped: true });
      const video = run({ name: `${label} video`, frame: 0, frames, sample: 0, samples, started: performance.now(), canvas: film }, (update, signal) =>
        import("./renderVideo").then(({ filmVideo }) =>
          filmVideo(
            setup,
            film,
            (frame) => update({ frame }),
            (sample) => update({ sample }),
            signal,
            (canvas) => update({ canvas }),
          ),
        ),
      );
      await saveVideo.current?.(
        video.catch(() => null),
        ext,
        `${label.toLowerCase()} render`,
      );
    };
    return () => {
      session.renderVideo = null;
    };
  }, [session, bodies]);
  const camNow = useCallback(() => cam.current, []);

  const orbiting = useRef(false);
  // As the modelling view's cube, less the projection: a path-traced picture is always in perspective.
  const cubeMenu: MenuEntry[] = [
    { id: "home", label: "Go home", icon: "home", onSelect: goHome },
    { kind: "separator", id: "s1" },
    { id: "set-home", label: "Set this view as home", onSelect: () => onSetHome?.(cam.current) },
    { id: "reset-home", label: "Reset home", disabled: !home, onSelect: () => onResetHome?.() },
  ];
  return (
    <>
      <canvas
        key={gen}
        ref={canvas}
        className="bc-render-canvas"
        role="img"
        aria-label={`Rendered picture of the model, ${samplesText(state.samples)}`}
        // Where the camera looks from, for tests: named views move it.
        data-look={`${Math.round(cam.current.azimuth)} ${Math.round(cam.current.elevation)}`}
      />
      {state.filming?.canvas && <FilmPicture canvas={state.filming.canvas} />}
      {state.drawOn && (
        <Suspense fallback={null}>
          <DrawOnPicture session={session} bodies={bodies} camera={camNow} onSaveVideo={onSaveVideo} />
        </Suspense>
      )}
      {/* The render's own view cube: it turns the picture's camera, as the modelling view's turns that one. */}
      <div className="bc-render-cube">
        <ViewCube
          rotation={rotation}
          onPick={(d) => move(lookFrom(cam.current, d))}
          onOrbit={(dx, dy) => {
            if (!orbiting.current) hold((orbiting.current = true));
            move(orbit(cam.current, -dx * 0.5, dy * 0.5));
          }}
          onOrbitEnd={() => {
            orbiting.current = false;
            hold(false);
          }}
          onRoll={(dir) => move(rollBy(cam.current, dir))}
          onHome={goHome}
          menu={cubeMenu}
        />
      </div>
    </>
  );
}

export interface RenderBarProps {
  session: RenderSession;
  /** Shows a passing note in the top-right toast. */
  onNote?: (text: string) => void;
  onClose: () => void;
  onExportGltf: () => void;
  /** The ribbon's Render tab holds the options, and another tab leaves the view: the bar keeps only the status. */
  ribbon?: boolean;
}

const SIZES: { id: SaveSize; label: string }[] = [
  { id: "view", label: "View size" },
  { id: "double", label: "Twice the view size" },
  { id: "4k", label: "3840 × 2160" },
];

/**
 * Where `n` samples sit along the quality bar, 0 to 1: the three stops (Good, Better, Best) sit at a third, two
 * thirds and the end, and the fill moves evenly between them, so it reaches each stop as that quality is done.
 */
export function barPosition(n: number): number {
  let lo = 0;
  for (let i = 0; i < QUALITIES.length; i++) {
    const hi = QUALITIES[i].samples;
    if (n <= hi) return (i + Math.max(0, n - lo) / (hi - lo)) / QUALITIES.length;
    lo = hi;
  }
  return 1;
}

/** A video render's frame as it clears, over the picture: its own canvas, which outlives the view. */
function FilmPicture({ canvas }: { canvas: HTMLCanvasElement }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current!;
    el.appendChild(canvas);
    return () => {
      if (canvas.parentNode === el) el.removeChild(canvas);
    };
  }, [canvas]);
  return <div ref={box} className="bc-render-film-box" />;
}

/** "about 3 min left", from how long the frames so far took; nothing until a frame is done. */
function timeLeft(f: Filming, now = performance.now()): string {
  const done = filmProgress(f);
  if (f.frame < 1 || done <= 0 || done >= 1) return "";
  const left = (((now - f.started) / done) * (1 - done)) / 1000;
  if (left < 60) return ", under a minute left";
  const mins = Math.round(left / 60);
  if (mins < 60) return `, about ${mins} min left`;
  const hours = Math.floor(mins / 60);
  return `, about ${hours} h ${mins % 60} min left`;
}

/** The status while a video renders: the frame in hand, counting from 1, and the time left. */
export function filmingText(f: Filming, now?: number): string {
  const n = Math.min(f.frame + 1, f.frames);
  return `Rendering the video, frame ${n.toLocaleString("en-GB")} of ${f.frames.toLocaleString("en-GB")}${timeLeft(f, now)}`;
}

/** Two bars under the status while a video renders: the frame in hand as its samples come in, and the whole video. */
function FilmBars({ session }: { session: RenderSession }) {
  const f = useSession(session).filming;
  if (!f) return null;
  const frame = f.frame >= f.frames ? 1 : Math.min(1, f.sample / Math.max(1, f.samples));
  const all = filmProgress(f);
  const bar = (label: string, v: number, text: string) => (
    <span
      className="bc-render-film-bar"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(v * 100)}
      aria-valuetext={text}
    >
      <span style={{ width: `${v * 100}%` }} />
    </span>
  );
  return (
    <span className="bc-render-film-bars" title={`This frame ${Math.round(frame * 100)}%, the whole video ${Math.round(all * 100)}%`}>
      {bar("This frame", frame, `${Math.min(f.sample, f.samples).toLocaleString("en-GB")} of ${samplesText(f.samples)}`)}
      {bar("Whole video", all, `${Math.round(all * 100)}%`)}
    </span>
  );
}

/**
 * The samples taken so far as a bar that fills, with the Good, Better, Best slider on top of it: the picture stops
 * when the fill reaches the slider's stop.
 */
function QualityBar({ session }: { session: RenderSession }) {
  const s = useSession(session);
  const q = QUALITIES.findIndex((x) => x.id === s.quality);
  const fill = Math.min(barPosition(s.samples), barPosition(samplesFor(s.quality)));
  return (
    <div className="bc-render-quality" title="More samples clear the picture further but take longer">
      <div className="bc-render-quality-stops">
        {QUALITIES.map((x) => (
          <button key={x.id} type="button" tabIndex={-1} aria-hidden data-on={x.id === s.quality || undefined} onClick={() => session.set({ quality: x.id })}>
            {x.label}
          </button>
        ))}
      </div>
      <div className="bc-render-quality-track">
        <div className="bc-render-quality-fill" style={{ width: `${fill * 100}%` }} />
        <input
          type="range"
          aria-label="Quality"
          aria-valuetext={`${QUALITIES[q].label}, ${samplesText(QUALITIES[q].samples)}`}
          min={0}
          max={QUALITIES.length - 1}
          step={1}
          value={q}
          onChange={(e) => session.set({ quality: QUALITIES[Number(e.currentTarget.value)].id })}
        />
      </div>
    </div>
  );
}

/** Where the picture has got, and what Start and Save can do now: for the floating bar and the ribbon's Render tab. */
function useStatus(session: RenderSession) {
  const s = useSession(session);
  const max = testMax() ?? samplesFor(s.quality);
  const d = s.drawOn;
  // The animation that owns the clock: Draw on, or a camera move on its own.
  const m = d ? null : s.move;
  const clip = d ?? m;
  const name = d ? "Draw on" : m ? movePreset(m.id).label : "";
  const status = s.filming
    ? filmingText(s.filming)
    : clip
      ? clip.recording
        ? `Recording the video, ${secs(clip.at)} of ${secs(clip.total)}`
        : clip.total
          ? `${name}, ${secs(clip.at)} of ${secs(clip.total)}`
          : name
      : s.loading
        ? "Loading the renderer…"
        : s.saving !== null
          ? `Saving the picture, ${Math.round(s.saving * 100)}%`
          : s.moving
            ? "Waiting for you to stop moving"
            : s.stopped && s.samples <= 1
              ? "Press Start to render"
              : `${s.stopped ? "Stopped at " : ""}${s.samples.toLocaleString("en-GB")} of ${samplesText(max)}`;
  const done = s.samples >= max;
  const rendering = !s.stopped && !done && !s.loading && !s.slow;
  const go = {
    icon: (rendering ? "stop" : "play") as IconName,
    title: rendering ? "Stop rendering" : done ? "Finished: raise the quality to keep going" : "Start rendering",
    disabled: !rendering && (done || s.loading || s.slow || !!d || !!m?.playing),
    onClick: () => session.set({ stopped: rendering }),
  };
  const save: MenuEntry[] = SIZES.map((z) => ({
    id: z.id,
    label: z.label,
    disabled: s.saving !== null || s.slow || !!d || !!m?.playing || !!s.filming,
    onSelect: () => void session.save?.(z.id),
  }));
  return { s, status, rendering, go, save, play: usePlay(session, go) };
}

/**
 * The one Play button: what it does depends on the mode picked from its drop-down. Image renders the picture (Start,
 * or Stop while it clears); Video preview plays Draw on or the camera move live; Video render path-traces every frame
 * of the camera move and saves the video. Picking a mode from the drop-down runs it at once.
 */
function usePlay(session: RenderSession, go: { icon: IconName; title: string; disabled: boolean; onClick: () => void }) {
  const s = useSession(session);
  const mode = s.playMode;
  const d = s.drawOn;
  const m = s.move;
  const clip = d ?? m;
  const ended = !!clip && !clip.playing && clip.total > 0 && clip.at >= clip.total - 1e-3;
  const recording = !!d?.recording || !!m?.recording;
  const run = (to: PlayMode) => {
    const now = session.get();
    if (to === "image") {
      // The picture shows once the animation is put away.
      if (now.drawOn || now.move?.playing) {
        session.set({ drawOn: null, move: now.move && { ...now.move, playing: false }, stopped: false });
        return;
      }
      go.onClick();
    } else if (to === "preview") {
      const c = now.drawOn ?? now.move;
      // Nothing to animate yet: an orbit is the plainest move.
      if (!c) session.set({ move: moveStart("orbit"), stopped: true });
      else if (!c.playing && c.total > 0 && c.at >= c.total - 1e-3) (now.drawOn ? session.replay : session.replayMove)?.();
      else if (now.drawOn) session.set({ drawOn: { ...now.drawOn, playing: !now.drawOn.playing } });
      else session.set({ move: { ...now.move!, playing: !now.move!.playing } });
    } else {
      if (now.filming) return session.stopVideo?.();
      // A video render needs a camera move: an orbit unless one is picked. Draw on plays as a preview only.
      if (!now.move) session.set({ move: { ...moveStart("orbit"), playing: false } });
      void session.renderVideo?.();
    }
  };
  const busy = s.loading || s.slow;
  const state =
    mode === "image"
      ? {
          icon: go.icon,
          title: d || m?.playing ? "Render the picture" : go.title,
          short: go.icon === "stop" ? "Stop" : "Play",
          disabled: busy || (go.disabled && !d && !m?.playing),
        }
      : mode === "preview"
        ? {
            icon: (clip?.playing ? "pause" : ended ? "replay" : "play") as IconName,
            title: clip?.playing ? "Pause" : ended ? "Play again" : clip ? "Play" : "Play an orbit round the model",
            short: clip?.playing ? "Pause" : ended ? "Again" : "Play",
            disabled: busy || recording || !!s.filming,
          }
        : {
            icon: (s.filming ? "stop" : "play") as IconName,
            title: s.filming
              ? "Stop the video render"
              : canRenderVideo()
                ? `Render the ${m ? movePreset(m.id).label.toLowerCase() : "orbit"} frame by frame and save the video`
                : "Your browser can't render video",
            short: s.filming ? "Stop" : "Play",
            disabled: busy || recording || (!s.filming && !canRenderVideo()),
          };
  const modes: MenuEntry[] = PLAY_MODES.map((x) => ({
    id: x.id,
    label: x.label,
    checked: mode === x.id,
    disabled: busy || recording || !!s.filming || (x.id === "video" && !canRenderVideo()),
    onSelect: () => {
      session.set({ playMode: x.id });
      run(x.id);
    },
  }));
  const label = PLAY_MODES.find((x) => x.id === mode)!.label;
  return { ...state, mode, label, modes, onClick: () => run(mode), stop: state.icon === "stop" };
}

/** "3 s", "12.5 s". */
const secs = (t: number) => `${(Math.round(t * 10) / 10).toLocaleString("en-GB")} s`;

/**
 * The Animate controls, for the ribbon and the floating bar: Draw on on and off, a camera move, and for whichever is
 * on, play, length, colour and Save video. With both on, the move turns the camera through Draw on's whole length.
 */
function useDrawOn(session: RenderSession) {
  const s = useSession(session);
  const d = s.drawOn;
  const m = s.move;
  // The clock: Draw on's, or the move's when it plays on its own.
  const clip = d ?? m;
  const recording = !!d?.recording || !!m?.recording;
  const set = (change: Partial<DrawOnState>) => d && session.set({ drawOn: { ...d, ...change } });
  const toggle = () =>
    d
      ? session.set({ drawOn: null, move: m && { ...m, playing: true, at: 0 } })
      : session.set({ drawOn: { ...DRAW_ON_START, length: m?.length ?? DRAW_ON_START.length }, stopped: true });
  const length = d?.length ?? m?.length ?? "normal";
  const lengths: MenuEntry[] = DRAW_LENGTHS.map((l) => ({
    id: l.id,
    label: l.label,
    checked: length === l.id,
    disabled: recording,
    // One length for both: Draw on's drawing, and a move on its own.
    onSelect: () =>
      session.set({
        ...(d && { drawOn: { ...d, length: l.id } }),
        ...(m && { move: { ...m, length: l.id, playing: true, at: 0 } }),
      }),
  }));
  const colours: MenuEntry[] = DRAW_COLOURS.map((c) => ({
    id: c.id,
    label: c.label,
    checked: d?.colour === c.id,
    disabled: d?.recording,
    onSelect: () => set({ colour: c.id }),
  }));
  const moves: MenuEntry[] = [
    {
      id: "none",
      label: "No camera move",
      checked: !m,
      disabled: recording,
      onSelect: () => session.set({ move: null }),
    },
    { kind: "separator", id: "s" },
    ...CAMERA_MOVES.map((p) => ({
      id: p.id,
      label: p.label,
      checked: m?.id === p.id,
      disabled: recording,
      onSelect: () => {
        session.set({ move: moveStart(p.id, length) });
        // With Draw on, the move goes with the drawing: both from the start.
        if (d) session.replay?.();
      },
    })),
  ];
  const canRecord = typeof MediaRecorder !== "undefined";
  const record = {
    title: !canRecord ? "Your browser can't record video" : recording ? "Recording the video" : "Save video: plays it from the start and records it",
    disabled: !clip || recording || !canRecord,
    onClick: () => void (d ? session.record : session.recordMove)?.(),
  };
  return { d, m, clip, toggle, length, lengths, colours, moves, record };
}

/**
 * The Render view's options, in place of the view bar: lighting, the sample count, Save image and Done. With the
 * ribbon, only the status and Start (or Stop): the Render tab holds the options, and choosing another tab goes back
 * to modelling.
 */
export function RenderBar({ session, onClose, onExportGltf, onNote, ribbon }: RenderBarProps) {
  const { s, status, save, play } = useStatus(session);
  // A slow render still works, so it gets a toast that fades rather than a banner over the picture.
  useEffect(() => {
    if (s.sluggish && !s.slow) onNote?.(SLUGGISH_TEXT);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.sluggish]);
  const slow = s.slow && (
    <Banner tone="warn" action={<Button size="dense" label="Export glTF" title="Export the model for Blender" onClick={onExportGltf} />}>
      {SLOW_TEXT}
    </Banner>
  );
  if (ribbon)
    return (
      <>
        <div role="group" aria-label="Render options" className="bc-tools bc-armed bc-render-bar">
          <span className="bc-tools-title">Render</span>
          <span className="bc-armed-note bc-render-status" role="status">
            {status}
          </span>
          <FilmBars session={session} />
          {/* The ribbon's Play, again beside the status where the eye already is: both work the same session. */}
          {!play.disabled && (
            <Button size="dense" icon={play.icon} label={play.short} title={play.title} variant={play.stop ? "danger" : "primary"} onClick={play.onClick} />
          )}
        </div>
        {slow}
      </>
    );
  return (
    <>
      <div role="group" aria-label="Render options" className="bc-tools bc-armed bc-render-bar">
        <span className="bc-tools-title">Render</span>
        <MenuButton
          label="Lighting"
          entries={LIGHT_PRESETS.map((p) => ({ id: p.id, label: p.label, checked: s.preset === p.id, onSelect: () => session.set({ preset: p.id }) }))}
          trigger={(p) => <Button {...p} icon="sun" label={LIGHT_PRESETS.find((x) => x.id === s.preset)!.label} title="Lighting" />}
        />
        <MenuButton
          label="Background"
          entries={BACKGROUNDS.map((b) => ({ id: b.id, label: b.label, checked: s.background === b.id, onSelect: () => session.set({ background: b.id }) }))}
          trigger={(p) => <Button {...p} icon="image" label={BACKGROUNDS.find((x) => x.id === s.background)!.label} title="Background" />}
        />
        <MenuButton
          label="Depth of field"
          entries={FOCUSES.map((f) => ({ id: f.id, label: f.label, checked: s.focus === f.id, onSelect: () => session.set({ focus: f.id }) }))}
          trigger={(p) => <Button {...p} icon="camera" label={FOCUSES.find((x) => x.id === s.focus)!.label} title="Depth of field" />}
        />
        <span role="group" aria-label="Surface" className="bc-segmented">
          <Button label="Colours" title="Each part's colour and finish" on={s.style === "finishes"} onClick={() => session.set({ style: "finishes" })} />
          <Button
            label="Paper"
            title="Every part in matte paper white, to show the shape"
            on={s.style === "paper"}
            onClick={() => session.set({ style: "paper" })}
          />
        </span>
        <span className="bc-render-play">
          <IconButton
            className={play.stop ? "bc-render-go bc-render-stop" : "bc-render-go"}
            icon={play.icon}
            title={play.title}
            disabled={play.disabled}
            onClick={play.onClick}
          />
          <MenuButton label="Play" entries={play.modes} trigger={(p) => <Button {...p} size="dense" icon="chevronDown" title={`Play: ${play.label}`} />} />
        </span>
        <QualityBar session={session} />
        <span className="bc-armed-note bc-render-status" role="status">
          {status}
        </span>
        <FilmBars session={session} />
        <MenuButton label="Save image" entries={save} trigger={(p) => <Button {...p} icon="download" label="Save image" title="Save the picture as a PNG" />} />
        <DrawOnButtons session={session} />
        <Button kind="done" label="Done" title="Back to modelling" shortcut="Esc" onClick={onClose} />
      </div>
      {slow}
    </>
  );
}

/** Draw on and camera moves in the floating bar: the switch, the move, and once either is on, play and Save video. */
function DrawOnButtons({ session }: { session: RenderSession }) {
  const { d, m, clip, toggle, moves, record } = useDrawOn(session);
  return (
    <>
      <Button icon="sparkle" label="Draw on" title="Draw on: glowing lines trace the model, then it fills in" on={!!d} onClick={toggle} />
      <MenuButton
        label="Camera move"
        entries={moves}
        trigger={(p) => <Button {...p} icon="rotate" title={`Camera move: ${m ? movePreset(m.id).label : "none"}`} />}
      />
      {clip && (
        <>
          <IconButton icon="video" title={record.title} disabled={record.disabled} onClick={record.onClick} />
        </>
      )}
    </>
  );
}

/** A ribbon button that opens a menu: Lighting, Background, Focus and Save image. */
function RibbonMenu({
  icon,
  colour,
  label,
  short,
  entries,
}: {
  icon: IconName;
  colour?: string | boolean;
  label: string;
  short: string;
  entries: MenuEntry[];
}) {
  return (
    <MenuButton
      label={label}
      entries={entries}
      trigger={(t) => (
        <button {...t} type="button" className="bc-rb" aria-label={label} data-tip={label}>
          <Icon name={icon} size={28} colour={colour ?? true} />
          <span className="bc-rb-label">{short}</span>
        </button>
      )}
    />
  );
}

export interface RenderRibbonProps {
  session: RenderSession;
  /** Keeps this view on the film strip, rendering in the background. */
  onAdd?: () => void;
}

/**
 * The ribbon's Render tab (desktop): the scene, the picture's quality, the strip and saving. It is a workspace like
 * the others, so there is no Done: another tab (or Esc) goes back to modelling.
 */
export function RenderRibbon({ session, onAdd }: RenderRibbonProps) {
  const { s, save, play } = useStatus(session);
  const draw = useDrawOn(session);
  const pick = <T extends { id: string; label: string }>(list: readonly T[], on: string, set: (id: T["id"]) => void): MenuEntry[] =>
    list.map((x) => ({ id: x.id, label: x.label, checked: on === x.id, onSelect: () => set(x.id) }));
  return (
    <>
      <RibbonGroup label="Scene" entries={[]}>
        <RibbonMenu
          icon="sun"
          label={`Lighting: ${LIGHT_PRESETS.find((x) => x.id === s.preset)!.label}`}
          short="Lighting"
          entries={pick(LIGHT_PRESETS, s.preset, (preset) => session.set({ preset }))}
        />
        <RibbonMenu
          icon="image"
          label={`Background: ${BACKGROUNDS.find((x) => x.id === s.background)!.label}`}
          short="Background"
          entries={pick(BACKGROUNDS, s.background, (background) => session.set({ background }))}
        />
        <RibbonMenu
          icon="camera"
          label={`Depth of field: ${FOCUSES.find((x) => x.id === s.focus)!.label}`}
          short="Focus"
          entries={pick(FOCUSES, s.focus, (focus) => session.set({ focus }))}
        />
      </RibbonGroup>
      <RibbonGroup label="Surface" entries={[]}>
        <RibbonButton
          icon="sliders"
          colour="sliders"
          label="Colours: each part's colour and finish"
          short="Colours"
          pressed={s.style === "finishes"}
          onPress={() => session.set({ style: "finishes" })}
        />
        <RibbonButton
          icon="shapes"
          colour="shapes"
          label="Paper: every part in matte white, to show the shape"
          short="Paper"
          pressed={s.style === "paper"}
          onPress={() => session.set({ style: "paper" })}
        />
      </RibbonGroup>
      <RibbonGroup label="Render" entries={[]}>
        <RibbonButton
          icon={play.icon}
          colour={false}
          label={play.title}
          short={play.short}
          done={!play.stop && !play.disabled}
          disabled={play.disabled}
          onPress={play.onClick}
        />
        <MenuButton
          label="Play"
          entries={play.modes}
          trigger={(t) => (
            <button
              {...t}
              type="button"
              className="bc-rb bc-rb-more"
              aria-label={`Play: ${play.label}`}
              data-tip="What Play does: an image, a video preview or a video render"
            >
              <span className="bc-rb-label">{play.label}</span>
              <Icon name="chevronDown" size={14} />
            </button>
          )}
        />
        <QualityBar session={session} />
      </RibbonGroup>
      <RibbonGroup label="Animate" entries={[]}>
        <RibbonButton
          icon="sparkle"
          label="Draw on: glowing lines trace the model, then it fills in"
          short="Draw on"
          pressed={!!draw.d}
          onPress={draw.toggle}
        />
        <RibbonMenu icon="rotate" label={`Camera move: ${draw.m ? movePreset(draw.m.id).label : "none"}`} short="Camera" entries={draw.moves} />
        {draw.clip && (
          <>
            <RibbonMenu icon="sliders" label={`Length: ${DRAW_LENGTHS.find((x) => x.id === draw.length)!.label}`} short="Length" entries={draw.lengths} />
            {draw.d && (
              <RibbonMenu
                icon="paint"
                colour="sliders"
                label={`Colour: ${DRAW_COLOURS.find((x) => x.id === draw.d!.colour)!.label}`}
                short="Colour"
                entries={draw.colours}
              />
            )}
            <RibbonButton icon="video" label={draw.record.title} short="Save video" disabled={draw.record.disabled} onPress={draw.record.onClick} />
          </>
        )}
      </RibbonGroup>
      {onAdd && (
        <RibbonGroup label="Strip" entries={[]}>
          <RibbonButton icon="plus" colour="camera" label="Add to strip: keep this view and render it in the background" short="Add to strip" onPress={onAdd} />
        </RibbonGroup>
      )}
      <RibbonGroup label="Output" entries={[]}>
        <RibbonMenu icon="download" colour="printer" label="Save image" short="Save image" entries={save} />
      </RibbonGroup>
    </>
  );
}
