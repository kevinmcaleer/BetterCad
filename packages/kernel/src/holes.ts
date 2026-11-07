import type { Frame, Vec2 } from "@bettercad/sketch";
import { holeDiameter, screw, type HoleFit } from "./screws";

/**
 * Hole's geometry (#70), without OCCT: where the holes sit on a face and what shape each one is. The document stores
 * the screw size and fit, and resolves them into a HoleSpec each time the timeline is built.
 */
export type HoleHead = "none" | "countersink" | "counterbore";

export interface HoleParams {
  /** A size from the screw table, or "custom" with `diameter`. */
  size: string;
  fit: HoleFit;
  diameter?: number;
  /** The printer's hole offset when the holes were made (#104): what a printed clearance adds. 0.4 mm if not set. */
  offset?: number;
  head: HoleHead;
  /** mm into the face, or null for Through all. */
  depth: number | null;
}

export interface HoleSpec {
  /** The face's plane: origin on the face, normal pointing out of the body. */
  frame: Frame;
  points: Vec2[];
  diameter: number;
  /** mm below the face, or null to go right through. */
  depth: number | null;
  head?: { kind: "countersink" | "counterbore"; diameter: number; depth: number; angle?: number };
}

/** The diameter and head a hole's settings come to, or an error to show. */
export function resolveHole(p: HoleParams): { diameter: number; head?: HoleSpec["head"] } | { error: string } {
  if (p.size === "custom") {
    if (!(p.diameter && p.diameter > 0)) return { error: "Give the hole a diameter above 0 mm" };
    return { diameter: p.diameter };
  }
  const s = screw(p.size);
  if (!s) return { error: "That screw size is not in the table" };
  const diameter = holeDiameter(s, p.fit, p.offset);
  if (diameter === null) return { error: `There's no heat-set insert for ${s.label} in the table` };
  if (p.head === "counterbore") {
    // Printed clearance round the head too, and deep enough to sit the head flush.
    return { diameter, head: { kind: "counterbore", diameter: s.socketHead.diameter + 0.4, depth: s.socketHead.height + 0.2 } };
  }
  if (p.head === "countersink") {
    const h = s.countersunkHead;
    const depth = (h.diameter - diameter) / 2 / Math.tan(((h.angle / 2) * Math.PI) / 180);
    return { diameter, head: { kind: "countersink", diameter: h.diameter, depth, angle: h.angle } };
  }
  return { diameter };
}

/**
 * The half-section of one hole as (radius, depth below the face) points, closed back along the axis. It starts a
 * little above the face so the cut never leaves a skin.
 */
export function holeSection(spec: Pick<HoleSpec, "diameter" | "head">, depth: number, lift = 0.05): [number, number][] {
  const r = spec.diameter / 2;
  const top: [number, number][] = [[0, -lift]];
  const h = spec.head;
  if (h?.kind === "counterbore") top.push([h.diameter / 2, -lift], [h.diameter / 2, h.depth], [r, h.depth]);
  else if (h?.kind === "countersink") {
    const R = h.diameter / 2;
    top.push([R + lift * ((R - r) / h.depth), -lift], [r, h.depth]);
  } else top.push([r, -lift]);
  return [...top, [r, depth], [0, depth]];
}

/** A friendly summary of a hole's size, e.g. "M3, clearance for printing, 3.4 mm". */
export function holeLabel(p: HoleParams, diameter?: number): string {
  const d = diameter ?? (resolveHole(p) as { diameter?: number }).diameter;
  const name = p.size === "custom" ? "Custom" : (screw(p.size)?.label ?? p.size);
  return `${name}${d ? `, ${Math.round(d * 100) / 100} mm` : ""}`;
}
