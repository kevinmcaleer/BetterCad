import { SketchIndex, type Id, type PatternRole, type Sketch, type SketchPattern } from "@bettercad/sketch";
import * as core from "@bettercad/sketch/pattern";
import { textAt } from "@bettercad/sketch";
import { ORIGIN, entityAt, pickAt } from "./snap";
import { resolveOrigin } from "./tools";
import type { PatternCtx } from "./sketchPattern";

/** The Pattern tool's actions, loaded with a sketch so the shell stays small. `useSketchPattern` holds the state. */

const KEY = (id: Id) => `sketch-pattern:${id}`;
export { KEY as patternKey };

/** The pattern a picked shape is in: one it copies, or one that made it. */
export function patternFor(s: Sketch, ids: Id[]): SketchPattern | undefined {
  for (const id of ids) {
    const e = s.entities.find((x) => x.id === id) ?? s.texts?.find((x) => x.id === id);
    const p = e?.copy ? s.patterns?.find((q) => q.id === e.copy!.pattern) : s.patterns?.find((q) => q.of.includes(id));
    if (p) return p;
  }
  return undefined;
}

export { skipDeleted } from "@bettercad/sketch/pattern";

/** What a click picks for the tool: a point, a circle or the origin for the centre; a curve or a text otherwise. */
export function patternUnder(what: string, s: Sketch, xy: [number, number], tol: number, origin: [number, number] | null): Id | null {
  if (what === "centre") return pickAt(xy, s, tol, origin) ?? entityAt(xy, s, tol);
  return entityAt(xy, s, tol) ?? (what === "shapes" ? (textAt(s, xy, tol)?.id ?? null) : null);
}

export function patternOps({ deps, live, setId, setIsNew, setPick }: PatternCtx) {
  const store = (next: Sketch, label: string): boolean => {
    const pid = live.current.id;
    return deps.current.apply(next, label, pid ? { key: KEY(pid) } : {});
  };
  const label = () => (live.current.isNew ? "Pattern" : "Edit the pattern");

  const edit = (pid: Id) => {
    const s = deps.current.current();
    const p = s?.patterns?.find((x) => x.id === pid);
    if (!p) return;
    deps.current.store.seal();
    setId(pid);
    setIsNew(false);
    setPick("shapes");
    live.current = { id: pid, isNew: false, pick: "shapes" };
    deps.current.setSel(p.of);
  };

  /** Starts a pattern of the shapes, or opens the one they belong to. */
  const start = (of: Id[]): boolean => {
    const s = deps.current.current();
    if (!s || !core) return false;
    const had = of.map((x) => core.patternOf(s, x)).find((p) => !!p);
    if (had && of.every((x) => core.patternOf(s, x)?.id === had.id)) {
      edit(had.id);
      return true;
    }
    const r = core.addSketchPattern(s, "rect", of);
    if (typeof r === "string") {
      deps.current.say(r, true);
      return false;
    }
    setId(r.id);
    setIsNew(true);
    setPick("shapes");
    live.current = { id: r.id, isNew: true, pick: "shapes" };
    if (!store(r.sketch, "Pattern")) {
      setId(null);
      return false;
    }
    deps.current.setSel(r.sketch.patterns!.at(-1)!.of);
    return true;
  };

  const now = (): { s: Sketch; p: SketchPattern } | null => {
    const s = deps.current.current();
    const p = s?.patterns?.find((x) => x.id === live.current.id);
    return s && p ? { s, p } : null;
  };

  /** Changes the pattern's picks or settings. */
  const change = (c: Partial<Omit<SketchPattern, "id" | "kind">>) => {
    const n = now();
    if (!n || !core) return;
    store(core.updateSketchPattern(n.s, n.p.id, c), label());
  };

  const setKind = (kind: SketchPattern["kind"]) => {
    const n = now();
    if (!n || !core || n.p.kind === kind) return;
    let s = n.s;
    let opts: Partial<SketchPattern> = {};
    // A circle turns round the origin until another centre is picked.
    if (kind === "circle" && !(n.p.centre && s.entities.some((e) => e.id === n.p.centre))) {
      const r = resolveOrigin(s, [ORIGIN], deps.current.origin() ?? undefined);
      s = r.sketch;
      opts = { centre: r.picked[0] };
    }
    store(core.setPatternKind(s, n.p.id, kind, opts), label());
    setPick("shapes");
  };

  /** Sets a count, spacing or angle: a number, a sum or a parameter ("d1 * 2"). */
  const setValue = (role: PatternRole, v: number, expression?: string) => {
    const n = now();
    if (!n || !core) return;
    if (!(v > 0)) return deps.current.say("Type a number above 0", true);
    if (role === "angle" && v > 360) return deps.current.say("Type an angle up to 360°", true);
    store(core.setPatternValue(n.s, n.p.id, role, v, expression), label());
  };

  /** A click in the view while the tool is open: a shape to add or leave out, the centre, or a line to run along. */
  const click = (hit: Id | null, axis: { sketch: Sketch; id: Id } | null): boolean => {
    const s = deps.current.current();
    if (!s || !core) return false;
    const { id: pid, pick: what } = live.current;
    // A curve brings every curve joined to it end to end, so one click picks a whole closed shape.
    const shape = (h: Id) => {
      const c = s.entities.some((e) => e.id === h && e.kind !== "point") ? core.connectedCurves(s, h) : [];
      return c.length ? c : [h];
    };
    if (!pid) {
      if (!hit || hit === ORIGIN) return false;
      return start(shape(hit));
    }
    const n = now();
    if (!n) return false;
    if (what === "centre") {
      if (!hit) return false;
      let base = s;
      let c: Id | undefined = hit;
      if (hit === ORIGIN) {
        const r = resolveOrigin(s, [ORIGIN], deps.current.origin() ?? undefined);
        base = r.sketch;
        c = r.picked[0];
      } else {
        const e = new SketchIndex(s).get(hit);
        c = e?.kind === "point" ? e.id : e && "c" in e ? e.c : undefined;
      }
      if (!c) {
        deps.current.say("Click a point, a circle or the origin to turn round", true);
        return true;
      }
      store(core.updateSketchPattern(base, pid, { centre: c }), label());
      setPick("shapes");
      return true;
    }
    if (what === "dir") {
      const e = hit ? s.entities.find((x) => x.id === hit) : undefined;
      if (e?.kind === "line") store(core.updateSketchPattern(s, pid, { dir: e.id, alongY: undefined }), label());
      else if (axis) store(core.updateSketchPattern(axis.sketch, pid, { dir: axis.id, alongY: undefined }), label());
      else {
        deps.current.say("Click a line or an axis for the rows to run along", true);
        return true;
      }
      setPick("shapes");
      return true;
    }
    if (!hit || hit === ORIGIN) return false;
    if (core.patternable(s, [hit], pid).length === 0) return true;
    const picked = core.patternable(s, shape(hit), pid);
    const of = n.p.of.includes(hit) ? n.p.of.filter((x) => !picked.includes(x)) : [...n.p.of, ...picked.filter((x) => !n.p.of.includes(x))];
    if (!of.length) {
      deps.current.say("A pattern needs at least one shape. Cancel takes it away.", true);
      return true;
    }
    store(core.updateSketchPattern(s, pid, { of }), label());
    deps.current.setSel(of);
    return true;
  };

  const end = () => {
    setId(null);
    setIsNew(false);
    setPick("shapes");
    live.current = { id: null, isNew: false, pick: "shapes" };
  };

  const done = () => {
    const n = now();
    deps.current.store.seal();
    if (n && core) deps.current.say(`${live.current.isNew ? "Patterned" : "Changed the pattern"}: ${core.describePattern(n.s, n.p)}`);
    end();
    deps.current.setSel([]);
    deps.current.close();
  };

  const cancel = () => {
    const pid = live.current.id;
    if (pid) deps.current.store.discard(KEY(pid));
    end();
    deps.current.setSel([]);
    deps.current.close();
  };

  /** Takes the pattern away, keeping the originals. */
  const remove = () => {
    const n = now();
    if (!n || !core) return;
    deps.current.store.seal();
    deps.current.apply(core.removeSketchPattern(n.s, n.p.id), "Remove the pattern");
    end();
    deps.current.setSel([]);
    deps.current.close();
  };

  return { start, edit, change, setKind, setValue, click, done, cancel, remove };
}

export type PatternOps = ReturnType<typeof patternOps>;
