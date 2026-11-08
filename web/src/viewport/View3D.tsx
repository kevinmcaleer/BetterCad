import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ViewCube, type MenuEntry } from "@bettercad/ui";
import { primitiveMesh, type BodyMesh, type KernelState } from "@bettercad/kernel";
import type { Part } from "../state/document";
import { DEFAULT_CAMERA, viewRotation, type CameraState, type Preset, type V3 } from "./camera";
import { Engine, canDraw3D, type RenderStyle, type Section, type Stats, type WorldPlaneName } from "./engine";
import { formatMilestones, milestone } from "../perf";
import type { Pick, SelectFilter } from "./ids";

export type ViewMode = "select" | "move" | "turn" | "section" | "none";

export interface View3DHandle {
  preset(p: Preset): void;
  fit(ids?: string[]): void;
  /** Go home: to `camera`, or the corner view fitted. */
  home(camera?: CameraState | null): void;
  camera(): CameraState;
  setCamera(c: CameraState, animate?: boolean): void;
  /** The engine, for tools that draw over the view or take the pointer (sketching). */
  engine(): Engine | null;
}

export interface View3DProps {
  parts: Part[];
  /** Meshes the kernel built, by part id, already in place. Parts without one draw the JS primitive. */
  meshes?: Map<string, { mesh: BodyMesh }>;
  /** The geometry engine's state, for the loading note. */
  engine?: KernelState;
  /** Whole parts picked (body filter), and faces, edges and vertices picked (the other filters). */
  picks: Pick[];
  filter: SelectFilter;
  mode: ViewMode;
  style: RenderStyle;
  ortho: boolean;
  section: Section | null;
  stats: boolean;
  /** For screen readers: what is in the view. */
  description: string;
  onPick: (pick: Pick | null, mods: { shift: boolean; mod: boolean }) => void;
  onTransform: (id: string, position: V3, rotation: V3) => void;
  onTransforming?: (id: string, position: V3, rotation: V3) => void;
  onSection: (s: Section) => void;
  onCamera?: (c: CameraState) => void;
  /** The printer's bed to draw (#100), or null for none. */
  bed?: { x: number; y: number; z: number; origin: "centre" | "corner" } | null;
  /** Bodies off the bed, tinted warn. */
  warn?: Set<string>;
  /** A print check's per-vertex tint by body (#101, #102). */
  check?: Map<string, Float32Array> | null;
  /** Origin planes on show from the browser, and the one chosen there. */
  /** Origin planes on show and the one picked, and whether the origin point shows. */
  originPlanes?: { shown: WorldPlaneName[]; chosen: WorldPlaneName | null; point?: boolean };
  /** Whether to show the empty-model hint (off while sketching). */
  emptyHint?: boolean;
  /** The view cube's Go home button and its menu. */
  onHome?: () => void;
  cubeMenu?: MenuEntry[];
  /** Labels drawn over the canvas (the sketch's sizes and marks). */
  children?: ReactNode;
}

/** Meshes by shape and size, so a part's triangles are made once. The kernel worker replaces this with #4. */
const meshCache = new Map<string, BodyMesh>();
function meshFor(p: Part): BodyMesh | null {
  // A body from a sketch has no quick mesh: it shows once the kernel has built it.
  if (p.kind !== "box" && p.kind !== "cylinder" && p.kind !== "sphere") return null;
  const key = `${p.kind}:${p.size.x}:${p.size.y}:${p.size.z}`;
  let m = meshCache.get(key);
  if (!m) {
    m = primitiveMesh(p.kind, p.size);
    if (meshCache.size > 500) meshCache.clear();
    meshCache.set(key, m);
  }
  return m;
}

/** Space kept between the framed model and a floating bar, in CSS px. */
const FLOAT_GAP = 8;

/** The resolved theme on <html>, followed as it changes. */
function useDocumentTheme(): string {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme ?? "light");
  useEffect(() => {
    const el = document.documentElement;
    const obs = new MutationObserver(() => setTheme(el.dataset.theme ?? "light"));
    obs.observe(el, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);
  return theme;
}

/** The 3D view: the WebGL canvas, the view cube that turns with it, and (in dev) the frame-time overlay. */
export const View3D = forwardRef<View3DHandle, View3DProps>(function View3D(props, ref) {
  const { parts, meshes, engine: kernelState, picks, filter, mode, style, ortho, section, stats, description } = props;
  const host = useRef<HTMLDivElement>(null);
  const safe = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const engine = useRef<Engine | null>(null);
  const [supported] = useState(canDraw3D);
  const [rotation, setRotation] = useState(() => viewRotation(DEFAULT_CAMERA));
  const [frame, setFrame] = useState<Stats | null>(null);
  const theme = useDocumentTheme();
  const events = useRef(props);
  events.current = props;

  useImperativeHandle(
    ref,
    () => ({
      preset: (p) => engine.current?.preset(p),
      fit: (ids) => engine.current?.fit(ids),
      home: (c) => engine.current?.home(c),
      camera: () => engine.current?.goal ?? DEFAULT_CAMERA,
      setCamera: (c, animate = true) => engine.current?.setCamera(c, animate),
      engine: () => engine.current,
    }),
    [],
  );

  // One engine for the life of the view.
  useLayoutEffect(() => {
    if (!supported || !canvas.current) return;
    let lastRot = "";
    const e = new Engine(canvas.current, {
      camera: (c) => {
        const r = viewRotation(c);
        const key = r.map((v) => v.toFixed(4)).join();
        if (key !== lastRot) {
          lastRot = key;
          setRotation(r);
        }
        events.current.onCamera?.(c);
      },
      click: (pick, mods, at) => {
        const p = events.current;
        if (p.mode === "section") {
          const hit = engine.current?.surfaceAt(at.x, at.y);
          if (hit) p.onSection({ origin: hit.point, normal: hit.normal, offset: 0 });
          return;
        }
        p.onPick(pick, mods);
      },
      transform: (id, pos, rot) => events.current.onTransform(id, pos, rot),
      transforming: (id, pos, rot) => events.current.onTransforming?.(id, pos, rot),
      section: (offset) => {
        const s = events.current.section;
        if (s) events.current.onSection({ ...s, offset });
      },
      stats: (s) => setFrame(s),
    });
    engine.current = e;
    // Fit frames the model in the part of the view the floating panels leave clear: the probe's box (the
    // --bc-view-* insets), less the bars that float along the top and the bottom (marked data-floats).
    e.setSafeArea(() => {
      const h = host.current;
      const s = safe.current;
      if (!h || !s) return null;
      const hr = h.getBoundingClientRect();
      const sr = s.getBoundingClientRect();
      let top = sr.top;
      let bottom = sr.bottom;
      const mid = hr.top + hr.height / 2;
      for (const el of h.parentElement?.querySelectorAll<HTMLElement>(":scope > [data-floats] > *") ?? []) {
        const r = el.getBoundingClientRect();
        if (!r.height) continue;
        if (r.top + r.height / 2 < mid) top = Math.max(top, r.bottom + FLOAT_GAP);
        else bottom = Math.min(bottom, r.top - FLOAT_GAP);
      }
      return { left: sr.left - hr.left, top: top - hr.top, width: sr.width, height: bottom - top };
    });
    milestone("shell");
    // Test builds can ask where a world point lands on screen (the gizmo's handles, a face).
    if (import.meta.env.DEV || import.meta.env.VITE_GALLERY) (window as unknown as { __bcView?: Engine }).__bcView = e;
    const ro = new ResizeObserver(() => {
      const r = host.current!.getBoundingClientRect();
      e.setSize(r.width, r.height);
    });
    ro.observe(host.current!);
    const r = host.current!.getBoundingClientRect();
    e.setSize(r.width, r.height);
    return () => {
      ro.disconnect();
      e.dispose();
      engine.current = null;
    };
  }, [supported]);

  const bodies = useMemo(
    () =>
      parts
        .filter((p) => !p.hidden)
        .flatMap((p) => {
          const built = meshes?.get(p.id);
          const mesh = built?.mesh ?? meshFor(p);
          if (!mesh) return [];
          return {
            id: p.id,
            mesh,
            world: !!built,
            position: p.position,
            rotation: p.rotation,
            ghost: p.ghost,
            reference: p.reference,
            highlight: p.highlight,
            warn: props.warn?.has(p.id),
          };
        }),
    [parts, meshes, props.warn],
  );

  // Frame the model when the first part arrives (a new model, an opened file).
  const hadBodies = useRef(false);
  useEffect(() => {
    engine.current?.setBodies(bodies);
    if (bodies.length && !hadBodies.current) engine.current?.fit();
    hadBodies.current = bodies.length > 0;
  }, [bodies]);
  useEffect(() => engine.current?.setSelection(picks), [picks]);
  useEffect(() => engine.current?.setFilter(mode === "section" ? "face" : filter), [filter, mode]);
  useEffect(() => engine.current?.setHoverEnabled(mode === "select" || mode === "section" || mode === "move" || mode === "turn"), [mode]);
  useEffect(() => engine.current?.setTheme(theme === "holodeck"), [theme]);
  useEffect(() => engine.current?.setStyle(style), [style]);
  const check = props.check ?? null;
  useEffect(() => engine.current?.setCheck(check), [check, bodies]);
  const bed = props.bed;
  const bedKey = bed ? `${bed.x},${bed.y},${bed.z},${bed.origin}` : "";
  useEffect(() => {
    engine.current?.setBed(bed ?? null);
    // Only a different bed redraws it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bedKey]);
  const origin = props.originPlanes;
  const originKey = origin ? `${origin.shown.join(",")}|${origin.chosen ?? ""}|${origin.point ? 1 : 0}` : "";
  useEffect(() => {
    engine.current?.setOriginPlanes(origin?.shown ?? [], origin?.chosen ?? null, origin?.point ?? false);
    // Redrawn when the planes change, and with the bodies, so they keep to the model's size.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [originKey, bodies]);
  useEffect(() => engine.current?.setOrtho(ortho), [ortho]);
  useEffect(() => engine.current?.setSection(section, mode === "section"), [section, mode]);
  useEffect(() => engine.current?.showStats(stats), [stats]);
  useEffect(() => {
    if (!stats) setFrame(null);
  }, [stats]);
  // The gizmo sits on the one part picked while Move or Turn is armed.
  const gizmoPart = (mode === "move" || mode === "turn") && picks.length === 1 && picks[0]!.kind === "body" ? picks[0]!.body : null;
  useEffect(() => engine.current?.setGizmo(gizmoPart, mode === "turn" ? "rotate" : "translate"), [gizmoPart, mode, bodies]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || e.altKey || e.ctrlKey || e.metaKey) return;
    if (engine.current?.key(e.nativeEvent)) e.preventDefault();
  };

  return (
    <div
      id="bc-view"
      ref={host}
      className="bc-frame bc-viewport"
      tabIndex={0}
      role="application"
      aria-label={`3D view. ${description}`}
      aria-roledescription="3D view"
      aria-describedby="bc-view-keys"
      onKeyDown={onKeyDown}
    >
      <div ref={safe} className="bc-view-safe" aria-hidden="true" />
      <span id="bc-view-keys" className="bc-sr-only">
        Arrow keys turn the view, Shift and the arrow keys move it, plus and minus zoom.
      </span>
      {supported ? (
        <canvas ref={canvas} className="bc-canvas bc-view-canvas" data-testid="view-canvas" />
      ) : (
        <div className="bc-empty-view">
          <strong>Your browser cannot draw 3D here</strong>
          <span>Turn on hardware acceleration in your browser settings, or try another browser.</span>
        </div>
      )}
      {props.children}
      <ViewCube
        rotation={rotation}
        onPick={(d) => engine.current?.lookFrom(d)}
        onOrbit={(dx, dy) => engine.current?.orbitBy(dx, dy)}
        onHome={props.onHome}
        menu={props.cubeMenu}
      />
      {supported && parts.length === 0 && props.emptyHint !== false && (
        <div className="bc-view-hint" aria-hidden="true">
          Add a shape from the Library to start.
        </div>
      )}
      {kernelState?.status === "loading" && parts.length > 0 && (
        <div className="bc-view-engine" role="status">
          Loading the geometry engine ({Math.round(kernelState.fraction * 100)}%)
        </div>
      )}
      {frame && (
        <div className="bc-frame-stats" aria-hidden="true">
          {frame.ms.toFixed(1)} ms · {Math.round(frame.fps)} fps · {frame.triangles.toLocaleString()} triangles · {frame.calls} draws · {frame.bodies} bodies
          {formatMilestones() && ` · ${formatMilestones()}`}
        </div>
      )}
    </div>
  );
});
