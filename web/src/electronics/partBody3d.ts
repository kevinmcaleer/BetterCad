import { emptyDesign, footprintBox, placePart, pushToBoard, type PackageChoice, type SymbolDef } from "@bettercad/electronics";
import type { BodyMesh, ModelResult } from "@bettercad/kernel";
import { addBoard } from "@bettercad/kernel/board";
import { newDoc, type ModelDoc } from "@bettercad/kernel/document";
import { stepFiles } from "./partBlobs";

type P2 = [number, number];

/** The step the preview's board is, so its bodies can be told apart. */
const STEP = "fpreview";
/** Bare board shown round the footprint, mm. */
const MARGIN = 1.5;

/**
 * A part on a board of its own (#628): the model the 3D board would build for it, so the part editor shows the body
 * exactly as a board will. The part sits at the board's origin, unturned, so board and footprint share their numbers.
 * `file` gives a body file's bytes (base64) by hash.
 */
export function previewDoc(symbol: SymbolDef, pkg: PackageChoice, file: (hash: string) => string | undefined): ModelDoc | null {
  const def = { name: "Part", prefix: "U", symbol, packages: [pkg] };
  const made = pushToBoard(placePart(emptyDesign(), "sh1", def, { x: 0, y: 0 }).design).design;
  if (!made.board) return null;
  const b = previewBox(pkg);
  const design = {
    ...made,
    board: {
      ...made.board,
      outline: [
        { x: b.x1, y: b.y1 },
        { x: b.x2, y: b.y1 },
        { x: b.x2, y: b.y2 },
        { x: b.x1, y: b.y2 },
      ],
      placements: made.board.placements.map((p) => ({ ...p, x: 0, y: 0, rot: 0 as const })),
    },
  };
  const blobs = Object.fromEntries(stepFiles([def]).flatMap((h) => (file(h) ? [[h, file(h)!]] : [])));
  return addBoard({ ...newDoc("Part"), electronics: design, ...(Object.keys(blobs).length ? { blobs } : {}) }, {}, STEP);
}

/** The board the preview stands the part on: its footprint and a margin. */
export function previewBox(pkg: PackageChoice): { x1: number; y1: number; x2: number; y2: number } {
  const b = footprintBox(pkg.footprint);
  return { x1: b.x1 - MARGIN, y1: b.y1 - MARGIN, x2: b.x2 + MARGIN, y2: b.y2 + MARGIN };
}

/** The part's own bodies in a built preview: everything but the board. */
export const partMeshes = (r: ModelResult): BodyMesh[] => r.bodies.filter((b) => b.id.startsWith(`${STEP}/`) && b.id !== `${STEP}/board`).map((b) => b.mesh);

/**
 * Where a body's pins end (#628): the middle of each flat patch at its lowest point, seen from above. A chip's
 * terminals, a gull wing's feet and a through-hole part's pin ends are all such patches.
 */
export function pinEnds(meshes: Pick<BodyMesh, "positions" | "indices">[], tol = 0.05): P2[] {
  let low = Infinity;
  for (const m of meshes) for (let i = 2; i < m.positions.length; i += 3) low = Math.min(low, m.positions[i]!);
  if (!Number.isFinite(low)) return [];
  // Triangles lying at the bottom, joined where they share a corner.
  const group: number[] = [];
  const find = (i: number): number => {
    while (group[i] !== i) i = group[i] = group[group[i]!]!;
    return i;
  };
  const corner = new Map<string, number>();
  const tris: { c: P2; area: number; g: number }[] = [];
  for (const m of meshes) {
    const p = m.positions;
    for (let t = 0; t < m.indices.length; t += 3) {
      const [a, b, c] = [m.indices[t]! * 3, m.indices[t + 1]! * 3, m.indices[t + 2]! * 3];
      if (p[a + 2]! > low + tol || p[b + 2]! > low + tol || p[c + 2]! > low + tol) continue;
      const area = Math.abs((p[b]! - p[a]!) * (p[c + 1]! - p[a + 1]!) - (p[c]! - p[a]!) * (p[b + 1]! - p[a + 1]!)) / 2;
      if (area < 1e-9) continue;
      const g = group.length;
      group.push(g);
      for (const v of [a, b, c]) {
        const key = `${Math.round(p[v]! * 100)},${Math.round(p[v + 1]! * 100)}`;
        const seen = corner.get(key);
        if (seen === undefined) corner.set(key, g);
        else group[find(g)] = find(seen);
      }
      tris.push({ c: [(p[a]! + p[b]! + p[c]!) / 3, (p[a + 1]! + p[b + 1]! + p[c + 1]!) / 3], area, g });
    }
  }
  const sums = new Map<number, [number, number, number]>();
  for (const t of tris) {
    const s = sums.get(find(t.g)) ?? [0, 0, 0];
    sums.set(find(t.g), [s[0] + t.c[0] * t.area, s[1] + t.c[1] * t.area, s[2] + t.area]);
  }
  return [...sums.values()].filter((s) => s[2] > 1e-4).map((s): P2 => [s[0] / s[2], s[1] / s[2]]);
}

export interface PinSnap {
  /** How far to move the body, mm. */
  dx: number;
  dy: number;
  /** How many pin ends then sit on a pad. None: the pins did not line up, and the body is centred on the pads. */
  matched: number;
  ends: number;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000 || 0;

/**
 * The move that puts a body's pin ends on the pads: of every move that puts one pin end on one pad, the one that
 * lands the most of them. When fewer than two land (a body with one flat bottom, or pins at another pitch), it is
 * centred on the pads.
 */
export function snapPins(ends: P2[], pads: P2[], reach = 0.3): PinSnap | null {
  if (!ends.length || !pads.length) return null;
  const near = (p: P2): number => pads.reduce((best, q) => Math.min(best, Math.hypot(q[0] - p[0], q[1] - p[1])), Infinity);
  let best: { dx: number; dy: number; matched: number; off: number } | null = null;
  for (const e of ends.slice(0, 8))
    for (const pad of pads) {
      const [dx, dy] = [pad[0] - e[0], pad[1] - e[1]];
      let matched = 0;
      let off = 0;
      for (const o of ends) {
        const d = near([o[0] + dx, o[1] + dy]);
        if (d <= reach) {
          matched += 1;
          off += d;
        }
      }
      const better =
        !best ||
        matched > best.matched ||
        (matched === best.matched && (off < best.off - 1e-6 || (Math.abs(off - best.off) <= 1e-6 && Math.hypot(dx, dy) < Math.hypot(best.dx, best.dy) - 1e-6)));
      if (better) best = { dx, dy, matched, off };
    }
  if (best && (best.matched >= 2 || (ends.length === 1 && pads.length === 1)))
    return { dx: r3(best.dx), dy: r3(best.dy), matched: best.matched, ends: ends.length };
  const mid = (pts: P2[], i: 0 | 1) => (Math.min(...pts.map((p) => p[i])) + Math.max(...pts.map((p) => p[i]))) / 2;
  return { dx: r3(mid(pads, 0) - mid(ends, 0)), dy: r3(mid(pads, 1) - mid(ends, 1)), matched: 0, ends: ends.length };
}
