import { useEffect, useMemo, useRef, useState, type MutableRefObject, type RefObject } from "react";
import { Button, ESC, FeaturePanel, FeatureRow, PanelNote, useEscape } from "@bettercad/ui";
import type { Call, Methods } from "@bettercad/kernel";
import { addConverted, type Recognition } from "@bettercad/kernel/recognise";
import type { ModelDoc } from "../state/document";
import type { Engine } from "../viewport/engine";
import { HoleMarks } from "./holeMarks";
import { groupText, leftText, summaryText, SCULPTED } from "./holeText";

type Found = Recognition & { open: boolean };

const ROUGH = [
  { label: "Clean", title: "A mesh saved from CAD: flat faces are flat and round ones are even" },
  { label: "Rough", title: "A mesh that has been thinned out or repaired: allow more slack" },
  { label: "Very rough", title: "A scanned or heavily thinned mesh: allow a lot of slack" },
];

export interface RecogniseToolProps {
  /** The imported mesh body. */
  part: { id: string; name: string };
  doc: ModelDoc;
  /** The step the model is rolled back to, if it is. */
  upTo?: number;
  /** The component being worked in, which the new one goes inside. */
  parent?: string;
  call: <M extends keyof Methods>(method: M, params: Methods[M]["params"]) => Call<Methods[M]["result"]> | null;
  record: (fn: (d: ModelDoc, at: number | undefined) => ModelDoc, label: string) => void;
  say: (text: string, bad?: boolean) => void;
  view: RefObject<{ engine(): Engine | null } | null>;
  /** Selects the new body once it is made. */
  select: (ids: string[]) => void;
  /** Set to the tool's OK while it is open, so Enter can press it. */
  okRef?: MutableRefObject<(() => void) | null>;
  onClose: () => void;
}

/**
 * Recognise features (#446): finds the holes in an imported mesh, lists them to tick, and on OK makes an editable
 * copy of the body in a new component with a Hole step for each run of ticked holes. The mesh stays, hidden.
 */
export function RecogniseTool({ part, doc, upTo, parent, call, record, say, view, select, okRef, onClose }: RecogniseToolProps) {
  const [rough, setRough] = useState(0);
  const [found, setFound] = useState<Found | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [off, setOff] = useState<Set<number>>(new Set());
  const [hot, setHot] = useState<number | null>(null);
  // The model as it was when the tool opened: the tool's own steps aren't in it yet.
  const from = useRef({ doc, upTo });

  useEscape(true, onClose, ESC.tool + 1);

  useEffect(() => {
    setFound(null);
    setError(null);
    setOff(new Set());
    const c = call("recognise", { doc: from.current.doc, upTo: from.current.upTo, body: part.id, rough });
    if (!c) return setError("The modeller is still loading. Try again in a moment.");
    let live = true;
    c.then(
      (r) => live && setFound(r),
      (e: unknown) => live && setError(e instanceof Error ? e.message : "The mesh could not be read."),
    );
    return () => {
      live = false;
      c.cancel();
    };
  }, [call, part.id, rough]);

  const groups = useMemo(() => found?.groups ?? [], [found]);
  const left = useMemo(() => (found ? found.holes.filter((h) => !h.step) : []), [found]);
  /** Per found hole: it will become a step. */
  const chosen = useMemo(() => {
    const on = (found?.holes ?? []).map(() => false);
    groups.forEach((g, i) => {
      if (!off.has(i)) for (const h of g.holes) on[h] = true;
    });
    return on;
  }, [found, groups, off]);
  const count = chosen.filter(Boolean).length;
  const toggle = (i: number) =>
    setOff((s) => {
      const n = new Set(s);
      if (!n.delete(i)) n.add(i);
      return n;
    });

  // The holes' rims in the view; a click on one ticks or unticks its row.
  const state = useRef({ found, groups, toggle });
  state.current = { found, groups, toggle };
  const marks = useRef<HoleMarks | null>(null);
  useEffect(() => {
    const eng = view.current?.engine() ?? null;
    if (!eng) return;
    const m = new HoleMarks(eng);
    marks.current = m;
    const under = (p: { x: number; y: number }): number | null => {
      const { found, groups } = state.current;
      if (!found) return null;
      let best: number | null = null;
      let bestD = Infinity;
      groups.forEach((g, gi) => {
        for (const hi of g.holes) {
          const h = found.holes[hi]!;
          const c = eng.project(h.origin);
          const d = Math.hypot(c.x - p.x, c.y - p.y);
          const r = Math.max(10, (h.head?.diameter ?? h.diameter) / 2 / eng.pixelSize(h.origin));
          if (d <= r && d < bestD) {
            best = gi;
            bestD = d;
          }
        }
      });
      return best;
    };
    eng.setInput({
      down: (p) => {
        const g = under(p);
        if (g === null) return false;
        state.current.toggle(g);
        return true;
      },
      move: (p, _m, pressed) => {
        if (!pressed) setHot(under(p));
      },
      leave: () => setHot(null),
    });
    return () => {
      eng.setInput(null);
      m.dispose();
      marks.current = null;
    };
  }, [view]);
  useEffect(() => {
    if (!found) return marks.current?.show([], [], []);
    marks.current?.show(found.holes, chosen, hot === null ? [] : (groups[hot]?.holes ?? []));
  }, [found, chosen, hot, groups]);

  const ok = () => {
    if (!found || !count || found.open) return;
    let made: { body: string; steps: number } | null = null;
    record((d, at) => {
      const r = addConverted(d, at, found, { part: part.id, name: part.name, holes: chosen, parent });
      made = r;
      return r.doc;
    }, `Convert ${part.name}`);
    const m = made as { body: string; steps: number } | null;
    if (m) select([m.body]);
    say(`${part.name} is now editable, with ${count} ${count === 1 ? "hole" : "holes"} you can change. The mesh is hidden.`);
    onClose();
  };

  const gaps = !!found?.open;
  const okNow = useRef(ok);
  okNow.current = ok;
  useEffect(() => {
    if (!okRef) return;
    okRef.current = () => okNow.current();
    return () => {
      okRef.current = null;
    };
  }, [okRef]);
  return (
    <FeaturePanel
      title="Recognise features"
      icon="shapes"
      className="bc-recognise"
      cancel={{ title: "Leave the mesh as it is", onClick: onClose }}
      ok={{
        label: "Convert",
        title: gaps ? "A mesh with gaps can't be converted" : count ? "Make an editable body with these holes as Hole steps" : "Tick a hole to convert",
        disabled: !count || gaps,
        onClick: ok,
      }}
    >
      <FeatureRow label="Mesh">
        <span role="group" aria-label="How rough the mesh is" className="bc-segmented">
          {ROUGH.map((r, i) => (
            <Button key={r.label} label={r.label} title={r.title} on={rough === i} onClick={() => setRough(i)} />
          ))}
        </span>
      </FeatureRow>
      {error && <PanelNote tone="error">{error}</PanelNote>}
      {!found && !error && <PanelNote live>Looking for holes in {part.name}. A big mesh takes a few seconds.</PanelNote>}
      {found && gaps && <PanelNote tone="error">This mesh has gaps, so it can't be converted. Repair it in your slicer and import it again.</PanelNote>}
      {found && !gaps && found.coverage < SCULPTED && (
        <PanelNote>Most of this mesh is sculpted, so there is little to recognise. It works best on parts made of flat and round faces.</PanelNote>
      )}
      {found && !groups.length && (
        <PanelNote live>{rough < 2 ? "No holes found. If the mesh is rough, try a rougher setting." : "No holes found in this mesh."}</PanelNote>
      )}
      {found && groups.length > 0 && (
        <>
          <PanelNote live>
            {found.holes.length === 1 ? "1 hole found." : `${found.holes.length} holes found.`} Ticked holes become Hole steps you can change.
          </PanelNote>
          <ul className="bc-recognise-list" aria-label="Holes found">
            {groups.map((g, i) => (
              <li key={i} className={hot === i ? "bc-on" : undefined} onPointerEnter={() => setHot(i)} onPointerLeave={() => setHot(null)}>
                <label>
                  <input
                    type="checkbox"
                    checked={!off.has(i)}
                    disabled={gaps}
                    onChange={() => toggle(i)}
                    onFocus={() => setHot(i)}
                    onBlur={() => setHot(null)}
                  />
                  <span>{groupText(g)}</span>
                </label>
              </li>
            ))}
          </ul>
        </>
      )}
      {left.length > 0 && (
        <>
          <PanelNote>Left as they are in the mesh:</PanelNote>
          <ul className="bc-recognise-list bc-recognise-left" aria-label="Holes left as they are">
            {left.map((h, i) => (
              <li key={i}>{leftText(h)}</li>
            ))}
          </ul>
        </>
      )}
      {found && <PanelNote>{summaryText(found)}</PanelNote>}
    </FeaturePanel>
  );
}
