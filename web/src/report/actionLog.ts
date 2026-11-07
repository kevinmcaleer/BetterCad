import type { ModelDoc } from "../state/document";

/**
 * The last 20 things done (#109), for a problem report: command ids and timeline changes by feature id and type.
 * Never names, numbers typed or sketch coordinates. Kept in memory only, and sent only when the person presses Send.
 */
export interface Action {
  /** When, ms since the epoch. */
  at: number;
  /** A command id ("tool.fillet", "file.save") or "edit" for a change to the timeline. */
  id: string;
  /** For an edit: which features were added (+), changed (~) or removed (−), by id and type. */
  detail?: string;
}

export class ActionLog {
  private items: Action[] = [];
  constructor(readonly size = 20) {}
  record(a: Omit<Action, "at"> & { at?: number }): void {
    this.items.push({ at: a.at ?? Date.now(), id: a.id, ...(a.detail ? { detail: a.detail } : {}) });
    if (this.items.length > this.size) this.items.splice(0, this.items.length - this.size);
  }
  list(): Action[] {
    return [...this.items];
  }
  clear(): void {
    this.items = [];
  }
}

/** The app's one log. */
export const actionLog = new ActionLog();

/** What changed between two documents, as feature ids and types only: "+f12 hole, ~f3 extrude, −f4". */
export function editSummary(before: ModelDoc, after: ModelDoc): string {
  const was = new Map(before.features.map((f) => [f.id, f]));
  const now = new Map(after.features.map((f) => [f.id, f]));
  const out: string[] = [];
  for (const [id, f] of now) {
    const old = was.get(id);
    if (!old) out.push(`+${id} ${f.type}`);
    else if (old !== f) out.push(`~${id} ${f.type}`);
  }
  for (const [id, f] of was) if (!now.has(id)) out.push(`−${id} ${f.type}`);
  if (!out.length && before.params !== after.params) out.push("parameters");
  if (!out.length && before.print !== after.print) out.push("print settings");
  if (!out.length && before.looks !== after.looks) out.push("looks");
  return out.slice(0, 6).join(", ") + (out.length > 6 ? `, and ${out.length - 6} more` : "");
}
