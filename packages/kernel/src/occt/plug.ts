import type { TopoDS_Shape } from "replicad-opencascadejs";
import type { OC } from "./oc";
import { boolean, type Tracker } from "./shapes";
import type { Plug } from "../recognise/holes";

/**
 * Fills recognised holes in a mesh body (#448): each plug is a cylinder a hair wider than the hole it fills, joined
 * into the body, so the ring of flat strips that was the hole's wall is gone and a Hole step can cut a true one.
 */
export function plug(oc: OC, shape: TopoDS_Shape, plugs: Plug[], t?: Tracker): TopoDS_Shape {
  if (!plugs.length) return shape;
  const tools = plugs.map((p) => {
    const at = new oc.gp_Pnt(p.origin[0], p.origin[1], p.origin[2]);
    const dir = new oc.gp_Dir(p.axis[0], p.axis[1], p.axis[2]);
    const ax = new oc.gp_Ax2(at, dir);
    const mk = new oc.BRepPrimAPI_MakeCylinder(ax, p.radius, p.length);
    const s = mk.Shape();
    for (const x of [mk, ax, dir, at]) x.delete();
    return s;
  });
  return boolean(oc, "join", shape, tools, t);
}
