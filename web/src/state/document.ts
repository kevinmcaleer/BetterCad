/** The model document. Epic #2 keeps it small: a name and a flat list of placeholder parts. The kernel (#4) replaces it. */
export type PartKind = "box" | "cylinder" | "sphere";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Part {
  id: string;
  name: string;
  kind: PartKind;
  hidden: boolean;
  ghost?: boolean;
  highlight?: boolean;
  position: Vec3;
  size: Vec3;
}

export interface ModelDoc {
  format: "bettercad";
  version: 1;
  name: string;
  parts: Part[];
}

export const KIND_LABEL: Record<PartKind, string> = { box: "Box", cylinder: "Cylinder", sphere: "Sphere" };

export function newDoc(name = "Untitled model"): ModelDoc {
  return { format: "bettercad", version: 1, name, parts: [] };
}

let counter = 0;
export function newId(): string {
  counter += 1;
  return `p${Date.now().toString(36)}${counter.toString(36)}`;
}

/** The next free name for a kind: "Box 1", "Box 2"… */
export function nextName(doc: ModelDoc, kind: PartKind): string {
  const base = KIND_LABEL[kind];
  let n = 1;
  const names = new Set(doc.parts.map((p) => p.name));
  while (names.has(`${base} ${n}`)) n += 1;
  return `${base} ${n}`;
}

export function addPart(doc: ModelDoc, kind: PartKind, id = newId()): ModelDoc {
  const size = kind === "cylinder" ? { x: 20, y: 20, z: 30 } : { x: 20, y: 20, z: 20 };
  const offset = doc.parts.length * 25;
  const part: Part = { id, name: nextName(doc, kind), kind, hidden: false, position: { x: offset, y: 0, z: 0 }, size };
  return { ...doc, parts: [...doc.parts, part] };
}

export function updatePart(doc: ModelDoc, id: string, change: Partial<Omit<Part, "id">>): ModelDoc {
  return updateParts(doc, [id], () => change);
}

/** Applies a change to several parts at once (a multi-selection edit). */
export function updateParts(doc: ModelDoc, ids: string[], change: (p: Part) => Partial<Omit<Part, "id">>): ModelDoc {
  const set = new Set(ids);
  return { ...doc, parts: doc.parts.map((p) => (set.has(p.id) ? { ...p, ...change(p) } : p)) };
}

export function removeParts(doc: ModelDoc, ids: string[]): ModelDoc {
  const set = new Set(ids);
  return { ...doc, parts: doc.parts.filter((p) => !set.has(p.id)) };
}

export function removePart(doc: ModelDoc, id: string): ModelDoc {
  return removeParts(doc, [id]);
}

export function duplicatePart(doc: ModelDoc, id: string, newPartId = newId()): ModelDoc {
  const i = doc.parts.findIndex((p) => p.id === id);
  const src = doc.parts[i];
  if (!src) return doc;
  const copy: Part = { ...src, id: newPartId, name: `${src.name} copy`, position: { ...src.position, x: src.position.x + 10 } };
  const parts = [...doc.parts];
  parts.splice(i + 1, 0, copy);
  return { ...doc, parts };
}

/** Moves a part before another (or to the end when beforeId is null). */
export function reorderPart(doc: ModelDoc, id: string, beforeId: string | null): ModelDoc {
  const part = doc.parts.find((p) => p.id === id);
  if (!part || id === beforeId) return doc;
  const rest = doc.parts.filter((p) => p.id !== id);
  const at = beforeId === null ? rest.length : rest.findIndex((p) => p.id === beforeId);
  if (at < 0) return doc;
  rest.splice(at, 0, part);
  return { ...doc, parts: rest };
}

/** Parses a saved file, throwing a one-line message when it is not a BetterCad model. */
export function parseDoc(text: string): ModelDoc {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("That file is not a BetterCad model.");
  }
  const d = data as Partial<ModelDoc>;
  if (d?.format !== "bettercad" || !Array.isArray(d.parts) || typeof d.name !== "string") {
    throw new Error("That file is not a BetterCad model.");
  }
  return { format: "bettercad", version: 1, name: d.name, parts: d.parts };
}
