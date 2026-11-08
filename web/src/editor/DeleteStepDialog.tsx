import type { ModelDoc } from "../state/document";
import { formatCombo } from "../state/commands";

/** "1 later step rebuilds" or "5 later steps rebuild": the count, then the verb that agrees with it. */
export function laterText(n: number, verb?: [one: string, many: string]): string {
  const text = `${n} later ${n === 1 ? "step" : "steps"}`;
  return verb ? `${text} ${n === 1 ? verb[0] : verb[1]}` : text;
}

const REBUILD: [string, string] = ["rebuilds", "rebuild"];

/** How many steps come after a step on the timeline. */
export function stepsAfter(doc: ModelDoc, id: string): number {
  const i = doc.features.findIndex((f) => f.id === id);
  return i < 0 ? 0 : doc.features.length - i - 1;
}

/**
 * What the timeline warns about while you change an earlier step, or add one while it's rolled back. Null when
 * nothing comes after the change.
 */
export function earlierWarning(doc: ModelDoc, at: number, editingId: string | null): string | null {
  const n = doc.features.length;
  const f = editingId ? doc.features.find((x) => x.id === editingId) : undefined;
  if (f) {
    const later = stepsAfter(doc, f.id);
    return later ? `You're changing ${f.name}. ${laterText(later, REBUILD)} after it, and any that use its faces or edges may break.` : null;
  }
  if (at < n) return `Rolled back. What you add goes before ${laterText(n - at)}, which may break.`;
  return null;
}

/** What the timeline says after a step is dragged to a new place, while the model is as the move left it. */
export interface MoveNote {
  doc: ModelDoc;
  /** From `moveWarning`: steps that pick edges or faces on a shape now built differently. Empty when none. */
  text: string;
  /** The steps that failed before the move, so only new failures are named. */
  failedBefore: Set<string>;
}

/** The warning after a reorder: picks that may now be wrong, and steps that no longer build. Null when neither. */
export function moveText(doc: ModelDoc, note: MoveNote | null, failed: Map<string, string>): string | null {
  if (!note || note.doc !== doc) return null;
  const broken = doc.features.filter((f) => failed.has(f.id) && !note.failedBefore.has(f.id)).map((f) => f.name);
  const parts = [note.text, broken.length && `${list(broken)} can't build now`].filter(Boolean);
  if (!parts.length) return null;
  return `${parts.join(". ")}. Double-click a step to check it, or press ${formatCombo("mod+z")} to undo the move.`;
}

const list = (names: string[]) => (names.length === 1 ? names[0]! : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);
