import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { addFinish, newId, updateFinish, type FinishFeature, type ModelDoc, type Part } from "../state/document";
import type { View3DHandle } from "../viewport/View3D";
import type { Engine } from "../viewport/engine";
import type { Pick } from "../viewport/ids";

/**
 * Fillet, Chamfer (#67) and Shell (#68): click edges (or the faces to leave open) on one body, set the size, Enter.
 * Picks are made on the body as it is, so the step goes on the timeline only when it is done.
 */
export interface FinishDeps {
  record: (fn: (d: ModelDoc, at: number | undefined) => ModelDoc, label: string) => void;
  /** Changes the document in place, as one undo step (re-picking a step's edges or faces). */
  update: (fn: (d: ModelDoc) => ModelDoc, label: string) => void;
  parts: Part[];
  view: RefObject<View3DHandle>;
  /** The armed tool: fillet (round or bevel edges) or shell (faces left open). */
  tool: "fillet" | "shell" | null;
  onClose: () => void;
  say: (text: string, error?: boolean) => void;
}

export function useFinish(d: FinishDeps) {
  const deps = useRef(d);
  deps.current = d;
  const [part, setPart] = useState<string | null>(null);
  const [refs, setRefs] = useState<number[]>([]);
  const [bevel, setBevel] = useState(false);
  const [radius, setRadius] = useState(1);
  const [wall, setWall] = useState(1.2);
  const [outside, setOutside] = useState(false);
  /** A step whose picks are being made again (#77), and how to put the timeline marker back after. */
  const editing = useRef<{ id: string; name: string; part: string; restore: () => void } | null>(null);
  const live = useRef({ part, refs, bevel, radius, wall, outside });
  live.current = { part, refs, bevel, radius, wall, outside };

  const kind = d.tool === "shell" ? "face" : "edge";
  const engineOf = useCallback((): Engine | null => d.view.current?.engine() ?? null, [d.view]);

  // A fresh start each time the tool is armed or changed; putting it down ends a re-pick and rolls forward again.
  useEffect(() => {
    const e = editing.current;
    if (e && !d.tool) {
      editing.current = null;
      e.restore();
    }
    setPart(editing.current?.part ?? null);
    setRefs([]);
  }, [d.tool]);

  // The body goes away (undo, delete): start again.
  useEffect(() => {
    if (part && !d.parts.some((p) => p.id === part)) {
      setPart(null);
      setRefs([]);
    }
  }, [part, d.parts]);

  useEffect(() => {
    const eng = engineOf();
    if (!d.tool || !eng) return;
    eng.setInput({
      move: (p, _m, pressed) => {
        if (pressed) return;
        const hit = eng.pick(p.x, p.y, kind);
        const L = live.current;
        eng.showHover(hit && (!L.part || hit.body === L.part) ? hit : null);
      },
      down: (p) => {
        const hit = eng.pick(p.x, p.y, kind);
        if (!hit) return false;
        const L = live.current;
        if (L.part && hit.body !== L.part) {
          const name = deps.current.parts.find((x) => x.id === L.part)?.name ?? "the first body";
          deps.current.say(`One body at a time: pick more on ${name}, or press Esc to start again`, true);
          return true;
        }
        setPart(hit.body);
        setRefs((r) => (r.includes(hit.index) ? r.filter((i) => i !== hit.index) : [...r, hit.index]));
        return true;
      },
      leave: () => eng.showHover(null),
    });
    return () => {
      eng.setInput(null);
      eng.showHover(null);
    };
  }, [d.tool, kind, engineOf]);

  const picks = useMemo<Pick[]>(() => (part ? refs.map((index) => ({ body: part, kind, index })) : []), [part, refs, kind]);

  const done = useCallback((sizeNow?: number) => {
    const D = deps.current;
    // Read through the ref: Enter in a size field commits it and finishes in the same moment.
    const { part: p, refs: r, bevel, radius, wall, outside } = live.current;
    if (!p || (D.tool === "fillet" && !r.length)) return D.say(D.tool === "shell" ? "Click a face of the body to hollow" : "Click the edges to round", true);
    const type = D.tool === "shell" ? "shell" : bevel ? "chamfer" : "fillet";
    const size = sizeNow ?? (type === "shell" ? wall : radius);
    if (sizeNow !== undefined) (type === "shell" ? setWall : setRadius)(sizeNow);
    const label = type === "shell" ? "Shell" : type === "fillet" ? "Fillet" : "Chamfer";
    const e = editing.current;
    if (e) {
      editing.current = null;
      D.update((doc) => updateFinish(doc, e.id, { type, refs: r, size, outside: type === "shell" ? outside : undefined }), `Re-pick ${e.name}`);
      e.restore();
    } else D.record((doc, at) => addFinish(doc, { type, part: p, refs: r, size, outside: type === "shell" ? outside : undefined }, newId("f"), at), label);
    const name = D.parts.find((x) => x.id === p)?.name ?? "the body";
    const n = r.length;
    D.say(
      type === "shell"
        ? `Hollowed ${name} to a ${size} mm wall${n ? "" : ". A sealed hollow traps material when printed"}`
        : `${type === "fillet" ? "Rounded" : "Bevelled"} ${n === 1 ? "1 edge" : `${n} edges`} of ${name}, ${size} mm`,
    );
    setPart(null);
    setRefs([]);
    D.onClose();
  }, []);

  /** Makes a failed step's picks again on the part as it was just before it (#77). */
  const repick = useCallback((f: FinishFeature, restore: () => void) => {
    editing.current = { id: f.id, name: f.name, part: f.part, restore };
    setPart(f.part);
    setRefs([]);
    setBevel(f.type === "chamfer");
    if (f.type === "shell") {
      setWall(f.size);
      setOutside(!!f.outside);
    } else setRadius(f.size);
  }, []);

  const clear = useCallback(() => {
    setPart(null);
    setRefs([]);
  }, []);

  const partName = part ? (d.parts.find((p) => p.id === part)?.name ?? null) : null;
  const help = !d.tool
    ? null
    : d.tool === "shell"
      ? part
        ? `Click more faces to leave open, or a picked one to close it. Enter hollows ${partName}.`
        : "Click the face to leave open, usually the top. Enter hollows the body."
      : part
        ? `Click more edges of ${partName}, or a picked one to drop it. Enter ${bevel ? "bevels" : "rounds"} them.`
        : `Click the edges to ${bevel ? "bevel" : "round"}.`;

  return {
    tool: d.tool,
    part,
    partName,
    refs,
    picks,
    bevel,
    setBevel,
    radius,
    setRadius,
    wall,
    setWall,
    outside,
    setOutside,
    done,
    clear,
    repick,
    repicking: editing.current?.name ?? null,
    help,
  };
}

export type FinishSession = ReturnType<typeof useFinish>;
