import { useMemo, useRef, useState, type MutableRefObject } from "react";
import { ESC, useEscape } from "@bettercad/ui";
import type { Id, Sketch, SketchPattern, Vec2 } from "@bettercad/sketch";
import type { PatternOps } from "./sketchPatternActions";

/** The tool's actions and the pattern core, loaded with a sketch (or when the tool is picked), out of first paint. */
let mod: typeof import("./sketchPatternActions") | null = null;
export const loadPatternCore = () => import("./sketchPatternActions").then((m) => (mod = m));

/** The pattern a picked shape is in, once the tool's code has loaded. */
export const patternFor = (s: Sketch, ids: Id[]): SketchPattern | undefined => mod?.patternFor(s, ids);

/** A delete's copies leave their places in their patterns empty (see `skipDeleted`). */
export const skipDeleted = (before: Sketch, after: Sketch): Sketch => mod?.skipDeleted(before, after) ?? after;

/** What a pick in the view is for while the Pattern tool is open: the shapes, the centre to turn round, or a line. */
export type PatternPick = "shapes" | "centre" | "dir";

interface Deps {
  current: () => Sketch | null;
  apply: (next: Sketch, label: string, opts?: { key?: string; strict?: boolean; quiet?: boolean }) => boolean;
  store: { seal: () => void; discard: (key: string) => void };
  say: (text: string, error?: boolean) => void;
  setSel: (ids: Id[]) => void;
  origin: () => Vec2 | null;
  /** The tool goes down (OK and Cancel). */
  close: () => void;
}

export interface PatternCtx {
  deps: MutableRefObject<Deps>;
  live: MutableRefObject<{ id: Id | null; isNew: boolean; pick: PatternPick }>;
  setId: (id: Id | null) => void;
  setIsNew: (v: boolean) => void;
  setPick: (p: PatternPick) => void;
}

/**
 * The sketch's Pattern tool: copies of picked shapes in rows, or round a point, kept up to date as you change it. Every
 * change while it is open is one undo step; Cancel takes the whole run back.
 */
export function useSketchPattern(d: Deps, editing: boolean) {
  const deps = useRef(d);
  deps.current = d;
  const [id, setId] = useState<Id | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [pick, setPick] = useState<PatternPick>("shapes");
  const live = useRef({ id, isNew, pick });
  live.current = { id, isNew, pick };
  const ops = useRef<PatternOps | null>(null);
  const run = useMemo(() => {
    const get = () => (ops.current ??= mod?.patternOps({ deps, live, setId, setIsNew, setPick }) ?? null);
    const end = () => {
      setId(null);
      setIsNew(false);
      setPick("shapes");
      live.current = { id: null, isNew: false, pick: "shapes" };
    };
    return {
      under: (s: Sketch, xy: Vec2, tol: number, origin: Vec2 | null) => mod?.patternUnder(live.current.pick, s, xy, tol, origin) ?? null,
      start: (of: Id[]) => get()?.start(of) ?? false,
      edit: (pid: Id) => get()?.edit(pid),
      change: (c: Parameters<PatternOps["change"]>[0]) => get()?.change(c),
      setKind: (k: SketchPattern["kind"]) => get()?.setKind(k),
      setValue: (...a: Parameters<PatternOps["setValue"]>) => get()?.setValue(...a),
      click: (...a: Parameters<PatternOps["click"]>) => get()?.click(...a) ?? false,
      done: () => get()?.done(),
      cancel: () => (get() ? get()!.cancel() : end()),
      remove: () => get()?.remove(),
      end,
    };
  }, []);

  // Esc stops picking a centre or line first, then takes the pattern back.
  useEscape(editing && !!id && pick !== "shapes", () => setPick("shapes"), ESC.tool + 4);
  useEscape(editing && !!id, run.cancel, ESC.tool + 3);

  return { id, isNew, pick, setPick, ...run };
}

export type SketchPatternSession = ReturnType<typeof useSketchPattern>;
