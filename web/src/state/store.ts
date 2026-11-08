import { canRedo, canUndo, createHistory, discard, push, redo, seal, undo, type History } from "./history";

/**
 * What the shell's undo and redo buttons talk to. The document store implements it now; the kernel's document
 * revisions (#4) and the timeline (#7) implement it later without touching the shell.
 */
export interface HistoryStore {
  canUndo(): boolean;
  canRedo(): boolean;
  undoLabel(): string;
  redoLabel(): string;
  undo(): void;
  redo(): void;
  subscribe(fn: () => void): () => void;
}

/** An undoable store of immutable snapshots. */
export function createStore<T>(initial: T) {
  let h: History<T> = createHistory(initial);
  const listeners = new Set<() => void>();
  // Read-only (#91, #92): an old version or a shared model can be looked at, not changed.
  let locked: null | (() => void) = null;
  // A last word on every edit (the active component stamping new steps, #171).
  let stamp: null | ((before: T, after: T) => T) = null;
  const guard =
    <A extends unknown[]>(fn: (...a: A) => void) =>
    (...a: A) => {
      // The note comes after whatever the caller says next ("Deleted Box 1"), so it is the one left showing.
      if (locked) queueMicrotask(locked);
      else fn(...a);
    };
  const set = (next: History<T>) => {
    if (next === h) return;
    h = next;
    listeners.forEach((l) => l());
  };
  const store = {
    get: () => h.present,
    history: () => h,
    /** Applies a change as one undo step; changes with the same key in a row merge (a scrub, typing a name). */
    edit: guard((fn: (s: T) => T, label: string, coalesceKey?: string) => {
      const next = fn(h.present);
      set(push(h, stamp ? stamp(h.present, next) : next, label, coalesceKey));
    }),
    /** Sets what every later edit passes through, or null for none. */
    setStamp: (fn: typeof stamp) => {
      stamp = fn;
    },
    /** Ends a run of merged changes. */
    seal: () => set(seal(h)),
    /** Takes back the open run of changes with this key (Cancel on a live dialog). */
    discard: (key: string) => set(discard(h, key)),
    canUndo: () => !locked && canUndo(h),
    canRedo: () => !locked && canRedo(h),
    undoLabel: () => h.label,
    redoLabel: () => h.future[0]?.label ?? "",
    undo: guard(() => set(undo(h))),
    redo: guard(() => set(redo(h))),
    /** Stops every change; `blocked` runs when something tries one. Null lets changes through again. */
    lock: (blocked: (() => void) | null) => {
      locked = blocked;
      listeners.forEach((l) => l());
    },
    isLocked: () => locked !== null,
    /** Puts back a whole history, as it was before a read-only look (Back from a version). */
    reset: (next: History<T>) => set(next),
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
  return store satisfies HistoryStore;
}

export type Store<T> = ReturnType<typeof createStore<T>>;
