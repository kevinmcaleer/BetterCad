import { useEffect, useRef, useState } from "react";
import type { PackageChoice } from "@bettercad/electronics";
import { MASK_COLOURS } from "@bettercad/electronics/pcb/solid";
import type { BodyMesh } from "@bettercad/kernel";
import { readColours } from "./colours";
import { HOLE, PAD } from "./materials";
import { previewBox } from "./partBody3d";

type V3 = [number, number, number];
/** Looking from the front left, a little above. */
const START = { turn: -35, tilt: 35 };
const SHADES = 6;

export interface PartBody3DProps {
  pkg: PackageChoice;
  /** The part's bodies as the board builds them, on a board whose top is at `thickness`. None yet: the board alone. */
  meshes: BodyMesh[];
  thickness: number;
  busy?: boolean;
}

/**
 * The body on its footprint, in 3D (#628): the board's top with its pads, and the body see-through over them. Drag,
 * or use the arrow keys, to look round it. Drawn flat on a canvas: a part is small, and this needs no graphics card.
 */
export default function PartBody3D({ pkg, meshes, thickness, busy }: PartBody3DProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [look, setLook] = useState(START);
  const drag = useRef<{ x: number; y: number; turn: number; tilt: number } | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.clientWidth;
    const h = el.clientHeight;
    const ctx = w > 4 && h > 4 ? el.getContext("2d") : null;
    if (!ctx) return;
    const ratio = window.devicePixelRatio || 1;
    el.width = Math.round(w * ratio);
    el.height = Math.round(h * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const colours = readColours(el);

    const a = (look.turn * Math.PI) / 180;
    const e = (look.tilt * Math.PI) / 180;
    const [ca, sa, ce, se] = [Math.cos(a), Math.sin(a), Math.cos(e), Math.sin(e)];
    /** Across, up and away from the eye. */
    const see = (x: number, y: number, z: number): V3 => {
      const x1 = x * ca + y * sa;
      const y1 = -x * sa + y * ca;
      return [x1, z * ce + y1 * se, y1 * ce - z * se];
    };
    // Fit a ball round everything, so the picture does not jump as it turns.
    const box = previewBox(pkg);
    const min: V3 = [box.x1, box.y1, 0];
    const max: V3 = [box.x2, box.y2, thickness];
    for (const m of meshes)
      for (let i = 0; i < m.positions.length; i += 3)
        for (let k = 0; k < 3; k++) {
          min[k] = Math.min(min[k]!, m.positions[i + k]!);
          max[k] = Math.max(max[k]!, m.positions[i + k]!);
        }
    const mid: V3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
    const radius = Math.max(0.5, Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2);
    const scale = (Math.min(w, h) / 2 - 6) / radius;
    const at = (x: number, y: number, z: number): [number, number] => {
      const s = see(x - mid[0], y - mid[1], z - mid[2]);
      return [w / 2 + s[0] * scale, h / 2 - s[1] * scale];
    };
    const path = (pts: [number, number][]) => {
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.closePath();
    };
    const flat = (pts: [number, number][], z: number) => path(pts.map((p) => at(p[0], p[1], z)));
    const top = look.tilt >= 0 ? thickness : 0;

    // The board: its edge, then the face you can see.
    const corners: [number, number][] = [
      [box.x1, box.y1],
      [box.x2, box.y1],
      [box.x2, box.y2],
      [box.x1, box.y2],
    ];
    ctx.fillStyle = MASK_COLOURS.green;
    ctx.globalAlpha = 0.7;
    corners.forEach((c, i) => {
      const d = corners[(i + 1) % 4]!;
      path([at(c[0], c[1], 0), at(d[0], d[1], 0), at(d[0], d[1], thickness), at(c[0], c[1], thickness)]);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
    flat(corners, top);
    ctx.fill();

    // Pads, and the holes through them.
    const round = (cx: number, cy: number, rx: number, ry: number, turn: number): [number, number][] =>
      Array.from({ length: 20 }, (_, i): [number, number] => {
        const t = (i / 20) * Math.PI * 2;
        const [x, y] = [Math.cos(t) * rx, Math.sin(t) * ry];
        return [cx + x * Math.cos(turn) - y * Math.sin(turn), cy + x * Math.sin(turn) + y * Math.cos(turn)];
      });
    for (const pad of pkg.footprint.pads) {
      const turn = ((pad.angle ?? 0) * Math.PI) / 180;
      const [hw, hh] = [pad.w / 2, pad.h / 2];
      const shape =
        pad.shape === "rect" || pad.shape === "roundrect"
          ? [
              [-hw, -hh],
              [hw, -hh],
              [hw, hh],
              [-hw, hh],
            ].map(([x, y]): [number, number] => [pad.x + x! * Math.cos(turn) - y! * Math.sin(turn), pad.y + x! * Math.sin(turn) + y! * Math.cos(turn)])
          : round(pad.x, pad.y, hw, hh, turn);
      if (pad.kind !== "npth") {
        ctx.fillStyle = PAD;
        flat(shape, top);
        ctx.fill();
      }
      if (pad.drill) {
        ctx.fillStyle = HOLE;
        flat(round(pad.x, pad.y, (pad.slot ?? pad.drill) / 2, pad.drill / 2, turn), top);
        ctx.fill();
      }
    }

    // The body: the faces turned to you, see-through, in a few shades so its shape reads; then every edge.
    const shades: Path2D[] = Array.from({ length: SHADES }, () => new Path2D());
    for (const m of meshes) {
      const p = m.positions;
      const seen = new Float32Array(p.length);
      for (let i = 0; i < p.length; i += 3) {
        const s = see(p[i]! - mid[0], p[i + 1]! - mid[1], p[i + 2]! - mid[2]);
        seen[i] = w / 2 + s[0] * scale;
        seen[i + 1] = h / 2 - s[1] * scale;
        seen[i + 2] = s[2];
      }
      for (let t = 0; t < m.indices.length; t += 3) {
        const [i, j, k] = [m.indices[t]! * 3, m.indices[t + 1]! * 3, m.indices[t + 2]! * 3];
        // On screen y runs down, so a face turned to the eye winds clockwise.
        const cross = (seen[j]! - seen[i]!) * (seen[k + 1]! - seen[i + 1]!) - (seen[k]! - seen[i]!) * (seen[j + 1]! - seen[i + 1]!);
        if (cross >= 0) continue;
        // Lit from above and the left: by how much the face leans that way.
        const u: V3 = [p[j]! - p[i]!, p[j + 1]! - p[i + 1]!, p[j + 2]! - p[i + 2]!];
        const v: V3 = [p[k]! - p[i]!, p[k + 1]! - p[i + 1]!, p[k + 2]! - p[i + 2]!];
        const n: V3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        const len = Math.hypot(n[0], n[1], n[2]) || 1;
        const lit = Math.max(0, (n[2] * 0.8 + (n[0] * ca + n[1] * sa) * -0.35 + (-n[0] * sa + n[1] * ca) * -0.45) / len);
        const shade = shades[Math.min(SHADES - 1, Math.floor(lit * SHADES))]!;
        shade.moveTo(seen[i]!, seen[i + 1]!);
        shade.lineTo(seen[j]!, seen[j + 1]!);
        shade.lineTo(seen[k]!, seen[k + 1]!);
        shade.closePath();
      }
    }
    ctx.fillStyle = colours.ink;
    shades.forEach((s, i) => {
      ctx.globalAlpha = 0.5 - (i / (SHADES - 1)) * 0.34;
      ctx.fill(s);
    });
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = colours.ink;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const m of meshes) {
      const q = m.edgePositions;
      for (let i = 0; i + 5 < q.length; i += 6) {
        const from = at(q[i]!, q[i + 1]!, q[i + 2]!);
        const to = at(q[i + 3]!, q[i + 4]!, q[i + 5]!);
        ctx.moveTo(from[0], from[1]);
        ctx.lineTo(to[0], to[1]);
      }
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }, [pkg, meshes, thickness, look]);

  const turnBy = (turn: number, tilt: number) => setLook((now) => ({ turn: now.turn + turn, tilt: Math.max(-89, Math.min(89, now.tilt + tilt)) }));
  return (
    <figure className="bc-ec-body3d">
      <canvas
        ref={ref}
        role="img"
        tabIndex={0}
        aria-label={`The body on its footprint, in 3D${busy ? ", building" : ""}. Drag or use the arrow keys to turn it.`}
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, y: e.clientY, ...look };
          e.currentTarget.setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (d) setLook({ turn: d.turn + (e.clientX - d.x) * 0.6, tilt: Math.max(-89, Math.min(89, d.tilt + (e.clientY - d.y) * 0.6)) });
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        onKeyDown={(e) => {
          const step = { ArrowLeft: [-15, 0], ArrowRight: [15, 0], ArrowUp: [0, 15], ArrowDown: [0, -15] }[e.key];
          if (!step) return;
          e.preventDefault();
          turnBy(step[0]!, step[1]!);
        }}
      />
      <figcaption>{busy ? "Building the body…" : "Body on the board. Drag to turn it."}</figcaption>
    </figure>
  );
}
