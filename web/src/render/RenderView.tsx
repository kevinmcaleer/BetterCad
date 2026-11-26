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
  FOCUSES,
  QUALITIES,
  samplesFor,
  samplesText,
  type DrawOnState,
  type RenderSession,
  type SaveSize,
} from "./session";
import { DEFAULT_CAMERA, lookFrom, orbit, pan, PRESETS, rollBy, viewRotation, zoom, type CameraState } from "../viewport/camera";
import { fit } from "../viewport/fitSphere";
import { Box3, Sphere, Vector3 } from "three";
import type { Section } from "../viewport/engine";
import type { CutPlane } from "./cut";

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
  onSaveVideo?: (video: Promise<Blob | null>, ext: "mp4" | "webm") => Promise<void>;
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
}: RenderPictureProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const r = useRef<PathRender | null>(null);
  const cam = useRef(camera);
  const state = useSession(session);

  // Start once: the tracer, its size, the camera and the loop.
  useEffect(() => {
    const el = canvas.current!;
    let pr: PathRender;
    try {
      pr = new PathRender(el, { onSample: (n) => session.get().samples !== n && session.set({ samples: n }) });
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
    return () => {
      ro.disconnect();
      session.save = null;
      pr.dispose();
      r.current = null;
    };
    // The tracer lives as long as the view; bodies, preset and camera update it below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => r.current?.setBodies(bodies, cutPlane(section)), [bodies, section]);
  useEffect(() => r.current?.setPreset(state.preset), [state.preset]);
  useEffect(() => r.current?.setStyle(state.style), [state.style]);
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
  }, [state.stopped]);
  useEffect(() => r.current?.setBackground(state.background), [state.background]);
  useEffect(() => r.current?.setFocus(FOCUSES.find((f) => f.id === state.focus)!.aperture), [state.focus]);
  useEffect(() => {
    if (r.current) r.current.maxSamples = testMax() ?? samplesFor(state.quality);
  }, [state.quality]);

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
  }, [move, hold]);

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

  // Esc leaves Draw on first, back to the picture.
  useEscape(!!state.drawOn, () => session.set({ drawOn: null }), ESC.tool);
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
        ref={canvas}
        className="bc-render-canvas"
        role="img"
        aria-label={`Rendered picture of the model, ${samplesText(state.samples)}`}
        // Where the camera looks from, for tests: named views move it.
        data-look={`${Math.round(cam.current.azimuth)} ${Math.round(cam.current.elevation)}`}
      />
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
  const status = d
    ? d.recording
      ? `Recording the video, ${secs(d.at)} of ${secs(d.total)}`
      : d.total
        ? `Draw on, ${secs(d.at)} of ${secs(d.total)}`
        : "Draw on"
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
    disabled: !rendering && (done || s.loading || s.slow || !!d),
    onClick: () => session.set({ stopped: rendering }),
  };
  const save: MenuEntry[] = SIZES.map((z) => ({
    id: z.id,
    label: z.label,
    disabled: s.saving !== null || s.slow || !!d,
    onSelect: () => void session.save?.(z.id),
  }));
  return { s, status, rendering, go, save };
}

/** "3 s", "12.5 s". */
const secs = (t: number) => `${(Math.round(t * 10) / 10).toLocaleString("en-GB")} s`;

/** Draw on's controls, for the ribbon and the floating bar: on and off, play, length, colour and Save video. */
function useDrawOn(session: RenderSession) {
  const s = useSession(session);
  const d = s.drawOn;
  const set = (change: Partial<DrawOnState>) => d && session.set({ drawOn: { ...d, ...change } });
  const toggle = () => (d ? session.set({ drawOn: null }) : session.set({ drawOn: { ...DRAW_ON_START }, stopped: true }));
  const ended = !!d && !d.playing && d.total > 0 && d.at >= d.total - 1e-3;
  const play = {
    icon: (d?.playing ? "pause" : ended ? "replay" : "play") as IconName,
    title: d?.playing ? "Pause" : ended ? "Play again" : "Play",
    short: d?.playing ? "Pause" : ended ? "Again" : "Play",
    disabled: !d || d.recording,
    onClick: () => (ended ? session.replay?.() : set({ playing: !d?.playing })),
  };
  const lengths: MenuEntry[] = DRAW_LENGTHS.map((l) => ({
    id: l.id,
    label: l.label,
    checked: d?.length === l.id,
    disabled: d?.recording,
    onSelect: () => set({ length: l.id }),
  }));
  const colours: MenuEntry[] = DRAW_COLOURS.map((c) => ({
    id: c.id,
    label: c.label,
    checked: d?.colour === c.id,
    disabled: d?.recording,
    onSelect: () => set({ colour: c.id }),
  }));
  const canRecord = typeof MediaRecorder !== "undefined";
  const record = {
    title: !canRecord ? "Your browser can't record video" : d?.recording ? "Recording the video" : "Save video: plays it from the start and records it",
    disabled: !d || d.recording || !canRecord,
    onClick: () => void session.record?.(),
  };
  return { d, toggle, play, lengths, colours, record };
}

/**
 * The Render view's options, in place of the view bar: lighting, the sample count, Save image and Done. With the
 * ribbon, only the status and Start (or Stop): the Render tab holds the options, and choosing another tab goes back
 * to modelling.
 */
export function RenderBar({ session, onClose, onExportGltf, onNote, ribbon }: RenderBarProps) {
  const { s, status, rendering, go, save } = useStatus(session);
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
          {/* The ribbon's Start, again beside the status where the eye already is: both work the same session. */}
          {!go.disabled && (
            <Button
              size="dense"
              icon={go.icon}
              label={rendering ? "Stop" : "Start"}
              title={go.title}
              variant={rendering ? "danger" : "primary"}
              onClick={go.onClick}
            />
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
        <IconButton className={rendering ? "bc-render-go bc-render-stop" : "bc-render-go"} {...go} />
        <QualityBar session={session} />
        <span className="bc-armed-note bc-render-status" role="status">
          {status}
        </span>
        <MenuButton label="Save image" entries={save} trigger={(p) => <Button {...p} icon="download" label="Save image" title="Save the picture as a PNG" />} />
        <DrawOnButtons session={session} />
        <Button kind="done" label="Done" title="Back to modelling" shortcut="Esc" onClick={onClose} />
      </div>
      {slow}
    </>
  );
}

/** Draw on in the floating bar: the switch, and once on, play and Save video. */
function DrawOnButtons({ session }: { session: RenderSession }) {
  const { d, toggle, play, record } = useDrawOn(session);
  return (
    <>
      <Button icon="sparkle" label="Draw on" title="Draw on: glowing lines trace the model, then it fills in" on={!!d} onClick={toggle} />
      {d && (
        <>
          <IconButton icon={play.icon} title={play.title} disabled={play.disabled} onClick={play.onClick} />
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
  const { s, rendering, go, save } = useStatus(session);
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
          icon={go.icon}
          colour={false}
          label={go.title}
          short={rendering ? "Stop" : "Start"}
          done={!rendering && !go.disabled}
          disabled={go.disabled}
          onPress={go.onClick}
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
        {draw.d && (
          <>
            <RibbonButton
              icon={draw.play.icon}
              colour={false}
              label={draw.play.title}
              short={draw.play.short}
              disabled={draw.play.disabled}
              onPress={draw.play.onClick}
            />
            <RibbonMenu icon="sliders" label={`Length: ${DRAW_LENGTHS.find((x) => x.id === draw.d!.length)!.label}`} short="Length" entries={draw.lengths} />
            <RibbonMenu
              icon="paint"
              colour="sliders"
              label={`Colour: ${DRAW_COLOURS.find((x) => x.id === draw.d!.colour)!.label}`}
              short="Colour"
              entries={draw.colours}
            />
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
