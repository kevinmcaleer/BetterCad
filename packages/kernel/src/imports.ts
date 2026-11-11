/** Files that can be brought into a model (#82), and how their bytes are kept in the document. */
export type ImportFormat = "stl" | "step" | "3mf";

export const IMPORT_EXTS: Record<string, ImportFormat> = { ".stl": "stl", ".step": "step", ".stp": "step", ".3mf": "3mf" };

/** The import format of a file name, or null for one that isn't imported (.bcad opens; others are refused). */
export function importFormat(name: string): ImportFormat | null {
  const m = /\.[^.]+$/.exec(name.toLowerCase());
  return (m && IMPORT_EXTS[m[0]]) ?? null;
}

export const isBcad = (name: string) => /\.(bcad|json)$/i.test(name);

/** The name a file's body takes: the file name without its extension. */
export const baseName = (name: string) => name.replace(/\.[^.]+$/, "") || "Imported";

/** An imported mesh's body name: an STL is named after its file; a 3MF's objects keep their own names. */
export function meshName(format: ImportFormat, name: string | undefined, base: string): string {
  return format === "stl" || !name ? base : name;
}

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** A short content hash (FNV-1a, 64-bit as two 32-bit halves): the same file always gets the same blob. */
export function blobHash(bytes: Uint8Array): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ bytes.length;
  for (let i = 0; i < bytes.length; i++) {
    h1 = Math.imul(h1 ^ bytes[i]!, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ bytes[i]!, 0x5bd1e995) >>> 0;
  }
  return `b${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
}
