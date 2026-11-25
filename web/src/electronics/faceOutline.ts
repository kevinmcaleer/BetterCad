import type { P2 } from "@bettercad/electronics";
import { shapeFromLoops, type OutlineShape } from "@bettercad/electronics/pcb/outline";
import type { BodyMesh } from "@bettercad/kernel";

type V3 = [number, number, number];
type FaceMesh = Pick<BodyMesh, "positions" | "indices" | "faceTris">;

/**
 * A flat face of a body as a board's shape (#638): its edge, and the holes through it as cut-outs, seen from outside
 * the body. Worked out from the face's triangles: a side that only one of them uses is on the face's outline. Null
 * for a face that is not flat. Curved edges are already short straight runs in the mesh.
 */
export function faceShape(mesh: FaceMesh, face: number): OutlineShape | null {
  const [t0, t1] = [mesh.faceTris[face], mesh.faceTris[face + 1]];
  if (t0 === undefined || t1 === undefined || t1 <= t0) return null;
  const at = (i: number): V3 => [mesh.positions[i * 3]!, mesh.positions[i * 3 + 1]!, mesh.positions[i * 3 + 2]!];
  const key = (p: V3) => `${Math.round(p[0] * 1e4)},${Math.round(p[1] * 1e4)},${Math.round(p[2] * 1e4)}`;
  let normal: V3 | null = null;
  const sides = new Map<string, { a: V3; b: V3; n: number }>();
  for (let t = t0; t < t1; t += 1) {
    const [a, b, c] = [at(mesh.indices[t * 3]!), at(mesh.indices[t * 3 + 1]!), at(mesh.indices[t * 3 + 2]!)];
    const [ux, uy, uz, vx, vy, vz] = [b[0] - a[0], b[1] - a[1], b[2] - a[2], c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n: V3 = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    const len = Math.hypot(...n);
    if (len < 1e-12) continue;
    const unit: V3 = [n[0] / len, n[1] / len, n[2] / len];
    normal ??= unit;
    // Every triangle of a flat face looks the same way.
    if (unit[0] * normal[0] + unit[1] * normal[1] + unit[2] * normal[2] < 0.9999) return null;
    for (const [p, q] of [
      [a, b],
      [b, c],
      [c, a],
    ] as const) {
      const [kp, kq] = [key(p), key(q)];
      const k = kp < kq ? `${kp}|${kq}` : `${kq}|${kp}`;
      const seen = sides.get(k);
      if (seen) seen.n += 1;
      else sides.set(k, { a: p, b: q, n: 1 });
    }
  }
  if (!normal) return null;
  // Across and up on the face, with the normal towards the eye. A level face keeps the model's X as across.
  const flat = Math.abs(normal[2]) > 0.999;
  const across: V3 = flat
    ? [1, 0, 0]
    : (() => {
        const l = Math.hypot(normal[0], normal[1]);
        return [-normal[1] / l, normal[0] / l, 0] as V3;
      })();
  const up: V3 = [normal[1] * across[2] - normal[2] * across[1], normal[2] * across[0] - normal[0] * across[2], normal[0] * across[1] - normal[1] * across[0]];
  const to2 = (p: V3): P2 => [p[0] * across[0] + p[1] * across[1] + p[2] * across[2], p[0] * up[0] + p[1] * up[1] + p[2] * up[2]];

  // The outline's sides, joined end to end into closed runs. Each side can be walked from either of its ends.
  interface Step {
    p: V3;
    to: string;
    side: { used: boolean };
  }
  const next = new Map<string, Step[]>();
  const from = (k: string): Step[] => next.get(k) ?? (next.set(k, []), next.get(k)!);
  for (const s of sides.values()) {
    if (s.n !== 1) continue;
    const side = { used: false };
    from(key(s.a)).push({ p: s.b, to: key(s.b), side });
    from(key(s.b)).push({ p: s.a, to: key(s.a), side });
  }
  const loops: P2[][] = [];
  for (const [start, firsts] of next)
    for (const first of firsts) {
      const loop: P2[] = [];
      let at2 = start;
      for (let step: Step | undefined = first; step && !step.side.used; step = at2 === start ? undefined : from(at2).find((x) => !x.side.used)) {
        step.side.used = true;
        loop.push(to2(step.p));
        at2 = step.to;
      }
      if (at2 === start && loop.length > 2) loops.push(loop);
    }
  return shapeFromLoops(loops);
}

/** What the model tells the board's setup: its bodies' meshes, what is picked in the 3D view, and the bodies' names. */
export interface ModelFaces {
  bodies: ReadonlyMap<string, { mesh: BodyMesh; names?: { faces: string[] } }>;
  picks: readonly { body: string; kind: string; index: number }[];
  names: readonly { id: string; name: string }[];
}

/**
 * The faces a board can take its shape from: the one it follows now (`followed`, as "body|face name") and any flat
 * face picked in the 3D view. A face is kept by its name, which the kernel holds steady as the model changes.
 */
export function boardFaces(model: ModelFaces | undefined, followed?: string): { id: string; name: string; shape: OutlineShape }[] {
  if (!model) return [];
  const out: { id: string; name: string; shape: OutlineShape }[] = [];
  const add = (body: string, face: number) => {
    const b = model.bodies.get(body);
    const shape = b && face >= 0 ? faceShape(b.mesh, face) : null;
    const id = `${body}|${b?.names?.faces[face] ?? face}`;
    if (shape && !out.some((x) => x.id === id)) out.push({ id, name: `a face of ${model.names.find((n) => n.id === body)?.name ?? "a body"}`, shape });
  };
  if (followed) {
    const cut = followed.lastIndexOf("|");
    const body = followed.slice(0, cut);
    const name = followed.slice(cut + 1);
    const named = model.bodies.get(body)?.names?.faces.indexOf(name) ?? -1;
    add(body, named >= 0 ? named : /^\d+$/.test(name) && !model.bodies.get(body)?.names ? Number(name) : -1);
  }
  for (const p of model.picks) if (p.kind === "face") add(p.body, p.index);
  return out;
}
