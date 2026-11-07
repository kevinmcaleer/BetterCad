export type ViewName = "top" | "bottom" | "front" | "back" | "right" | "left";

type V3 = [number, number, number];

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
const SCALE = 25;
const C = SIZE / 2;

export interface ViewCubeProps {
  /** World → camera rotation, row-major 3×3 (rows: right, up, back). Defaults to the corner view. */
  rotation?: number[];
  onPick?: (view: ViewName) => void;
}

/**
 * The view cube in the viewport's top-right corner, as SVG. It turns with the camera; click a face to look from it.
 * The axes show X red, Y green and Z blue.
 */
export function ViewCube({ rotation = ISO, onPick }: ViewCubeProps) {
  const r = rotation;
  const proj = (p: V3) => ({
    x: C + SCALE * (r[0]! * p[0] + r[1]! * p[1] + r[2]! * p[2]),
    y: C - SCALE * (r[3]! * p[0] + r[4]! * p[1] + r[5]! * p[2]),
    depth: r[6]! * p[0] + r[7]! * p[1] + r[8]! * p[2],
  });
  const vec = (p: V3) => ({ x: SCALE * (r[0]! * p[0] + r[1]! * p[1] + r[2]! * p[2]), y: -SCALE * (r[3]! * p[0] + r[4]! * p[1] + r[5]! * p[2]) });
  const add = (a: V3, b: V3, s = 1): V3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];

  const faces = FACES.map((f) => ({ ...f, facing: proj(f.n).depth })).filter((f) => f.facing > 0.02);
  faces.sort((a, b) => a.facing - b.facing);

  const axisOrigin: V3 = [-1.25, -1.25, -1.25];
  const axes = [
    { name: "X", cls: "x", dir: [1, 0, 0] as V3 },
    { name: "Y", cls: "y", dir: [0, 1, 0] as V3 },
    { name: "Z", cls: "z", dir: [0, 0, 1] as V3 },
  ];
  const o = proj(axisOrigin);

  return (
    <svg className="bc-viewcube" viewBox={`0 0 ${SIZE} ${SIZE}`} role="group" aria-label="View cube">
      <defs>
        <linearGradient id="bc-cube-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--bc-color-cube-face)" />
          <stop offset="1" stopColor="var(--bc-color-cube-face-low)" />
        </linearGradient>
      </defs>
      {axes.map((a) => {
        const end = proj(add(axisOrigin, a.dir, 2.9));
        const tip = proj(add(axisOrigin, a.dir, 3.35));
        return (
          <g key={a.name} aria-hidden="true">
            <line className={`bc-axis-line bc-axis-line-${a.cls}`} x1={o.x} y1={o.y} x2={end.x} y2={end.y} />
            <text className={`bc-axis-${a.cls}`} x={tip.x} y={tip.y + 4} textAnchor="middle">
              {a.name}
            </text>
          </g>
        );
      })}
      {faces.map((f) => {
        const up = f.down.map((v) => -v) as V3;
        const left = f.right.map((v) => -v) as V3;
        const corners = [add(add(f.n, left), up), add(add(f.n, f.right), up), add(add(f.n, f.right), f.down), add(add(f.n, left), f.down)].map(proj);
        const c = proj(f.n);
        const u = vec(f.right);
        const v = vec(f.down);
        const k = SCALE;
        const name = `Look from the ${f.view}`;
        return (
          <g
            key={f.view}
            className="bc-cube-side"
            role="button"
            tabIndex={-1}
            aria-label={name}
            onClick={() => onPick?.(f.view)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onPick?.(f.view);
              }
            }}
          >
            <title>{name}</title>
            <polygon className="bc-cube-face" points={corners.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ")} />
            <text
              className="bc-cube-label"
              transform={`matrix(${(u.x / k).toFixed(4)} ${(u.y / k).toFixed(4)} ${(v.x / k).toFixed(4)} ${(v.y / k).toFixed(4)} ${c.x.toFixed(2)} ${c.y.toFixed(2)})`}
              y="3.5"
              pointerEvents="none"
            >
              {f.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
