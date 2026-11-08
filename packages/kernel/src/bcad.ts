/**
 * The .bcad file (#79): the model document with a header and a thumbnail. Plain, pretty JSON with a stable key
 * order, so a model reads well in a diff. Nothing derived goes in: no geometry, no meshes.
 */
import schemaJson from "./bcad.schema.json";
import { MIGRATIONS } from "./migrations";
import { upgradeDoc, type FeatureType, type ModelDoc } from "./document";

export const BCAD_SCHEMA = 1;
export const BCAD_MIME = "application/vnd.bettercad+json";
export const BCAD_EXT = ".bcad";
export const APP_VERSION = "0.1.0";
export const NEWER_WARNING = "This file uses a newer BetterCad; some features may not work";

export interface BcadMeta {
  schema: number;
  app: "bettercad";
  version: string;
  /** Stable across saves, so autosave and recent files know it is the same model. */
  id?: string;
  created: string;
  modified: string;
  name: string;
  thumbnail?: string;
}

export interface BcadFile {
  doc: ModelDoc;
  meta: BcadMeta;
  /** Set when the file came from a newer BetterCad: what it has is kept, but some of it may not build. */
  warning?: string;
}

export class BcadError extends Error {
  override name = "BcadError";
}

export interface SaveOptions {
  thumbnail?: string;
  id?: string;
  /** When the file was first saved; now if new. */
  created?: string;
  now?: Date;
}

const KNOWN: ReadonlySet<FeatureType> = new Set<FeatureType>([
  "mount",
  "insert",
  "import",
  "add",
  "duplicate",
  "pattern",
  "move",
  "resize",
  "delete",
  "sketch",
  "extrude",
  "revolve",
  "combine",
  "fillet",
  "chamfer",
  "shell",
  "pushpull",
  "hole",
]);

/** True for a feature type this version can build. */
export const knownFeature = (type: string) => KNOWN.has(type as FeatureType);

/** Writes the model as .bcad text: header first, then the document with sorted keys, the thumbnail last. */
export function saveBcad(doc: ModelDoc, opts: SaveOptions = {}): string {
  const now = (opts.now ?? new Date()).toISOString();
  const file: Record<string, unknown> = {
    schema: BCAD_SCHEMA,
    app: "bettercad",
    version: APP_VERSION,
    ...(opts.id ? { id: opts.id } : {}),
    created: opts.created ?? now,
    modified: now,
    name: doc.name,
    document: sortKeys(doc),
    ...(opts.thumbnail ? { thumbnail: opts.thumbnail } : {}),
  };
  return JSON.stringify(file, null, 2) + "\n";
}

/** Reads .bcad text (or an older bare document), migrating it forward. Problems come back as a one-line BcadError. */
export function loadBcad(text: string): BcadFile | BcadError {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return new BcadError("That file is not a BetterCad model: it is not valid JSON.");
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return new BcadError("That file is not a BetterCad model.");
  let file = data as Record<string, unknown>;
  // A bare document is schema 0.
  let schema = file.app === "bettercad" && typeof file.schema === "number" ? file.schema : file.format === "bettercad" ? 0 : -1;
  if (schema < 0) return new BcadError("That file is not a BetterCad model.");
  if (schema === 0 && !Array.isArray(file.features) && !Array.isArray(file.parts)) return new BcadError("That file is not a BetterCad model.");
  const newer = schema > BCAD_SCHEMA;
  while (schema < BCAD_SCHEMA) {
    const step = MIGRATIONS[schema];
    if (!step) return new BcadError(`This BetterCad can't read schema ${schema} files.`);
    file = step(file);
    schema = file.schema as number;
  }
  if (file.document && typeof file.document === "object") {
    const doc = file.document as Record<string, unknown>;
    if (doc.version === 1 && Array.isArray(doc.parts)) file = { ...file, document: upgradeDoc(doc) };
  }
  const problem = validate(schemaJson as Schema, file, "");
  if (problem) return new BcadError(`That file is damaged: ${problem}.`);
  const doc = upgradeDoc(file.document as Record<string, unknown>);
  const meta: BcadMeta = {
    schema: file.schema as number,
    app: "bettercad",
    version: String(file.version),
    ...(typeof file.id === "string" ? { id: file.id } : {}),
    created: String(file.created),
    modified: String(file.modified),
    name: String(file.name),
    ...(typeof file.thumbnail === "string" ? { thumbnail: file.thumbnail } : {}),
  };
  const unknown = doc.features.some((f) => !knownFeature(f.type));
  return { doc, meta, ...(newer || unknown ? { warning: NEWER_WARNING } : {}) };
}

/** A file name for the model: its name, safe on every system, with the extension. */
export function fileName(name: string, ext = BCAD_EXT): string {
  // eslint-disable-next-line no-control-regex
  const base = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "").trim() || "model";
  return `${base}${ext}`;
}

/** The model name a file name stands for: the name without its extension. */
export function nameFromFile(file: string): string {
  return file.replace(/\.bettercad\.json$|\.bcad$|\.json$/i, "") || "Untitled model";
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) {
      const x = (v as Record<string, unknown>)[k];
      if (x !== undefined) out[k] = sortKeys(x);
    }
    return out;
  }
  return v;
}

// ---- a small JSON Schema validator: the subset bcad.schema.json uses

export interface Schema {
  type?: "object" | "array" | "string" | "integer" | "number" | "boolean";
  required?: string[];
  properties?: Record<string, Schema>;
  items?: Schema;
  const?: unknown;
  enum?: unknown[];
  minimum?: number;
  pattern?: string;
}

const typeOk: Record<NonNullable<Schema["type"]>, (v: unknown) => boolean> = {
  object: (v) => !!v && typeof v === "object" && !Array.isArray(v),
  array: Array.isArray,
  string: (v) => typeof v === "string",
  integer: (v) => Number.isInteger(v),
  number: (v) => typeof v === "number" && Number.isFinite(v),
  boolean: (v) => typeof v === "boolean",
};

/** The first way `v` breaks the schema, as a short phrase, or null. */
export function validate(s: Schema, v: unknown, at: string): string | null {
  const where = at || "the file";
  if (s.const !== undefined && v !== s.const) return `${where} should be ${JSON.stringify(s.const)}`;
  if (s.enum && !s.enum.includes(v)) return `${where} should be one of ${s.enum.join(", ")}`;
  if (s.type && !typeOk[s.type](v)) return `${where} should be ${s.type === "integer" || s.type === "array" || s.type === "object" ? "an" : "a"} ${s.type}`;
  if (s.minimum !== undefined && typeof v === "number" && v < s.minimum) return `${where} should be at least ${s.minimum}`;
  if (s.pattern && typeof v === "string" && !new RegExp(s.pattern).test(v)) return `${where} is not in the right form`;
  if (s.type === "object") {
    const o = v as Record<string, unknown>;
    for (const k of s.required ?? []) if (!(k in o)) return `${at ? `${at}.` : ""}${k} is missing`;
    for (const [k, sub] of Object.entries(s.properties ?? {})) {
      if (k in o) {
        const p = validate(sub, o[k], at ? `${at}.${k}` : k);
        if (p) return p;
      }
    }
  }
  if (s.type === "array" && s.items) {
    const a = v as unknown[];
    for (let i = 0; i < a.length; i++) {
      const p = validate(s.items, a[i], `${at}[${i}]`);
      if (p) return p;
    }
  }
  return null;
}
