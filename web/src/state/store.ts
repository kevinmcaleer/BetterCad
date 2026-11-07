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
  const set = (next: History<T>) => {
    if (next === h) return;
    h = next;
    listeners.forEach((l) => l());
  };
  const store = {
    get: () => h.present,
    history: () => h,
    /** Applies a change as one undo step; changes with the same key in a row merge (a scrub, typing a name). */
    edit: (fn: (s: T) => T, label: string, coalesceKey?: string) => set(push(h, fn(h.present), label, coalesceKey)),
    /** Ends a run of merged changes. */
    seal: () => set(seal(h)),
    /** Takes back the open run of changes with this key (Cancel on a live dialog). */
    discard: (key: string) => set(discard(h, key)),
    canUndo: () => canUndo(h),
    canRedo: () => canRedo(h),
    undoLabel: () => h.label,
    redoLabel: () => h.future[0]?.label ?? "",
    undo: () => set(undo(h)),
    redo: () => set(redo(h)),
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
