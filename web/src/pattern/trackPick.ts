import type { MeasureResult, TopoRef } from "@bettercad/kernel";
import {
  bodyGeo,
  bodyRef,
  build,
  circleOf,
  copyId,
  mat4Apply,
  mat4ApplyDir,
  MAX_TRACK_PIECES,
  trackLayoutOf,
  undoMove,
  type ConstructRef,
  type Geo,
  type ModelDoc,
  type Part,
  type PatternFeature,
  type TrackLayout,
  type TrackSpec,
} from "../state/document";
import { insideReach } from "@bettercad/kernel/track-fit";
import { geoFromPick } from "../construct/pickGeo";
import type { Engine, ScreenPoint } from "../viewport/engine";
import type { Pick } from "../viewport/ids";

/**
 * Track picking (Pattern's Track kind): the pins at each end of the piece and a round edge on each wheel. Loaded the
 * first time a track is picked, so none of it is in the first paint.
 */

export type TrackSlot = "start" | "end" | "wheel";
type V3 = [number, number, number];

/** The bodies as they stood before the step: where its picks are kept. */
export function partsBefore(doc: ModelDoc, id: string): Part[] {
  const i = doc.features.findIndex((f) => f.id === id);
  return build(doc, i < 0 ? doc.features.length : i).parts;
}

const resolver = (parts: Part[]) => (r: ConstructRef) => {
  if (!("body" in r)) return "Not a body";
  const p = parts.find((q) => q.id === r.body);
  return p ? bodyGeo(r, p) : "The body is gone";
};

/** The track laid where its wheels are now, or why it can't be. */
export function trackLayout(doc: ModelDoc, f: PatternFeature): TrackLayout | string {
  return f.track ? trackLayoutOf(f.track, resolver(partsBefore(doc, f.id))) : "No track";
}

/** Which piece a body is: 0 for the piece itself, k + 1 for copy k, -1 for neither. */
function pieceIndex(f: PatternFeature, body: string): number {
  const piece = f.parts[0];
  if (!piece) return -1;
  if (body === piece) return 0;
  const n = Math.min(MAX_TRACK_PIECES, f.track?.count ?? 0);
  for (let k = 0; k < n; k++) if (copyId(f, piece, k) === body) return k + 1;
  return -1;
}

/** The pick under the pointer: an edge first, then a face. */
export function trackUnder(eng: Engine, p: ScreenPoint): Pick | null {
  for (const kind of ["edge", "face"] as const) {
    const hit = eng.pick(p.x, p.y, kind);
    if (hit) return hit;
  }
  return null;
}

const NOT_ROUND = "Click a round edge or a round face: a pin, a hole or a wheel's rim.";

/** A circle moved by a column-major 4 × 4. */
function moveCircle(g: Extract<Geo, { t: "circle" }>, m: number[]): Geo {
  return { ...g, centre: mat4Apply(m, g.centre as V3), axis: mat4ApplyDir(m, g.axis as V3) };
}

/** As many pieces as go round, and the lift that sets the piece's inside on the wheels, once everything is picked. */
export function fillTrack(doc: ModelDoc, f: PatternFeature, t: TrackSpec, eng: Engine | null, lift: boolean): TrackSpec {
  if (!t.start || !t.end || t.wheels.length < 2) return t;
  const parts = partsBefore(doc, f.id);
  const out = { ...t };
  const at = resolver(parts);
  const s = circleOf(at(t.start));
  const e = circleOf(at(t.end));
  // The first time it can be laid, it sits on the wheels; after that only Sit on wheels or a new pin sets the lift.
  if ((lift || out.count < 2) && s && e && eng && f.parts[0]) {
    // The piece is drawn moved onto the track when the step already lays it: bring its corners back to where it stood.
    const now = trackLayout(doc, f);
    const pos = eng.bodyPositions(f.parts[0]);
    if (pos) {
      const back = typeof now === "string" ? null : undoMove({ place: now.pieces[0]! });
      if (back && "place" in back) for (let i = 0; i + 2 < pos.length; i += 3) pos.set(mat4Apply(back.place, [pos[i]!, pos[i + 1]!, pos[i + 2]!]), i);
      out.lift = insideReach(pos, { start: s.centre, end: e.centre, axis: s.normal }, t.flip);
    }
  }
  if (out.count < 2) {
    const one = trackLayoutOf({ ...out, count: 1 }, at);
    out.count = typeof one === "string" ? 2 : Math.max(2, Math.min(MAX_TRACK_PIECES, Math.round(one.fits) || 2));
  }
  return out;
}

/**
 * What a click picks for the track: a pin on the piece (any of its copies will do) or a wheel's round edge, as the
 * track's new settings. A message when it can't be used.
 */
export async function pickForTrack(
  eng: Engine,
  hit: Pick,
  p: ScreenPoint,
  slot: TrackSlot,
  doc: ModelDoc,
  f: PatternFeature,
  measure: (refs: TopoRef[]) => Promise<MeasureResult | null>,
): Promise<TrackSpec | string> {
  if (hit.kind !== "edge" && hit.kind !== "face") return NOT_ROUND;
  const r = await measure([{ body: hit.body, kind: hit.kind, index: hit.index }]);
  const s = r?.items[0];
  const geo = s && geoFromPick(s, { ray: eng.ray(p.x, p.y) });
  if (!geo || geo.t !== "circle" || !circleOf(geo)) return NOT_ROUND;
  const t: TrackSpec = { count: 0, wheels: [], offset: 0, lift: 0, side: 0, ...f.track };
  const parts = partsBefore(doc, f.id);
  const k = pieceIndex(f, hit.body);
  if (slot === "wheel") {
    if (k >= 0) return "That's the track. Click a round edge on a wheel.";
    const part = parts.find((q) => q.id === hit.body);
    if (!part) return "Click a wheel that was there before the track.";
    const ref = bodyRef(part, hit.kind, hit.index, geo);
    const c = geo.centre;
    // The same circle again takes it out.
    const same = t.wheels.findIndex((w) => {
      const g = "body" in w && w.body === part.id ? circleOf(bodyGeo(w, part)) : null;
      return !!g && Math.hypot(g.centre[0] - c[0], g.centre[1] - c[1], g.centre[2] - c[2]) < 0.05;
    });
    const wheels = same >= 0 ? t.wheels.filter((_, i) => i !== same) : [...t.wheels, ref];
    return fillTrack(doc, f, { ...t, wheels }, eng, false);
  }
  if (k < 0) return "Click a pin or hole on the track piece.";
  const piece = parts.find((q) => q.id === f.parts[0]);
  if (!piece) return "The track piece is gone.";
  // Laid already, the piece clicked is moved onto the track: bring the pick back to where the piece stood.
  const lay = trackLayout(doc, f);
  let local: Geo = geo;
  if (typeof lay !== "string" && lay.pieces[k]) {
    const back = undoMove({ place: lay.pieces[k] });
    if ("place" in back) local = moveCircle(geo, back.place);
  }
  const ref = bodyRef(piece, hit.kind, hit.index, local);
  const next = { ...t, [slot]: ref };
  return fillTrack(doc, f, next, eng, true);
}

/** What each pick asks for, on the Pattern panel. */
export const TRACK_HELP: Record<TrackSlot, string> = {
  start: "Click the pin or hole where the piece joins the one before it. Esc stops picking.",
  end: "Now the pin or hole at its other end, where the next piece joins on. Esc stops picking.",
  wheel: "Click a round edge on each wheel the track goes round, two or more. Click one again to leave it out. Esc when they're all picked.",
};

/** Picking in the view for a track's `slot`: lights what's under the pointer and keeps each pick. Returns the stop. */
export function trackInput(
  eng: Engine,
  slot: TrackSlot,
  x: {
    feature: () => PatternFeature | null;
    doc: () => ModelDoc;
    measure: (refs: TopoRef[]) => Promise<MeasureResult | null>;
    say: (text: string, error?: boolean) => void;
    change: (t: TrackSpec) => void;
    next: (slot: TrackSlot | null) => void;
  },
): () => void {
  let gone = false;
  eng.setInput({
    move: (p, _m, pressed) => {
      if (!pressed) eng.showHover(trackUnder(eng, p));
    },
    down: (p) => {
      const f = x.feature();
      const hit = trackUnder(eng, p);
      if (!f || !hit) return true;
      void pickForTrack(eng, hit, p, slot, x.doc(), f, x.measure).then(
        (t) => {
          if (gone) return;
          if (typeof t === "string") return x.say(t, true);
          x.change(t);
          if (slot !== "wheel") x.next(slot === "start" && !t.end ? "end" : t.wheels.length < 2 ? "wheel" : null);
        },
        () => !gone && x.say(NOT_ROUND, true),
      );
      return true;
    },
    leave: () => eng.showHover(null),
  });
  return () => {
    gone = true;
    eng.setInput(null);
    eng.showHover(null);
  };
}
