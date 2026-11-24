import { useId } from "react";
import type { ElectronicsDesign, Side } from "@bettercad/electronics";
import {
  SCREWS,
  alignParts,
  ripUpNet,
  setHole,
  setPlacement,
  setText,
  setTrackWidth,
  setVia,
  toggleLock,
  trackLength,
  type Align,
} from "@bettercad/electronics/pcb/route";
import { Button, NumberField, type IconName } from "@bettercad/ui";
import type { EEdit } from "./actions";
import { eui } from "./ui";

const ALIGN: { how: Align; label: string; icon: IconName }[] = [
  { how: "left", label: "Line up left", icon: "alignObjLeft" },
  { how: "right", label: "Line up right", icon: "alignObjRight" },
  { how: "top", label: "Line up top", icon: "alignObjTop" },
  { how: "bottom", label: "Line up bottom", icon: "alignObjBottom" },
  { how: "across", label: "Space evenly across", icon: "alignObjCenter" },
  { how: "down", label: "Space evenly down", icon: "alignObjMiddle" },
];
const round = (n: number) => Math.round(n * 100) / 100;

/**
 * What is picked on the board, as numbers you can type (#639): where a part sits, a track's width, a hole's size.
 * With `part` it is that part's place; without, whatever else is selected.
 */
export default function BoardProps({
  design,
  edit,
  readOnly,
  part,
  selected,
}: {
  design: ElectronicsDesign;
  edit: EEdit;
  readOnly?: boolean;
  part?: string;
  selected: string[];
}) {
  const ids = useId();
  const board = design.board;
  if (!board) return null;

  if (part) {
    const at = board.placements.find((p) => p.part === part);
    if (!at) return <p className="bc-note">Not on the board yet. Use Update from schematic.</p>;
    const set = (change: Parameters<typeof setPlacement>[2], label: string) =>
      edit((d) => setPlacement(d, part, change), label, `ec-place-${part}-${Object.keys(change).join()}`);
    return (
      <fieldset className="bc-ec-set" disabled={readOnly}>
        <legend>On the board</legend>
        <div className="bc-ec-set-row">
          <NumberField label="X" value={at.x} step={0.5} locked={at.locked} onCommit={(v) => set({ x: v }, "Move")} />
          <NumberField label="Y" value={at.y} step={0.5} locked={at.locked} onCommit={(v) => set({ y: v }, "Move")} />
          <NumberField label="Turn" unit="°" value={at.rot} step={45} locked={at.locked} onCommit={(v) => set({ rot: v }, "Rotate")} />
        </div>
        <label className="bc-field-label" htmlFor={`${ids}s`}>
          Side
        </label>
        <select
          id={`${ids}s`}
          className="bc-select"
          value={at.side}
          disabled={at.locked}
          onChange={(e) => set({ side: e.target.value as Side }, "Flip to the other side")}
        >
          <option value="top">Top</option>
          <option value="bottom">Bottom</option>
        </select>
        <label className="bc-ec-fitted">
          <input
            type="checkbox"
            checked={!!at.locked}
            onChange={(e) => set({ locked: e.target.checked }, e.target.checked ? "Lock the part" : "Unlock the part")}
          />
          Locked in place
        </label>
      </fieldset>
    );
  }

  const set = new Set(selected);
  const parts = board.placements.filter((p) => set.has(p.part));
  const tracks = board.tracks.filter((t) => set.has(t.id));
  const via = selected.length === 1 ? board.vias.find((v) => set.has(v.id)) : undefined;
  const hole = selected.length === 1 ? board.holes.find((h) => set.has(h.id)) : undefined;
  const text = selected.length === 1 ? board.texts.find((t) => set.has(t.id)) : undefined;

  if (parts.length > 1) {
    const locked = parts.every((p) => p.locked);
    return (
      <fieldset className="bc-ec-set" disabled={readOnly}>
        <legend>Line up</legend>
        <div className="bc-ec-align" role="group" aria-label="Line up the parts">
          {ALIGN.map((a) => (
            <Button
              key={a.how}
              icon={a.icon}
              aria-label={a.label}
              title={a.label}
              disabled={(a.how === "across" || a.how === "down") && parts.length < 3}
              onClick={() =>
                edit(
                  (d) =>
                    alignParts(
                      d,
                      parts.map((p) => p.part),
                      a.how,
                    ),
                  a.label,
                )
              }
            />
          ))}
        </div>
        <Button
          size="dense"
          variant="secondary"
          icon={locked ? "unlock" : "lock"}
          label={locked ? "Unlock them" : "Lock them in place"}
          title="Locked parts do not move, turn or flip"
          onClick={() =>
            edit(
              (d) =>
                toggleLock(
                  d,
                  parts.map((p) => p.part),
                ),
              locked ? "Unlock the parts" : "Lock the parts",
            )
          }
        />
      </fieldset>
    );
  }

  if (tracks.length) {
    const first = tracks[0]!;
    const width = tracks.every((t) => t.width === first.width) ? first.width : null;
    const one = tracks.length === 1;
    return (
      <fieldset className="bc-ec-set" disabled={readOnly}>
        <NumberField
          label="Width"
          value={width}
          min={0.05}
          max={10}
          step={0.05}
          precision={3}
          onCommit={(v) =>
            edit(
              (d) =>
                setTrackWidth(
                  d,
                  tracks.map((t) => t.id),
                  v,
                ),
              "Change the track width",
              "ec-track-width",
            )
          }
        />
        {one && (
          <dl className="bc-facts">
            <dt>Net</dt>
            <dd>{first.net || "None"}</dd>
            <dt>Layer</dt>
            <dd>{first.layer === "top" ? "Top copper" : "Bottom copper"}</dd>
            <dt>Length</dt>
            <dd>{round(trackLength(first.pts))} mm</dd>
          </dl>
        )}
        {one && first.net && (
          <Button
            size="dense"
            variant="secondary"
            icon="trash"
            label={`Unroute ${first.net}`}
            title="Delete every track and via on this net"
            onClick={() => {
              edit((d) => ripUpNet(d, first.net), "Unroute a net");
              eui.set({ selected: [] });
            }}
          />
        )}
      </fieldset>
    );
  }

  if (via)
    return (
      <fieldset className="bc-ec-set" disabled={readOnly}>
        <div className="bc-ec-set-row">
          <NumberField
            label="Size"
            value={via.diameter}
            min={0.2}
            max={10}
            step={0.05}
            precision={3}
            onCommit={(v) => edit((d) => setVia(d, via.id, { diameter: v }), "Change the via", "ec-via-d")}
          />
          <NumberField
            label="Hole"
            value={via.drill}
            min={0.1}
            max={6}
            step={0.05}
            precision={3}
            onCommit={(v) => edit((d) => setVia(d, via.id, { drill: v }), "Change the via", "ec-via-h")}
          />
        </div>
        <dl className="bc-facts">
          <dt>Net</dt>
          <dd>{via.net || "None"}</dd>
        </dl>
      </fieldset>
    );

  if (hole) {
    const screw = SCREWS.find((s) => s.drill === hole.drill);
    return (
      <fieldset className="bc-ec-set" disabled={readOnly}>
        <label className="bc-field-label" htmlFor={`${ids}w`}>
          Screw
        </label>
        <select
          id={`${ids}w`}
          className="bc-select"
          value={screw?.name ?? ""}
          onChange={(e) => {
            const s = SCREWS.find((x) => x.name === e.target.value);
            if (s) edit((d) => setHole(d, hole.id, { drill: s.drill, pad: hole.pad ? s.pad : undefined }), "Change the hole");
          }}
        >
          {!screw && <option value="">Your own size</option>}
          {SCREWS.map((s) => (
            <option key={s.name} value={s.name}>
              {s.name}, {s.drill} mm hole
            </option>
          ))}
        </select>
        <NumberField
          label="Hole"
          value={hole.drill}
          min={0.3}
          max={20}
          step={0.1}
          onCommit={(v) => edit((d) => setHole(d, hole.id, { drill: v }), "Change the hole", "ec-hole-d")}
        />
        <label className="bc-ec-fitted">
          <input
            type="checkbox"
            checked={!!hole.pad}
            onChange={(e) => edit((d) => setHole(d, hole.id, { pad: e.target.checked ? (screw?.pad ?? round(hole.drill * 2)) : null }), "Change the hole")}
          />
          Copper ring
        </label>
        {hole.pad && (
          <NumberField
            label="Ring size"
            value={hole.pad}
            min={hole.drill}
            max={40}
            step={0.1}
            onCommit={(v) => edit((d) => setHole(d, hole.id, { pad: v }), "Change the hole", "ec-hole-p")}
          />
        )}
      </fieldset>
    );
  }

  if (text) {
    const change = (c: Parameters<typeof setText>[2], label: string) =>
      edit((d) => setText(d, text.id, c), label, `ec-text-${text.id}-${Object.keys(c).join()}`);
    return (
      <fieldset className="bc-ec-set" disabled={readOnly}>
        <label className="bc-field-label" htmlFor={`${ids}t`}>
          Text
        </label>
        <input id={`${ids}t`} className="bc-text" value={text.text} onChange={(e) => e.target.value && change({ text: e.target.value }, "Change the text")} />
        <div className="bc-ec-set-row">
          <NumberField label="Height" value={text.size} min={0.5} max={20} step={0.1} onCommit={(v) => change({ size: v }, "Change the text")} />
          <NumberField label="Turn" unit="°" value={text.angle ?? 0} step={45} onCommit={(v) => change({ angle: ((v % 360) + 360) % 360 }, "Turn the text")} />
        </div>
        <label className="bc-field-label" htmlFor={`${ids}l`}>
          Side
        </label>
        <select
          id={`${ids}l`}
          className="bc-select"
          value={text.layer}
          onChange={(e) => change({ layer: e.target.value as typeof text.layer }, "Move the text")}
        >
          <option value="silk-top">Top silkscreen</option>
          <option value="silk-bottom">Bottom silkscreen</option>
        </select>
      </fieldset>
    );
  }

  return <p className="bc-note">{selected.length > 1 ? "Drag to move them together." : "Select a part, a track or a hole to change it."}</p>;
}
