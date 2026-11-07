/** Undo and redo over immutable snapshots. Each step has a label so the status line can say what was undone. */
export interface History<T> {
  past: { state: T; label: string }[];
  present: T;
  /** The label of the step that produced `present`. */
  label: string;
  future: { state: T; label: string }[];
  /** Edits with the same key in a row (a scrub, typing a name) merge into one step. */
  coalesceKey?: string;
}

export const LIMIT = 200;

export function createHistory<T>(present: T): History<T> {
  return { past: [], present, label: "", future: [] };
}

export function push<T>(h: History<T>, next: T, label: string, coalesceKey?: string): History<T> {
  if (Object.is(next, h.present)) return h;
  if (coalesceKey && coalesceKey === h.coalesceKey) {
    return { ...h, present: next, label, future: [] };
  }
  const past = [...h.past, { state: h.present, label: h.label }].slice(-LIMIT);
  return { past, present: next, label, future: [], coalesceKey };
}

export function undo<T>(h: History<T>): History<T> {
  const prev = h.past[h.past.length - 1];
  if (!prev) return h;
  return {
    past: h.past.slice(0, -1),
    present: prev.state,
    label: prev.label,
    future: [{ state: h.present, label: h.label }, ...h.future],
  };
}

export function redo<T>(h: History<T>): History<T> {
  const next = h.future[0];
  if (!next) return h;
  return {
    past: [...h.past, { state: h.present, label: h.label }],
    present: next.state,
    label: next.label,
    future: h.future.slice(1),
  };
}

/** Ends coalescing, so the next edit starts a new step. */
export function seal<T>(h: History<T>): History<T> {
  return h.coalesceKey ? { ...h, coalesceKey: undefined } : h;
}

/** Drops the open run of merged changes with this key, as if it never happened (a dialog's Cancel). No redo is kept. */
export function discard<T>(h: History<T>, key: string): History<T> {
  const prev = h.past[h.past.length - 1];
  if (h.coalesceKey !== key || !prev) return h;
  return { past: h.past.slice(0, -1), present: prev.state, label: prev.label, future: [] };
}

export const canUndo = (h: History<unknown>) => h.past.length > 0;
export const canRedo = (h: History<unknown>) => h.future.length > 0;
