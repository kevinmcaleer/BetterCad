import { NAME_RE, renameIn } from "./params";
import { namedDimensions, type Feature, type ModelDoc } from "./document";

/* Renaming sketch sizes (d1 to wheel) from the Parameters dialog, apart from the document code so it loads with it. */

/** Why a sketch size can't be called `name`, or null. */
export function dimensionNameProblem(doc: ModelDoc, dimId: string, name: string): string | null {
  if (!NAME_RE.test(name)) return "Use letters, digits and _, starting with a letter";
  if (/^(mm|cm|m|in|deg)$/i.test(name)) return `${name} is a unit, so it can't be a name`;
  if ((doc.params ?? []).some((p) => p.name === name)) return `There is already a parameter called ${name}`;
  const other = namedDimensions(doc).get(name);
  if (other && other.dim.id !== dimId) return `There is already a size called ${name}`;
  return null;
}

/** Renames a sketch size, and every expression that used its old name. */
export function renameDimension(doc: ModelDoc, dimId: string, to: string): ModelDoc {
  let from: string | undefined;
  for (const f of doc.features) if (f.type === "sketch") from ??= f.sketch.dimensions.find((d) => d.id === dimId)?.name;
  if (!from || from === to) return doc;
  const old = from;
  return {
    ...doc,
    params: doc.params?.map((p) => ({ ...p, expression: renameIn(p.expression, old, to) })),
    features: doc.features.map((f) => {
      const exprs = f.exprs && Object.fromEntries(Object.entries(f.exprs).map(([k, e]) => [k, renameIn(e, old, to)]));
      const g = (f.exprs ? { ...f, exprs } : f) as Feature;
      if (g.type !== "sketch") return g;
      const dimensions = g.sketch.dimensions.map((d) => ({ ...d, name: d.id === dimId ? to : d.name, expression: renameIn(d.expression, old, to) }));
      return { ...g, sketch: { ...g.sketch, dimensions } };
    }),
  };
}
