import { modelRemoval, removeInsertedModel } from "@bettercad/kernel/insert-model";
import { formatCombo } from "../state/commands";
import type { ModelDoc } from "../state/document";

/** Removing an inserted model (#480), loaded when you first pick Remove rather than at first paint. */
export interface RemoveModelArgs {
  store: { get(): ModelDoc; edit(fn: (d: ModelDoc) => ModelDoc, label: string): void };
  id: string;
  /** With other steps that use its bodies: true deletes them too, false keeps them, unset asks first. */
  all?: boolean;
  ask: (id: string) => void;
  /** The timeline marker, which moves back over steps that go from before it. */
  marker: number | null;
  setMarker: (m: number) => void;
  setSelection: (fn: (s: string[]) => string[]) => void;
  say: (text: string) => void;
}

const count = (n: number, one: string, many: string) => (n === 1 ? one : `${n} ${many}`);

/** Removes an inserted model with its joints, as one undo step, or asks first when other steps use its bodies. */
export function removeModel({ store, id, all, ask, marker, setMarker, setSelection, say }: RemoveModelArgs) {
  const d0 = store.get();
  const f = d0.features.find((x) => x.id === id);
  if (!f || f.type !== "model") return;
  const { ties, uses } = modelRemoval(d0, id);
  if (all === undefined && uses.length) return ask(id);
  const gone = new Set([id, ...ties.map((x) => x.id), ...(all ? uses.map((x) => x.id) : [])]);
  const before = marker === null ? 0 : d0.features.slice(0, marker).filter((x) => gone.has(x.id)).length;
  store.edit((d) => removeInsertedModel(d, id, !!all), `Remove ${f.name}`);
  if (marker !== null && before) setMarker(marker - before);
  setSelection((s) => s.filter((x) => !x.startsWith(`${id}/`)));
  const joints = ties.length ? ` and ${count(ties.length, "its joint", "joints")}` : "";
  const more = all && uses.length ? `, with ${count(uses.length, "1 step", "steps")} that used it` : "";
  say(`Removed ${f.name}${joints}${more}. ${formatCombo("mod+z")} brings it back.`);
}
