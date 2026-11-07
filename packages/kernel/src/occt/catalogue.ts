import type { TopoDS_Shape } from "replicad-opencascadejs";
import type { CataloguePart, CatalogueShape } from "../catalogue";
import type { OC } from "./oc";
import { boolean, box, cylinder, place } from "./shapes";

/** Turns that point a shape's height (+z) along x or y. */
const TURN = { x: { x: 0, y: 90, z: 0 }, y: { x: -90, y: 0, z: 0 }, z: undefined } as const;

function block(oc: OC, s: CatalogueShape): TopoDS_Shape {
  const size = { x: s.size[0], y: s.size[1], z: s.size[2] };
  const raw = s.kind === "box" ? box(oc, size) : cylinder(oc, size);
  return place(oc, raw, { position: { x: s.at[0], y: s.at[1], z: s.at[2] }, rotation: TURN[s.axis ?? "z"] });
}

/** A catalogue part's model (#186) as one solid, in the part's own coordinates. */
export function catalogueShape(oc: OC, part: CataloguePart): TopoDS_Shape {
  let out: TopoDS_Shape | null = null;
  for (const s of part.model) {
    const b = block(oc, s);
    if (!out) out = b;
    else out = boolean(oc, s.cut ? "cut" : "join", out, [b]);
  }
  if (!out) throw new Error(`${part.name} has no model.`);
  return out;
}
