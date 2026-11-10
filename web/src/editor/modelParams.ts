import { evaluate } from "@bettercad/ui";
import type { Solver } from "@bettercad/sketch";
import { namesIn, paramScope, setPath, type Feature, type ModelDoc, type ParamUnit } from "../state/document";

/**
 * Model parameters (Fusion's): the sizes each timeline step was made with, so the Parameters dialog can list and change
 * them beside the user parameters. A field's `path` is where its number lives on the step ("distance", "size.x");
 * a sketch dimension's path is "dim:" and its id.
 */
export interface ModelParam {
  path: string;
  /** What the size is: "Distance", "Width", "Radius 2". */
  label: string;
  /** What was typed, or the number when nothing was. */
  expression: string;
  value: number;
  unit: ParamUnit;
  /** Driven sketch dimensions only report. */
  readOnly?: boolean;
}

export interface FeatureParams {
  feature: Feature;
  params: ModelParam[];
}

type Field = [path: string, label: string, unit?: ParamUnit];

const AXES: [string, string][] = [
  ["x", "X"],
  ["y", "Y"],
  ["z", "Z"],
];
const SIZE: [string, string][] = [
  ["x", "Width"],
  ["y", "Depth"],
  ["z", "Height"],
];

const DIM_LABEL: Record<string, string> = {
  length: "Length",
  distance: "Distance",
  distanceX: "Across",
  distanceY: "Up",
  radius: "Radius",
  diameter: "Diameter",
  angle: "Angle",
};

function getPath(obj: unknown, path: string): unknown {
  let o = obj;
  for (const k of path.split(".")) {
    if (o === null || typeof o !== "object") return undefined;
    o = (o as Record<string, unknown>)[k];
  }
  return o;
}

/** The number fields a step has, by kind. Only the ones it holds a number in are listed. */
function fields(f: Feature): Field[] {
  switch (f.type) {
    case "add":
      return SIZE.map(([k, l]) => [`part.size.${k}`, l]);
    case "resize":
      return SIZE.map(([k, l]) => [`size.${k}`, l]);
    case "move":
      return [...AXES.map(([k, l]): Field => [`position.${k}`, `Move ${l}`]), ...AXES.map(([k, l]): Field => [`rotation.${k}`, `Turn ${l}`, "deg"])];
    case "extrude":
      return f.extent === "to" || f.extent === "all"
        ? []
        : [["distance", "Distance"], ...(f.direction === "two" ? [["distance2", "Second distance"] as Field] : [])];
    case "revolve":
      return [["angle", "Angle", "deg"]];
    case "fillet":
      return [["size", "Radius"]];
    case "chamfer":
    case "pushpull":
      return [["size", "Distance"]];
    case "shell":
      return [["size", "Wall"]];
    case "hole":
      return [...(f.size === "custom" ? [["diameter", "Diameter"] as Field] : []), ["depth", "Depth"]];
    case "pattern":
      if (f.kind === "mirror") return f.of && f.of !== "bodies" ? [] : [["offset", "Offset"]];
      if (f.kind === "circle")
        return [
          ["count", "Count", "none"],
          ["angle", "Angle", "deg"],
        ];
      return [
        ["count1", "Count", "none"],
        ["spacing1", "Spacing"],
        ["count2", "Second count", "none"],
        ["spacing2", "Second spacing"],
      ];
    case "construct":
      return f.kind === "offset"
        ? [["value", "Offset"]]
        : f.kind === "angle"
          ? [["value", "Angle", "deg"]]
          : f.kind === "pointAlong"
            ? [["value", "Along (%)", "none"]]
            : [];
    case "joint":
      return f.kind === "revolute" || f.kind === "prismatic"
        ? [
            ["lower", "Lower limit", f.kind === "revolute" ? "deg" : "mm"],
            ["upper", "Upper limit", f.kind === "revolute" ? "deg" : "mm"],
          ]
        : [];
    case "drive":
      return f.kind === "together" ? [] : [["ratio", "Ratio", "none"]];
    case "gear":
      return [
        ["gear.teeth", "Teeth", "none"],
        ["gear.module", "Module"],
        ["width", "Width"],
      ];
    case "mount":
      return f.kind === "standoffs"
        ? [
            ["height", "Height"],
            ["outer", "Outside diameter"],
          ]
        : [
            ["hub", "Hub diameter"],
            ["recess", "Recess depth"],
            ["arm", "Arm holes from centre"],
          ];
    default:
      return [];
  }
}

const fmt = (v: number) => String(Math.round(v * 1000) / 1000);

/** One step's model parameters. */
export function featureParams(f: Feature): ModelParam[] {
  if (f.type === "sketch") {
    const count: Record<string, number> = {};
    return f.sketch.dimensions
      .filter((d) => !d.suppressed)
      .map((d) => {
        const kind = DIM_LABEL[d.kind] ?? "Size";
        count[kind] = (count[kind] ?? 0) + 1;
        return {
          path: `dim:${d.id}`,
          label: `${kind} ${count[kind]}`,
          expression: d.driving ? d.expression || fmt(d.value) : fmt(d.value),
          value: d.value,
          unit: d.kind === "angle" ? "deg" : "mm",
          readOnly: !d.driving || undefined,
        };
      });
  }
  const out: ModelParam[] = [];
  for (const [path, label, unit = "mm"] of fields(f)) {
    const v = getPath(f, path);
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    out.push({ path, label, expression: f.exprs?.[path] ?? fmt(v), value: v, unit });
  }
  return out;
}

/** Every step that has sizes, in timeline order. */
export function modelParams(doc: ModelDoc): FeatureParams[] {
  const scope = paramScope(doc);
  // A field's stored number can lag its expression until the model builds: show what the expression comes to.
  const worked = (m: ModelParam): ModelParam => {
    if (!namesIn(m.expression).length) return m;
    try {
      return { ...m, value: evaluate(m.expression, scope) };
    } catch {
      return m;
    }
  };
  return doc.features.map((feature) => ({ feature, params: featureParams(feature).map(worked) })).filter((x) => x.params.length > 0);
}

/**
 * Why `expression` can't go into a step's size, or its value. Counts must be whole and at least 1; sizes above 0,
 * except moves, turns and joint limits, which can be anything.
 */
export function checkModelParam(f: Feature, path: string, expression: string, scope: Record<string, number>): { value: number } | { problem: string } {
  let v: number;
  try {
    v = evaluate(expression, scope);
  } catch (e) {
    return { problem: e instanceof Error ? e.message : `Can't read ${expression}` };
  }
  if (!Number.isFinite(v)) return { problem: `Can't read ${expression}` };
  const signed =
    path.startsWith("position.") || path.startsWith("rotation.") || path === "lower" || path === "upper" || f.type === "pushpull" || path === "offset";
  if (/count|teeth/.test(path)) {
    if (!Number.isInteger(v) || v < 1) return { problem: "Use a whole number, 1 or more" };
  } else if (!signed && !(v > 0)) return { problem: "Use a size above 0" };
  if (path.startsWith("dim:") && f.type === "sketch") {
    const d = f.sketch.dimensions.find((x) => `dim:${x.id}` === path);
    if (d?.kind === "angle" && v >= 180) return { problem: "Use an angle under 180°" };
  }
  return { value: v };
}

/**
 * Puts an expression into a step's size: the number goes in its field, and the expression is kept (#75) when it uses
 * a parameter. A sketch dimension takes both; the sketch needs solving again after.
 */
export function setModelParam(doc: ModelDoc, featureId: string, path: string, expression: string, value: number): ModelDoc {
  const named = namesIn(expression).length > 0;
  return {
    ...doc,
    features: doc.features.map((f) => {
      if (f.id !== featureId) return f;
      if (path.startsWith("dim:")) {
        if (f.type !== "sketch") return f;
        const dimensions = f.sketch.dimensions.map((d) => (`dim:${d.id}` === path ? { ...d, expression, value } : d));
        return { ...f, sketch: { ...f.sketch, dimensions } };
      }
      const g = setPath(f, path, value);
      const exprs = { ...f.exprs };
      if (named) exprs[path] = expression;
      else delete exprs[path];
      return { ...g, exprs: Object.keys(exprs).length ? exprs : undefined } as Feature;
    }),
  };
}

/**
 * A step's size changed from Model parameters: the model with it in, or why not. A sketch is solved again with
 * `solver`, so its geometry follows the dimension.
 */
export function editModelParam(doc: ModelDoc, featureId: string, path: string, expression: string, solver?: Solver): ModelDoc | string {
  const f = doc.features.find((x) => x.id === featureId);
  if (!f) return "That step is gone";
  const checked = checkModelParam(f, path, expression, paramScope(doc));
  if ("problem" in checked) return `${f.name}: ${checked.problem}`;
  const next = setModelParam(doc, featureId, path, expression, checked.value);
  if (f.type !== "sketch") return next;
  const g = next.features.find((x) => x.id === featureId);
  if (g?.type !== "sketch" || !solver) return next;
  const r = solver.solve(g.sketch);
  if (r.status !== "ok" && r.status !== "redundant") return `${f.name} can't take that size`;
  return { ...next, features: next.features.map((x) => (x.id === featureId ? { ...g, sketch: r.sketch } : x)) };
}
