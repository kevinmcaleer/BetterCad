import { useEffect, useRef, useSyncExternalStore } from "react";
import { Banner, Button, MenuButton, type MenuEntry } from "@bettercad/ui";
import { LIGHT_PRESETS, PathRender, type RenderBody } from "./pathRender";
import { samplesText, type RenderSession, type SaveSize } from "./session";
import { orbit, pan, zoom, type CameraState } from "../viewport/camera";

/** Under this many samples after SLOW_MS, the browser can't render this well. */
const SLOW_MS = 8000;
const SLOW_SAMPLES = 2;
/** Samples a saved picture gets at least, so a quick save isn't a noisy one. */
const SAVE_SAMPLES = 64;

export const SLOW_TEXT = "Your browser can't render this well. Export glTF to render in Blender.";

const useSession = (s: RenderSession) => useSyncExternalStore(s.subscribe, s.get);

export interface RenderPictureProps {
  session: RenderSession;
  bodies: RenderBody[];
  /** Where the modelling view's camera is; the picture starts from it. */
  camera: CameraState;
  /** The camera moved in the render view, so the modelling view can follow when you go back. */
  onCamera: (c: CameraState) => void;
  /** Saves the picture's PNG. */
  onSave: (png: Blob, size: SaveSize) => Promise<void>;
}

/**
 * The Render view's picture (#197): a path-traced image of the model that clears over a few seconds. Drag to orbit
 * (right drag pans, the wheel zooms); the picture waits while you move and starts again when you stop.
 */
export function RenderPicture({ session, bodies, camera, onCamera, onSave }: RenderPictureProps) {
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
    const t = window as unknown as { __bcRenderMax?: number };
    if (t.__bcRenderMax) pr.maxSamples = t.__bcRenderMax;
    const fit = () => pr.setSize(Math.max(1, el.clientWidth), Math.max(1, el.clientHeight));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    pr.setCamera(cam.current);
    session.set({ loading: false, samples: 0 });
    pr.start();
    const slow = window.setTimeout(() => pr.samples < SLOW_SAMPLES && session.set({ slow: true }), SLOW_MS);
    session.save = async (size) => {
      const w = el.clientWidth,
        h = el.clientHeight;
      const [sw, sh] =
        size === "4k" ? [3840, 2160] : size === "double" ? [w * 2, h * 2] : [w * (window.devicePixelRatio || 1), h * (window.devicePixelRatio || 1)];
      session.set({ saving: 0 });
      try {
        const png = await pr.snapshot(Math.round(sw), Math.round(sh), Math.max(SAVE_SAMPLES, pr.samples), (f) => session.set({ saving: f }));
        await onSave(png, size);
      } finally {
        session.set({ saving: null });
      }
    };
    return () => {
      window.clearTimeout(slow);
      ro.disconnect();
      session.save = null;
      pr.dispose();
      r.current = null;
    };
    // The tracer lives as long as the view; bodies, preset and camera update it below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => r.current?.setBodies(bodies), [bodies]);
  useEffect(() => r.current?.setPreset(state.preset), [state.preset]);
  useEffect(() => r.current?.setStyle(state.style), [state.style]);

  // Orbit, pan and zoom with the modelling view's own camera moves.
  useEffect(() => {
    const el = canvas.current!;
    let last: { x: number; y: number; button: number } | null = null;
    const move = (c: CameraState) => {
      cam.current = c;
      r.current?.setCamera(c);
      onCamera(c);
    };
    const down = (e: PointerEvent) => {
      last = { x: e.clientX, y: e.clientY, button: e.button };
      el.setPointerCapture(e.pointerId);
      r.current?.pause(true);
      session.set({ moving: true });
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
      r.current?.pause(false);
      session.set({ moving: false });
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
  }, [onCamera, session]);

  return <canvas ref={canvas} className="bc-render-canvas" role="img" aria-label={`Rendered picture of the model, ${samplesText(state.samples)}`} />;
}

export interface RenderBarProps {
  session: RenderSession;
  onClose: () => void;
  onExportGltf: () => void;
}

const SIZES: { id: SaveSize; label: string }[] = [
  { id: "view", label: "View size" },
  { id: "double", label: "Twice the view size" },
  { id: "4k", label: "3840 × 2160" },
];

/** The Render view's options, in place of the view bar: lighting, the sample count, Save image and Done. */
export function RenderBar({ session, onClose, onExportGltf }: RenderBarProps) {
  const s = useSession(session);
  const save: MenuEntry[] = SIZES.map((z) => ({ id: z.id, label: z.label, disabled: s.saving !== null || s.slow, onSelect: () => void session.save?.(z.id) }));
  const status = s.loading
    ? "Loading the renderer…"
    : s.saving !== null
      ? `Saving the picture, ${Math.round(s.saving * 100)}%`
      : s.moving
        ? "Waiting for you to stop moving"
        : samplesText(s.samples);
  return (
    <>
      <div role="group" aria-label="Render options" className="bc-tools bc-armed bc-render-bar">
        <span className="bc-tools-title">Render</span>
        <MenuButton
          label="Lighting"
          entries={LIGHT_PRESETS.map((p) => ({ id: p.id, label: p.label, checked: s.preset === p.id, onSelect: () => session.set({ preset: p.id }) }))}
          trigger={(p) => <Button {...p} icon="sun" label={LIGHT_PRESETS.find((x) => x.id === s.preset)!.label} title="Lighting" />}
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
        <span className="bc-armed-note bc-render-status" role="status">
          {status}
        </span>
        <MenuButton label="Save image" entries={save} trigger={(p) => <Button {...p} icon="download" label="Save image" title="Save the picture as a PNG" />} />
        <Button kind="done" label="Done" title="Back to modelling" shortcut="Esc" onClick={onClose} />
      </div>
      {s.slow && (
        <Banner tone="warn" action={<Button size="dense" label="Export glTF" title="Export the model for Blender" onClick={onExportGltf} />}>
          {SLOW_TEXT}
        </Banner>
      )}
    </>
  );
}
