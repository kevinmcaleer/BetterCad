import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { ESC, useEscape } from "@bettercad/ui";
import { insertCatalogue, newId, placeOnFace, type CataloguePart, type ModelDoc, type Vec3 } from "../state/document";
import type { View3DHandle } from "../viewport/View3D";

/**
 * Placing a catalogue part (#187) or another model (#484): pick it, then click a flat face (or the ground) and it
 * stands there, its z along the face's normal. Turn it 90° at a time before clicking; Esc puts it back.
 */
export interface PlaceDeps {
  record: (fn: (d: ModelDoc, at: number | undefined) => ModelDoc, label: string) => void;
  view: RefObject<View3DHandle>;
  /** Selects the placed part. */
  select: (ids: string[]) => void;
  say: (text: string, error?: boolean) => void;
}

/** Something to place: what the bar calls it, and how it goes into the document once a spot is clicked. */
export interface Placeable {
  id: string;
  name: string;
  /** It goes in as a step whose id is a step's ("f…") rather than a part's. */
  step?: boolean;
  /** A catalogue part whose sizes aren't checked against a real one. */
  unchecked?: boolean;
  /** Puts it in at `place`, as `id` (the new part's or step's), at the marker `at`. */
  put: (doc: ModelDoc, place: { position: Vec3; rotation: Vec3 }, id: string, at: number | undefined) => ModelDoc;
  /** What to select once it's in. */
  selects: (id: string) => string[];
  /** What to say once it's in. */
  done: string;
}

/** A catalogue part as a placeable: one reference body. */
export const catalogueItem = (rec: CataloguePart): Placeable => ({
  id: rec.id,
  name: rec.name,
  unchecked: !rec.checked,
  put: (doc, place, id, i) => insertCatalogue(doc, rec, place, id, undefined, i),
  selects: (id) => [id],
  done: `Placed ${rec.name}, ${rec.mass} g`,
});

/** Parts land on a 0.5 mm grid. */
const snap = (v: number) => Math.round(v * 2) / 2 + 0;

export function usePlacePart(d: PlaceDeps) {
  const deps = useRef(d);
  deps.current = d;
  const [part, setPart] = useState<Placeable | null>(null);
  const [quarters, setQuarters] = useState(0);
  const live = useRef({ part, quarters });
  live.current = { part, quarters };

  const place = useCallback((p: Placeable) => {
    setPart((cur) => (cur?.id === p.id ? null : p));
    setQuarters(0);
  }, []);
  const start = useCallback((p: CataloguePart) => place(catalogueItem(p)), [place]);
  const cancel = useCallback(() => setPart(null), []);
  const turn = useCallback(() => setQuarters((q) => (q + 1) % 4), []);

  useEffect(() => {
    const eng = deps.current.view.current?.engine();
    if (!part || !eng) return;
    eng.setInput({
      move: (p, _m, pressed) => {
        if (!pressed) eng.showHover(eng.pick(p.x, p.y, "face"));
      },
      down: (p) => {
        const hit = eng.pick(p.x, p.y, "face");
        let point: [number, number, number] | null;
        let normal: [number, number, number] = [0, 0, 1];
        let x: [number, number, number] = [1, 0, 0];
        if (hit) {
          const info = eng.faceInfo(hit.body, hit.index);
          if (!info?.flat) {
            deps.current.say("Parts go on flat faces", true);
            return true;
          }
          normal = info.normal;
          // Square to the world where the face allows, so a part on a box's top lines up with its edges.
          x = Math.abs(info.normal[2]) > 0.999 ? [1, 0, 0] : info.edge;
          point = eng.rayPlane(p.x, p.y, info.centroid, info.normal);
        } else point = eng.rayPlane(p.x, p.y, [0, 0, 0], [0, 0, 1]);
        if (!point) return false;
        const { part: rec, quarters: q } = live.current;
        if (!rec) return false;
        const at = point.map(snap) as [number, number, number];
        const id = newId(rec.step ? "f" : "p");
        deps.current.record((doc, i) => rec.put(doc, placeOnFace(at, normal, x, q), id, i), `Insert ${rec.name}`);
        deps.current.select(rec.selects(id));
        deps.current.say(rec.done);
        eng.showHover(null);
        setPart(null);
        return true;
      },
      leave: () => eng.showHover(null),
    });
    return () => {
      eng.setInput(null);
      eng.showHover(null);
    };
  }, [part]);

  useEscape(!!part, cancel, ESC.tool);
  const help = part ? `Click a flat face, or the ground, to place the ${part.name}. T turns it 90° first. Esc puts it back.` : null;
  return { part, quarters, start, place, cancel, turn, help };
}

export type PlaceSession = ReturnType<typeof usePlacePart>;
