import { useCallback, useEffect, useRef, useState } from "react";
import {
  MAX_TITLE_FIELDS,
  SHEET_SIZES,
  type DrawingStandard,
  type SheetSize,
  type TitleBlock,
  type TitleField,
  type TitleLogo,
} from "@bettercad/kernel/drawing";

/**
 * Drawing templates (#575): the page, the standard, the title block with its logo and your own fields, and whether
 * the first sheet starts with views, in one pick. Kept in this browser and, when you are signed in, in your account,
 * the way printer profiles are, so they work offline and follow you to the next machine.
 */
export interface DrawingTemplate {
  id: string;
  name: string;
  size: SheetSize;
  landscape: boolean;
  standard: DrawingStandard;
  border: boolean;
  /** The title block's fields that carry over. The title and the date are the new drawing's own. */
  title: TitleBlock;
  logo?: TitleLogo;
  fields?: TitleField[];
  /** "four": the first sheet starts with a front view, the views beside it and an isometric. */
  views: "none" | "four";
  /** The template New drawing starts from. One at most. */
  default?: boolean;
  modified?: string;
}

const KEY = "bettercad.drawingTemplates";
/** The most templates an account keeps, as the server counts them. */
export const MAX_TEMPLATES = 20;
/** The longest side of a logo, in pixels: sharp at a title block's size, small in the file. */
export const LOGO_PIXELS = 480;

const text = (v: unknown, most: number) => (typeof v === "string" ? v.slice(0, most) : "");
const CARRIED = ["author", "approved", "type", "status", "number", "revision"] as const;

/** The title block fields a template keeps: everything but the title and the date. */
export function carried(title: TitleBlock): TitleBlock {
  const out: TitleBlock = {};
  for (const k of CARRIED) {
    const v = title[k]?.trim();
    if (v) out[k] = v;
  }
  return out;
}

export function readLogoData(v: unknown): TitleLogo | undefined {
  const l = v as Partial<TitleLogo> | null;
  if (!l || typeof l.data !== "string" || !l.data.startsWith("data:image/jpeg;base64,")) return undefined;
  if (!(Number(l.w) > 0) || !(Number(l.h) > 0)) return undefined;
  return { data: l.data, w: Math.round(Number(l.w)), h: Math.round(Number(l.h)) };
}

export function readFields(v: unknown): TitleField[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((f) => ({ label: text((f as TitleField | null)?.label, 40), value: text((f as TitleField | null)?.value, 80) }))
    .filter((f) => f.label.trim() || f.value.trim())
    .slice(0, MAX_TITLE_FIELDS);
}

/** A template as it was stored, or nothing when it isn't one. Anything it doesn't say starts as a new drawing does. */
export function readTemplate(raw: unknown): DrawingTemplate | null {
  const t = raw as Partial<DrawingTemplate> | null;
  if (!t || typeof t.id !== "string" || !t.id || typeof t.name !== "string" || !t.name.trim()) return null;
  if (typeof t.size !== "string" || !(t.size in SHEET_SIZES)) return null;
  const out: DrawingTemplate = {
    id: t.id,
    name: t.name.trim().slice(0, 80),
    size: t.size,
    landscape: t.landscape !== false,
    standard: t.standard === "asme" || t.standard === "iso" ? t.standard : SHEET_SIZES[t.size].family === "us" ? "asme" : "iso",
    border: t.border !== false,
    title: carried((t.title ?? {}) as TitleBlock),
    views: t.views === "four" ? "four" : "none",
  };
  const logo = readLogoData(t.logo);
  if (logo) out.logo = logo;
  const fields = readFields(t.fields);
  if (fields.length) out.fields = fields;
  if (t.default === true) out.default = true;
  if (typeof t.modified === "string") out.modified = t.modified;
  return out;
}

const list = (raw: unknown): DrawingTemplate[] => (Array.isArray(raw) ? raw.map(readTemplate).filter((t): t is DrawingTemplate => !!t) : []);

export function loadLocal(): DrawingTemplate[] {
  try {
    return list(JSON.parse(localStorage.getItem(KEY) ?? "[]"));
  } catch {
    return [];
  }
}

export function saveLocal(templates: DrawingTemplate[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(templates));
  } catch {
    // Private windows and full storage: the templates still live for this session and in the account.
  }
}

/** The account's templates and this browser's, by id; the account's copy wins when both have one. One default at most. */
export function merge(local: DrawingTemplate[], remote: DrawingTemplate[]): DrawingTemplate[] {
  const byId = new Map(local.map((t) => [t.id, t]));
  for (const t of remote) byId.set(t.id, t);
  // The account's default wins over this browser's.
  const first = remote.find((t) => t.default)?.id ?? local.find((t) => t.default)?.id;
  return [...byId.values()].map((t) => withDefault(t, t.id === first));
}

function withDefault(t: DrawingTemplate, on: boolean): DrawingTemplate {
  if (!!t.default === on) return t;
  const next = { ...t };
  if (on) next.default = true;
  else delete next.default;
  return next;
}

export const newTemplateId = () => `dt_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;

/** The one New drawing starts from, when you have picked one. */
export const defaultTemplate = (templates: readonly DrawingTemplate[]) => templates.find((t) => t.default);

/** The part of the account's API a template needs: any call, signed as the rest are. */
export interface TemplateApi {
  call<T>(method: string, path: string, body?: unknown): Promise<T>;
}

const dataOf = ({ id: _id, name: _name, modified: _m, ...data }: DrawingTemplate) => data as Record<string, unknown>;
const put = (api: TemplateApi, t: DrawingTemplate) => api.call("PUT", `templates/${encodeURIComponent(t.id)}`, { name: t.name, data: dataOf(t) });

export interface Templates {
  templates: DrawingTemplate[];
  /**
   * Saves a template; one of the same name is replaced. Marking it the default takes the mark off the others.
   * False when there is no room for another.
   */
  save: (t: DrawingTemplate) => boolean;
  remove: (id: string) => void;
  /** Makes one template the default, or none with null. */
  setDefault: (id: string | null) => void;
}

export function useTemplates(api?: TemplateApi, signedIn = false): Templates {
  const [templates, setTemplates] = useState<DrawingTemplate[]>(loadLocal);
  const account = signedIn ? api : undefined;

  useEffect(() => {
    if (!account) return;
    let live = true;
    account
      .call<{ templates: unknown[] }>("GET", "templates")
      .then(async (r) => {
        const remote = list(r.templates);
        const local = loadLocal();
        // Templates made in this browser before signing in go up to the account.
        const ids = new Set(remote.map((t) => t.id));
        const merged = merge(local, remote);
        await Promise.all(merged.filter((t) => !ids.has(t.id)).map((t) => put(account, t).catch(() => null)));
        if (!live) return;
        saveLocal(merged);
        setTemplates(merged);
      })
      .catch(() => {
        // Offline or no server: the browser's copy stands.
      });
    return () => {
      live = false;
    };
  }, [account]);

  // What is listed now, for a change made before the next draw (and when storage refuses to keep it).
  const now = useRef(templates);
  now.current = templates;
  /** Keeps the new list here and sends the account each template that changed. */
  const commit = useCallback(
    (next: DrawingTemplate[]) => {
      const before = now.current;
      now.current = next;
      saveLocal(next);
      setTemplates(next);
      if (!account) return;
      for (const t of next) if (!before.includes(t)) put(account, t).catch(() => null);
      for (const t of before) if (!next.some((x) => x.id === t.id)) account.call("DELETE", `templates/${encodeURIComponent(t.id)}`).catch(() => null);
    },
    [account],
  );

  const save = useCallback(
    (t: DrawingTemplate) => {
      const all = now.current;
      const same = all.find((x) => x.id === t.id) ?? all.find((x) => x.name.toLowerCase() === t.name.toLowerCase());
      if (!same && all.length >= MAX_TEMPLATES) return false;
      const mine = { ...t, id: same?.id ?? t.id };
      commit([...all.filter((x) => x.id !== mine.id).map((x) => (mine.default ? withDefault(x, false) : x)), mine]);
      return true;
    },
    [commit],
  );
  const remove = useCallback((id: string) => commit(now.current.filter((x) => x.id !== id)), [commit]);
  const setDefault = useCallback((id: string | null) => commit(now.current.map((x) => withDefault(x, x.id === id))), [commit]);

  return { templates, save, remove, setDefault };
}

/** The size a picture is stored at: its longest side brought down to `most` pixels, never up. */
export function logoSize(w: number, h: number, most = LOGO_PIXELS): { w: number; h: number } {
  const k = Math.min(1, most / Math.max(w, h, 1));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

/**
 * A picture file as a title block's logo: drawn small on white, because a drawing prints on white paper, and kept
 * as a JPEG, which a PDF takes as it is. Throws when the file isn't a picture the browser can read.
 */
export async function readLogo(file: Blob): Promise<TitleLogo> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise<void>((ok, bad) => {
      img.onload = () => ok();
      img.onerror = () => bad(new Error("not a picture"));
      img.src = url;
    });
    const { w, h } = logoSize(img.naturalWidth || 300, img.naturalHeight || 150);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext("2d");
    if (!g) throw new Error("no canvas");
    g.fillStyle = "white";
    g.fillRect(0, 0, w, h);
    g.drawImage(img, 0, 0, w, h);
    return { data: canvas.toDataURL("image/jpeg", 0.85), w, h };
  } finally {
    URL.revokeObjectURL(url);
  }
}
