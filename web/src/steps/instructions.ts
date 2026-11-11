/**
 * Build steps (#steps export): the timeline as numbered instructions, one per step, with the values each step was made
 * with. Pure, so it is tested without a browser; the pictures come from `picture.ts`.
 */
import type { Dimension, DimensionKind, Sketch } from "@bettercad/sketch";
import { bindExprs, evaluateParams, featureSummary, sketchSummary, type Feature, type ModelDoc } from "../state/document";

export interface BuildStep {
  /** 1-based, as the instructions number it. */
  n: number;
  /** Where it is on the timeline: build up to `at` to see the model after it. */
  at: number;
  feature: Feature;
  title: string;
  /** The sentence that says what to do. */
  text: string;
  /** Sizes and expressions, one per line. */
  details: string[];
}

const VERB: Record<Feature["type"], string> = {
  add: "Add a shape",
  duplicate: "Duplicate",
  pattern: "Pattern",
  move: "Move",
  resize: "Resize",
  delete: "Delete",
  sketch: "Sketch",
  extrude: "Extrude",
  combine: "Combine",
  fillet: "Fillet",
  chamfer: "Chamfer",
  shell: "Shell",
  pushpull: "Push or pull a face",
  revolve: "Revolve",
  hole: "Add holes",
  import: "Import",
  convert: "Make a mesh editable",
  insert: "Insert a part",
  mount: "Add a mount",
  gear: "Add a gear",
  link: "Make a component",
  joint: "Add a joint",
  drive: "Link two joints",
  construct: "Construct",
};

const DIMENSION: Record<DimensionKind, string> = {
  length: "Length",
  distance: "Distance",
  distanceX: "Horizontal distance",
  distanceY: "Vertical distance",
  radius: "Radius",
  diameter: "Diameter",
  angle: "Angle",
};

const round = (v: number) => Math.round(v * 100) / 100;
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const sentence = (s: string) => (/[.?]$/.test(s) ? s : `${s}.`);
const plain = (expr: string) => /^\s*-?\d+(\.\d+)?\s*$/.test(expr);

/** "Length 40 mm (`width`)", "Angle 30°". */
export function dimensionText(d: Dimension): string {
  const v = `${round(d.value)}${d.kind === "angle" ? "°" : " mm"}`;
  const expr = d.expression && !plain(d.expression) ? ` (\`${d.expression}\`)` : "";
  return `${DIMENSION[d.kind]} ${v}${expr}${d.driving ? "" : ", for reference"}`;
}

/** What to draw in a sketch, in words: its plane, its curves, its words and its sizes. */
function sketchStep(s: Sketch): { text: string; details: string[] } {
  const summary = sketchSummary(s);
  const cut = summary.indexOf(", ");
  const where = lower(cut < 0 ? summary : summary.slice(0, cut));
  const what = cut < 0 ? "empty" : summary.slice(cut + 2);
  const texts = (s.texts ?? []).filter((t) => !t.construction);
  const parts = [what === "empty" ? "" : `draw ${what}`, ...texts.map((t) => `write “${t.text.replace(/\n/g, " ")}” ${round(t.height)} mm tall`)].filter(
    Boolean,
  );
  const constraints = s.constraints.length;
  const text = `Start a sketch ${where}${parts.length ? ` and ${parts.join(", then ")}` : ""}.${
    constraints ? ` Hold it with ${constraints === 1 ? "1 constraint" : `${constraints} constraints`}.` : ""
  }`;
  const details = s.dimensions.filter((d) => !d.suppressed).map(dimensionText);
  return { text, details };
}

/** "size.x" as "Size X", "distance2" as "Distance2". */
const fieldName = (path: string) =>
  path
    .split(".")
    .map((w, i) => (w.length === 1 ? w.toUpperCase() : i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");

/** The expressions typed into a step's fields: "Size X: `leg`". */
function exprDetails(f: Feature): string[] {
  return Object.entries(f.exprs ?? {})
    .filter(([, e]) => e && !plain(e))
    .map(([field, e]) => `${fieldName(field)}: \`${e}\``);
}

/** The timeline's steps up to `upTo`, skipping suppressed ones, as instructions. */
export function buildSteps(doc: ModelDoc, upTo = doc.features.length): BuildStep[] {
  const out: BuildStep[] = [];
  const nameOf = (id: string) => doc.features.find((g) => g.id === id)?.name ?? "a gone sketch";
  // The values as built: a field typed as an expression keeps its last number until the build works it out.
  const { values } = evaluateParams(doc.params);
  doc.features.slice(0, upTo).forEach((raw, i) => {
    if (raw.suppressed) return;
    const f = bindExprs(raw, values).feature;
    let text: string;
    let details: string[] = [];
    if (f.type === "sketch") {
      ({ text, details } = sketchStep(f.sketch));
    } else {
      const from = f.type === "extrude" || f.type === "revolve" ? ` **${nameOf(f.sketch)}**` : "";
      text = sentence(`${VERB[f.type]}${from}: ${featureSummary(doc, f)}`);
    }
    out.push({ n: out.length + 1, at: i + 1, feature: f, title: f.name, text, details: [...details, ...exprDetails(f)] });
  });
  return out;
}

/** "step-01.png", or "step-01-sketch.png" for a sketch's diagram: zero-padded so the files sort in order. */
export function imageName(n: number, total: number, suffix = ""): string {
  return `step-${String(n).padStart(Math.max(2, String(total).length), "0")}${suffix}.png`;
}

export interface MarkdownOptions {
  /** The model file packed beside the instructions, if there is one. */
  modelFile?: string;
  /** Steps that failed to build, with the reason, by feature id. */
  failed?: Map<string, string>;
  /** Image paths by step number; a step without one has no picture. */
  images?: Map<number, string>;
  /** Sketch steps' face-on diagrams, by step number. */
  diagrams?: Map<number, string>;
  /** The finished model's picture. */
  finished?: string;
}

const escapeMd = (s: string) => s.replace(/([\\`*_[\]#<>|])/g, "\\$1");

/** The instructions as Markdown: a title, the parameters, then one numbered section per step with its picture. */
export function stepsMarkdown(doc: ModelDoc, steps: BuildStep[], o: MarkdownOptions = {}): string {
  const name = doc.name || "Untitled model";
  const lines: string[] = [
    "---",
    `title: ${JSON.stringify(name)}`,
    `steps: ${steps.length}`,
    "generator: BetterCad",
    "---",
    "",
    `# How to build ${escapeMd(name)}`,
    "",
    `${steps.length === 1 ? "1 step" : `${steps.length} steps`} in BetterCad. Sizes are in millimetres.${
      o.modelFile ? ` Open [${o.modelFile}](${encodeURI(o.modelFile)}) in BetterCad to change it.` : ""
    }`,
    "",
  ];
  if (o.finished) lines.push(`![${escapeMd(name)}, finished](${o.finished})`, "");
  const params = doc.params ?? [];
  const { values } = evaluateParams(params);
  const unit = (u: string) => (u === "deg" ? "°" : u === "mm" ? " mm" : "");
  if (params.length) {
    lines.push("## Parameters", "", "| Name | Value | Comment |", "| --- | --- | --- |");
    for (const p of params)
      lines.push(
        `| \`${p.name}\` | ${
          plain(p.expression)
            ? `${round(Number(p.expression))}${unit(p.unit)}`
            : `\`${p.expression}\`${p.name in values ? `, ${round(values[p.name]!)}${unit(p.unit)}` : ""}`
        } | ${escapeMd(p.comment ?? "")} |`,
      );
    lines.push("");
  }
  for (const s of steps) {
    lines.push(`## Step ${s.n}: ${escapeMd(s.title)}`, "");
    const img = o.images?.get(s.n);
    if (img) lines.push(`![Step ${s.n}: ${escapeMd(s.title)}](${img})`, "");
    const diagram = o.diagrams?.get(s.n);
    if (diagram) lines.push(`![Step ${s.n}: ${escapeMd(s.title)}, face on with its sizes](${diagram})`, "");
    lines.push(s.text, "");
    if (s.details.length) {
      for (const d of s.details) lines.push(`- ${d}`);
      lines.push("");
    }
    const bad = o.failed?.get(s.feature.id);
    if (bad) lines.push(`> This step didn't build: ${bad}`, "");
  }
  return lines.join("\n");
}
