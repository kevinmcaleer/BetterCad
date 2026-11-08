import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Button } from "./Button";
import { ContextMenu, MenuButton, type ContextMenuState, type MenuEntry } from "./Menu";

export type ViewName = "top" | "bottom" | "front" | "back" | "right" | "left";

export type V3 = [number, number, number];

interface Face {
  view: ViewName;
  label: string;
  n: V3;
  /** The face's own right and down, as you see it from outside. */
  right: V3;
  down: V3;
}

const FACES: Face[] = [
  { view: "top", label: "TOP", n: [0, 0, 1], right: [1, 0, 0], down: [0, -1, 0] },
  { view: "bottom", label: "BOTTOM", n: [0, 0, -1], right: [1, 0, 0], down: [0, 1, 0] },
  { view: "front", label: "FRONT", n: [0, -1, 0], right: [1, 0, 0], down: [0, 0, -1] },
  { view: "back", label: "BACK", n: [0, 1, 0], right: [-1, 0, 0], down: [0, 0, -1] },
  { view: "right", label: "RIGHT", n: [1, 0, 0], right: [0, 1, 0], down: [0, 0, -1] },
  { view: "left", label: "LEFT", n: [-1, 0, 0], right: [0, -1, 0], down: [0, 0, -1] },
];

/** The corner (iso) view: looking from front-right-top, Z up. Rows: the camera's right, up and back in world space. */
const ISO = (() => {
  const a = (-45 * Math.PI) / 180;
  const e = (35.264 * Math.PI) / 180;
  const back: V3 = [Math.cos(e) * Math.cos(a), Math.cos(e) * Math.sin(a), Math.sin(e)];
  const up: V3 = [-Math.sin(e) * Math.cos(a), -Math.sin(e) * Math.sin(a), Math.cos(e)];
  const right: V3 = [up[1] * back[2] - up[2] * back[1], up[2] * back[0] - up[0] * back[2], up[0] * back[1] - up[1] * back[0]];
  return [...right, ...up, ...back];
})();

const SIZE = 104;
const C = SIZE / 2;
/** The cube is 2 units across. Its own perspective camera sits 9.2 units back with a 32° field, so it always looks solid. */
const EYE = 9.2;
const FOCAL = C / Math.tan((16 * Math.PI) / 180);
/** Within 0.36 of an edge (of the 2-unit cube) counts as the edge or corner. */
const EDGE = 0.64;
/** Further than this many pixels and a press is a drag. */
const DRAG_PX = 3;

const add = (a: V3, b: V3, s = 1): V3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const key = (v: V3) => v.join(",");

/**
 * Which face, edge or corner a point on the cube's surface is: −1, 0 or 1 on each axis. Its direction is the way to
 * look from. The cube spans −1…1.
 */
export function classifyCubePoint(p: V3): V3 {
  const raw = p.map((v) => (Math.abs(v) >= EDGE ? Math.sign(v) : 0)) as V3;
  return raw[0] || raw[1] || raw[2] ? raw : [0, 0, 1];
}

/** "the front right top corner", "the front top edge", "the top": what a place on the cube is called. */
export function cubePlaceName(raw: V3): string {
  const words = [
    raw[1] < 0 ? "front" : raw[1] > 0 ? "back" : "",
    raw[0] > 0 ? "right" : raw[0] < 0 ? "left" : "",
    raw[2] > 0 ? "top" : raw[2] < 0 ? "bottom" : "",
  ].filter(Boolean);
  const kind = words.length === 3 ? " corner" : words.length === 2 ? " edge" : "";
  return `the ${words.join(" ")}${kind}`;
}

export interface ViewCubeProps {
  /** World → camera rotation, row-major 3×3 (rows: right, up, back). Defaults to the corner view. */
  rotation?: number[];
  /** A face, edge or corner was clicked: look from `dir` (not unit length: each part is −1, 0 or 1). */
  onPick?: (dir: V3) => void;
  /** The cube is being dragged: turn the view by this many pixels. */
  onOrbit?: (dxPx: number, dyPx: number) => void;
  onOrbitEnd?: () => void;
  /** Go home: shows a house by the cube while the pointer is over it (always, on touch screens). */
  onHome?: () => void;
  /** The cube's own menu (Go home, projection, home view), under a small arrow by the cube and on a right-click. */
  menu?: MenuEntry[];
}

/**
 * The view cube in the view's top-right corner, as in the kevsrobots project editor and Snakie's build workspace. It
 * turns with the camera. Click a face, edge or corner (26 places) to look from there; drag it to look around. The
 * place under the pointer lights up. X, Y and Z (red, green, blue) run along the edges from the bottom-front-left
 * corner.
 */
export function ViewCube({ rotation = ISO, onPick, onOrbit, onOrbitEnd, onHome, menu }: ViewCubeProps) {
  const r = rotation;
  const [hover, setHover] = useState<string | null>(null);
  const [context, setContext] = useState<ContextMenuState | null>(null);
  const press = useRef<{ x: number; y: number; lastX: number; lastY: number; moved: boolean; raw: V3 | null } | null>(null);

  const depthOf = (p: V3) => r[6]! * p[0] + r[7]! * p[1] + r[8]! * p[2];
  const proj = (p: V3) => {
    const s = FOCAL / (EYE - depthOf(p));
    return { x: C + s * (r[0]! * p[0] + r[1]! * p[1] + r[2]! * p[2]), y: C - s * (r[3]! * p[0] + r[4]! * p[1] + r[5]! * p[2]) };
  };
  const pts = (ps: V3[]) =>
    ps
      .map(proj)
      .map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`)
      .join(" ");
  // A face is seen when it turns towards the eye (perspective, so test from the eye, not just the view direction).
  const eye: V3 = [r[6]! * EYE, r[7]! * EYE, r[8]! * EYE];
  const sees = (centre: V3, n: V3) => (eye[0] - centre[0]) * n[0] + (eye[1] - centre[1]) * n[1] + (eye[2] - centre[2]) * n[2] > 0.02;

  const faces = FACES.filter((f) => sees(f.n, f.n)).sort((a, b) => depthOf(a.n) - depthOf(b.n));

  // The light-up box: a plate on a face, a bar on an edge, a block on a corner, drawn over the cube.
  const hl = hover ? (hover.split(",").map(Number) as V3) : null;
  const hlFaces = (() => {
    if (!hl) return [];
    const half = hl.map((v) => (v ? 0.12 : 0.98)) as V3;
    const out: { k: string; points: string }[] = [];
    for (let ax = 0; ax < 3; ax++) {
      for (const s of [-1, 1]) {
        const n: V3 = [0, 0, 0];
        n[ax] = s;
        const centre = add(hl, n, half[ax]!);
        if (!sees(centre, n)) continue;
        const u: V3 = [0, 0, 0];
        const v: V3 = [0, 0, 0];
        u[(ax + 1) % 3] = half[(ax + 1) % 3]!;
        v[(ax + 2) % 3] = half[(ax + 2) % 3]!;
        out.push({
          k: `${ax}${s}`,
          points: pts([add(add(centre, u), v), add(add(centre, u, -1), v), add(add(centre, u, -1), v, -1), add(add(centre, u), v, -1)]),
        });
      }
    }
    return out;
  })();

  // X, Y and Z along the edges from the bottom-front-left corner. The part on an edge shows when one of its faces does;
  // the part past the cube shows when its tip is nearer than the cube's centre.
  const corner: V3 = [-1, -1, -1];
  const axes = (
    [
      { name: "X", cls: "x", dir: [1, 0, 0] as V3, faces: [[0, -1, 0] as V3, [0, 0, -1] as V3] },
      { name: "Y", cls: "y", dir: [0, 1, 0] as V3, faces: [[-1, 0, 0] as V3, [0, 0, -1] as V3] },
      { name: "Z", cls: "z", dir: [0, 0, 1] as V3, faces: [[-1, 0, 0] as V3, [0, -1, 0] as V3] },
    ] as const
  ).map((a) => {
    const edgeEnd = add(corner, a.dir, 2);
    const end = add(corner, a.dir, 2.64);
    const tip = add(corner, a.dir, 3.04);
    return { ...a, edgeEnd, end, tip, onEdge: a.faces.some((n) => sees(n, n)), outFront: depthOf(end) > 0 };
  });
  const line = (cls: string, a: V3, b: V3, k: string) => {
    const p = proj(a);
    const q = proj(b);
    return <line key={k} className={`bc-axis-line bc-axis-line-${cls}`} x1={p.x} y1={p.y} x2={q.x} y2={q.y} aria-hidden="true" />;
  };
  const behind = axes.flatMap((a) => [!a.onEdge && line(a.cls, corner, a.edgeEnd, `${a.name}e`), !a.outFront && line(a.cls, a.edgeEnd, a.end, `${a.name}o`)]);
  const front = axes.flatMap((a) => [a.onEdge && line(a.cls, corner, a.edgeEnd, `${a.name}e`), a.outFront && line(a.cls, a.edgeEnd, a.end, `${a.name}o`)]);

  // A letter behind the cube is hidden by it, as on the kevsrobots editor's cube.
  const labels = (inFront: boolean) =>
    axes
      .filter((a) => depthOf(a.tip) > 0 === inFront)
      .map((a) => {
        const t = proj(a.tip);
        return (
          <text key={a.name} className={`bc-axis-${a.cls}`} x={t.x} y={t.y + 4} textAnchor="middle" aria-hidden="true">
            {a.name}
          </text>
        );
      });

  const placeAt = (target: EventTarget | null): V3 | null => {
    const raw = (target as Element | null)?.getAttribute?.("data-place");
    return raw ? (raw.split(",").map(Number) as V3) : null;
  };
  const onDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 || press.current) return;
    e.stopPropagation();
    press.current = { x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, moved: false, raw: placeAt(e.target) };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = press.current;
    if (d) {
      if (d.moved || Math.hypot(e.clientX - d.x, e.clientY - d.y) > DRAG_PX) {
        d.moved = true;
        onOrbit?.(e.clientX - d.lastX, e.clientY - d.lastY);
        setHover(null);
      }
      d.lastX = e.clientX;
      d.lastY = e.clientY;
      return;
    }
    const raw = placeAt(e.target);
    setHover(raw ? key(raw) : null);
  };
  const end = (e: ReactPointerEvent<SVGSVGElement>, cancelled: boolean) => {
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    const d = press.current;
    press.current = null;
    if (!d) return;
    if (d.moved) onOrbitEnd?.();
    else if (!cancelled && d.raw) onPick?.(d.raw);
  };

  return (
    <div className="bc-viewcube" role="group" aria-label="View cube">
      <svg
        className="bc-viewcube-svg"
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={(e) => end(e, false)}
        onPointerCancel={(e) => end(e, true)}
        onPointerLeave={() => !press.current && setHover(null)}
        onContextMenu={(e) => {
          e.preventDefault();
          if (menu?.length) setContext({ x: e.clientX, y: e.clientY });
        }}
      >
        <defs>
          <linearGradient id="bc-cube-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--bc-color-cube-face)" />
            <stop offset="1" stopColor="var(--bc-color-cube-face-low)" />
          </linearGradient>
        </defs>
        {behind}
        {labels(false)}
        {faces.map((f) => {
          const up = f.down.map((v) => -v) as V3;
          const left = f.right.map((v) => -v) as V3;
          const outline = [add(add(f.n, left), up), add(add(f.n, f.right), up), add(add(f.n, f.right), f.down), add(add(f.n, left), f.down)];
          const inset = (s: number) => [
            add(add(f.n, left, s), up, s),
            add(add(f.n, f.right, s), up, s),
            add(add(f.n, f.right, s), f.down, s),
            add(add(f.n, left, s), f.down, s),
          ];
          const c = proj(f.n);
          const pr = proj(add(f.n, f.right));
          const pd = proj(add(f.n, f.down));
          const u = { x: pr.x - c.x, y: pr.y - c.y };
          const v = { x: pd.x - c.x, y: pd.y - c.y };
          // Text is laid out for a face 25 px from centre to side, then bent onto the face as it is now.
          const k = 25;
          const name = `Look from the ${f.view}`;
          // The face in a 3 × 3 grid of places: its corners and edges are the cube's corners and edges.
          const bands = [
            [-1, -EDGE],
            [-EDGE, EDGE],
            [EDGE, 1],
          ] as const;
          const cells = [-1, 0, 1].flatMap((i) =>
            [-1, 0, 1].map((j) => {
              const [a0, a1] = bands[i + 1]!;
              const [b0, b1] = bands[j + 1]!;
              const at = (a: number, b: number) => add(add(f.n, f.right, a), f.down, b);
              const raw = add(add(f.n, f.right, i), f.down, j);
              return (
                <polygon key={`${i}${j}`} className="bc-cube-place" data-place={key(raw)} points={pts([at(a0, b0), at(a1, b0), at(a1, b1), at(a0, b1)])}>
                  <title>{`Look from ${cubePlaceName(raw)}`}</title>
                </polygon>
              );
            }),
          );
          return (
            <g
              key={f.view}
              className="bc-cube-side"
              role="button"
              tabIndex={-1}
              aria-label={name}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onPick?.(f.n);
                }
              }}
            >
              <polygon className="bc-cube-face" points={pts(outline)} />
              <polygon className="bc-cube-frame" points={pts(inset(0.92))} />
              <text
                className={`bc-cube-label${f.label.length > 5 ? " bc-cube-label-long" : ""}`}
                transform={`matrix(${(u.x / k).toFixed(4)} ${(u.y / k).toFixed(4)} ${(v.x / k).toFixed(4)} ${(v.y / k).toFixed(4)} ${c.x.toFixed(2)} ${c.y.toFixed(2)})`}
                y="3.5"
                pointerEvents="none"
              >
                {f.label}
              </text>
              {cells}
            </g>
          );
        })}
        {hlFaces.map((h) => (
          <polygon key={h.k} className="bc-cube-light" points={h.points} aria-hidden="true" />
        ))}
        {front}
        {labels(true)}
      </svg>
      {onHome && <Button className="bc-cube-btn bc-cube-home" size="dense" icon="home" title="Go home" onClick={onHome} />}
      {menu?.length ? (
        <>
          <MenuButton
            label="View cube"
            align="end"
            entries={menu}
            trigger={(p) => <Button {...p} className="bc-cube-btn bc-cube-more" size="dense" icon="chevronDown" title="View cube options" />}
          />
          <ContextMenu at={context} onClose={() => setContext(null)} entries={menu} label="View cube" />
        </>
      ) : null}
    </div>
  );
}
