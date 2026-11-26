import { useId, useState } from "react";
import { boardPads, netlist, type CopperLayer, type ElectronicsDesign, type Keepout, type Side, type ViaMask } from "@bettercad/electronics";
import { layerName, layerShort, layersOf, setViaSpan, viaKind, viaLayers, viaOpen } from "@bettercad/electronics/pcb/stack";
import { netLength, tuneLength } from "@bettercad/electronics/pcb/shove";
import { swapGroups, swapPins } from "@bettercad/electronics/swap";
import { invertInk, setPicture } from "@bettercad/electronics/pcb/picture";
import { setMark } from "@bettercad/electronics/pcb/marks";
import { pourFill, setKeepout, setPadJoin, setPour } from "@bettercad/electronics/pcb/pour";
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
import NetProps from "./NetProps";
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
 * How each pad joins a pour on its net (#641), for the pads that are on a net with a pour. A pad left alone joins the
 * way its pour says.
 */
/** A net's length, and a field to make it longer with wiggles in the picked track (#646). */
function TuneLength({ design, edit, id, net }: { design: ElectronicsDesign; edit: EEdit; id: string; net: string }) {
  const [said, setSaid] = useState("");
  const now = round(netLength(design, net));
  return (
    <>
      <NumberField
        label="Net length"
        value={now}
        min={0}
        step={1}
        precision={2}
        onCommit={(v) => {
          const out = tuneLength(design, id, v);
          setSaid("why" in out ? out.why : "");
          if ("design" in out)
            edit((d) => {
              const again = tuneLength(d, id, v);
              return "design" in again ? again.design : d;
            }, "Tune a net's length");
        }}
      />
      <p className="bc-note" role="status">
        {said || "Type a longer length to add wiggles to this track."}
      </p>
    </>
  );
}

function PadJoins({ design, edit, part }: { design: ElectronicsDesign; edit: EEdit; part: string }) {
  const board = design.board!;
  const poured = new Set(board.pours.map((p) => p.net));
  const at = board.placements.find((p) => p.part === part);
  if (!at || !poured.size) return null;
  const pads = [
    ...new Set(
      boardPads(design)
        .filter((p) => p.part === part && p.net && poured.has(p.net) && p.pad.number)
        .map((p) => p.pad.number),
    ),
  ];
  if (!pads.length) return null;
  return (
    <>
      {pads.map((n) => (
        <label key={n} className="bc-ec-set-row">
          Pad {n} joins its pour
          <select
            className="bc-select"
            value={at.joins?.[n] ?? ""}
            onChange={(e) =>
              edit((d) => setPadJoin(d, part, n, (e.target.value || undefined) as "spokes" | "solid" | undefined), `Change how pad ${n} joins its pour`)
            }
          >
            <option value="">As the pour says</option>
            <option value="spokes">With spokes</option>
            <option value="solid">All round</option>
          </select>
        </label>
      ))}
    </>
  );
}

/**
 * Pin swap (#645): offered only for pins the component says do the same job. The schematic follows in the same step.
 */
function SwapPins({ design, edit, part }: { design: ElectronicsDesign; edit: EEdit; part: string }) {
  const groups = swapGroups(design, part);
  const ref = design.parts.find((p) => p.id === part)?.ref ?? "";
  const [pair, setPair] = useState("");
  if (!groups.length) return null;
  const pairs = groups.flatMap((g) => g.flatMap((a, i) => g.slice(i + 1).map((b) => `${a}/${b}`)));
  const [a, b] = (pairs.includes(pair) ? pair : pairs[0]!).split("/") as [string, string];
  const go = () => edit((d) => swapPins(d, part, a, b), `Swap pins ${a} and ${b} of ${ref}`);
  const title = "The two pads take each other's nets, and the schematic follows";
  if (pairs.length === 1) return <Button size="dense" variant="secondary" label={`Swap pins ${a} and ${b}`} title={title} onClick={go} />;
  return (
    <div className="bc-ec-set-row">
      <select className="bc-select" aria-label="Pins to swap" value={`${a}/${b}`} onChange={(e) => setPair(e.target.value)}>
        {pairs.map((p) => (
          <option key={p} value={p}>
            {p.replace("/", " and ")}
          </option>
        ))}
      </select>
      <Button size="dense" variant="secondary" label="Swap pins" title={title} onClick={go} />
    </div>
  );
}

/** Stitching vias (#737): fills the pour with vias to its net's pour on the other side. The sums load when asked. */
function Stitching({ design, edit, pour }: { design: ElectronicsDesign; edit: EEdit; pour: string }) {
  const [spacing, setSpacing] = useState(5);
  const [said, setSaid] = useState("");
  const add = async () => {
    const { addStitching } = await import("@bettercad/electronics/pcb/stitch");
    const made = addStitching(design, pour, spacing);
    if (!made.added) return setSaid(made.why ?? "There is no room for a via.");
    edit(() => made.design, "Add stitching vias");
    setSaid(`Added ${made.added} ${made.added === 1 ? "via" : "vias"}. Undo takes them all out.`);
  };
  return (
    <>
      <div className="bc-ec-set-row">
        <NumberField label="Via spacing" value={spacing} min={1} max={50} step={0.5} onCommit={setSpacing} />
        <Button
          size="dense"
          variant="secondary"
          label="Add stitching vias"
          title="Join this pour to its net's pour on the other side with vias"
          onClick={add}
        />
      </div>
      {said && (
        <p className="bc-note" role="status">
          {said}
        </p>
      )}
    </>
  );
}

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
        <label className="bc-ec-fitted">
          <input
            type="checkbox"
            checked={!at.refHidden}
            onChange={({ target: { checked } }) => set({ refHidden: !checked }, checked ? "Show the name" : "Hide the name")}
          />
          Name on the silkscreen
        </label>
        <SwapPins design={design} edit={edit} part={part} />
        <PadJoins design={design} edit={edit} part={part} />
      </fieldset>
    );
  }

  const set = new Set(selected);
  const parts = board.placements.filter((p) => set.has(p.part));
  const tracks = board.tracks.filter((t) => set.has(t.id));
  const via = selected.length === 1 ? board.vias.find((v) => set.has(v.id)) : undefined;
  const hole = selected.length === 1 ? board.holes.find((h) => set.has(h.id)) : undefined;
  const text = selected.length === 1 ? board.texts.find((t) => set.has(t.id)) : undefined;
  const mark = selected.length === 1 ? board.marks?.find((m) => set.has(m.id)) : undefined;

  const picture = selected.length === 1 ? board.pictures?.find((x) => set.has(x.id)) : undefined;
  const pour = selected.length === 1 ? board.pours.find((x) => set.has(x.id)) : undefined;
  const keepout = selected.length === 1 ? board.keepouts.find((x) => set.has(x.id)) : undefined;

  if (pour) {
    const nets = [
      ...new Set([
        pour.net,
        ...netlist(design)
          .nets.filter((n) => n.pins.length > 0)
          .map((n) => n.name),
      ]),
    ].sort();
    const area = round(pourFill(design, pour).area);
    const change = (c: Parameters<typeof setPour>[2], label: string) =>
      edit((d) => setPour(d, pour.id, c), label, `ec-pour-${pour.id}-${Object.keys(c).join()}`);
    return (
      <fieldset className="bc-ec-set" disabled={readOnly}>
        <legend>Pour</legend>
        <label className="bc-field-label" htmlFor={`${ids}n`}>
          Net
        </label>
        <select id={`${ids}n`} className="bc-select" value={pour.net} onChange={({ target: { value } }) => change({ net: value }, "Change the pour's net")}>
          {nets.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <label className="bc-field-label" htmlFor={`${ids}y`}>
          {layersOf(board).length > 2 ? "Layer" : "Side"}
        </label>
        <select
          id={`${ids}y`}
          className="bc-select"
          value={pour.layer}
          onChange={({ target: { value } }) => change({ layer: value as CopperLayer }, "Move the pour")}
        >
          {layersOf(board).map((l) => (
            <option key={l} value={l}>
              {layerName(l)}
            </option>
          ))}
        </select>
        <label className="bc-ec-fitted" data-tip="Spokes make its pads easier to solder. Off, the copper runs right up to them">
          <input
            type="checkbox"
            checked={pour.thermal !== false}
            onChange={({ target: { checked } }) => change({ thermal: checked }, checked ? "Join pads with spokes" : "Join pads all round")}
          />
          Join pads with spokes
        </label>
        <label className="bc-field-label" htmlFor={`${ids}o`}>
          Where pours overlap
        </label>
        <select
          id={`${ids}o`}
          className="bc-select"
          value={Math.min(2, pour.priority ?? 0)}
          onChange={({ target: { value } }) => change({ priority: Number(value) }, "Change which pour fills first")}
        >
          <option value={0}>Fills in turn</option>
          <option value={1}>Fills before the others</option>
          <option value={2}>Fills first of all</option>
        </select>
        <dl className="bc-facts">
          <dt>Copper</dt>
          <dd>{area} mm²</dd>
        </dl>
        <Stitching design={design} edit={edit} pour={pour.id} />
      </fieldset>
    );
  }

  if (keepout) {
    const tick = (what: keyof Pick<Keepout, "tracks" | "pours" | "parts">, label: string) => (
      <label className="bc-ec-fitted">
        <input
          type="checkbox"
          checked={!!keepout[what]}
          onChange={({ target: { checked } }) => edit((d) => setKeepout(d, keepout.id, { [what]: checked }), "Change the keep-out")}
        />
        {label}
      </label>
    );
    return (
      <fieldset className="bc-ec-set" disabled={readOnly}>
        <legend>Keeps out</legend>
        {tick("tracks", "Tracks and vias")}
        {tick("pours", "Pours")}
        {tick("parts", "Parts")}
      </fieldset>
    );
  }

  if (selected.length === 1 && selected[0]!.startsWith("cut:"))
    return <p className="bc-note">A hole cut through the board. Copper keeps back from its edge. Delete it to fill it in.</p>;

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
    const net = tracks.every((t) => t.net === first.net) ? first.net : "";
    return (
      <>
        <fieldset className="bc-ec-set" disabled={readOnly}>
          <legend>{one ? "Track" : `${tracks.length} tracks`}</legend>
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
              <dt>Layer</dt>
              <dd>{layerName(first.layer)}</dd>
              <dt>Length</dt>
              <dd>{round(trackLength(first.pts))} mm</dd>
            </dl>
          )}
          {one && first.net && <TuneLength design={design} edit={edit} id={first.id} net={first.net} />}
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
        {net ? (
          <NetProps design={design} edit={edit} net={net} readOnly={readOnly} />
        ) : (
          <p className="bc-note">{first.net ? "These tracks are on different nets." : "Not on a net."}</p>
        )}
      </>
    );
  }

  if (via)
    return (
      <>
        <fieldset className="bc-ec-set" disabled={readOnly}>
          <legend>Via</legend>
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
          <label className="bc-field-label" htmlFor={`${ids}vm`}>
            Mask
          </label>
          <select
            id={`${ids}vm`}
            className="bc-select"
            value={viaOpen(board, via) ? "open" : "covered"}
            data-tip="Board setup says what vias are; this one can differ"
            onChange={({ target: { value } }) => edit((d) => setVia(d, via.id, { mask: value as ViaMask }), "Change the via's mask")}
          >
            <option value="covered">Covered{(board.viaMask ?? "covered") === "covered" ? ", like the board" : ""}</option>
            <option value="open">Open{board.viaMask === "open" ? ", like the board" : ""}</option>
          </select>
          {layersOf(board).length > 2 && (
            <>
              <label className="bc-field-label" htmlFor={`${ids}vs`}>
                Joins
              </label>
              <select
                id={`${ids}vs`}
                className="bc-select"
                value={
                  viaKind(board, via) === "through"
                    ? ""
                    : viaLayers(board, via)
                        .filter((_, i, on) => i === 0 || i === on.length - 1)
                        .join()
                }
                data-tip="A via that stops part of the way costs more to make"
                onChange={({ target: { value } }) =>
                  edit((d) => setViaSpan(d, via.id, value ? (value.split(",") as [CopperLayer, CopperLayer]) : undefined), "Change the layers a via joins")
                }
              >
                <option value="">Every layer</option>
                {layersOf(board).flatMap((a, i, all) =>
                  all.slice(i + 1).flatMap((b, k) =>
                    i === 0 && k === all.length - 2
                      ? []
                      : [
                          <option key={`${a},${b}`} value={`${a},${b}`}>
                            {layerShort(a)} to {layerShort(b)}
                          </option>,
                        ],
                  ),
                )}
              </select>
            </>
          )}
        </fieldset>
        {via.net ? <NetProps design={design} edit={edit} net={via.net} readOnly={readOnly} /> : <p className="bc-note">Not on a net.</p>}
      </>
    );

  if (picture) {
    const change = (c: Parameters<typeof setPicture>[2], label: string) =>
      edit((d) => setPicture(d, picture.id, c), label, `ec-picture-${picture.id}-${Object.keys(c).join()}`);
    const cell = picture.w / picture.cols;
    return (
      <fieldset className="bc-ec-set" disabled={readOnly}>
        <legend>Picture</legend>
        <div className="bc-ec-set-row">
          <NumberField label="Width" value={round(picture.w)} min={1} max={300} step={1} onCommit={(v) => change({ w: v }, "Change the picture's size")} />
          <NumberField label="Height" value={round(cell * picture.rows)} locked onCommit={() => undefined} />
        </div>
        <label className="bc-field-label" htmlFor={`${ids}pl`}>
          Side
        </label>
        <select
          id={`${ids}pl`}
          className="bc-select"
          value={picture.layer}
          onChange={(e) => change({ layer: e.target.value as typeof picture.layer }, "Move the picture")}
        >
          <option value="silk-top">Top silkscreen</option>
          <option value="silk-bottom">Bottom silkscreen</option>
        </select>
        <Button
          size="dense"
          variant="secondary"
          label="Swap ink and bare board"
          title="For a light logo drawn on a dark ground"
          onClick={() => change({ bits: invertInk(picture).bits }, "Swap the picture's ink")}
        />
        {cell < board.rules.minSilkWidth - 1e-6 && (
          <p className="bc-note">
            Its finest detail is {round(cell)} mm. Lines thinner than {board.rules.minSilkWidth} mm may not print: make it wider.
          </p>
        )}
      </fieldset>
    );
  }

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
            onChange={({ target: { checked } }) =>
              edit((d) => setHole(d, hole.id, { pad: checked ? (screw?.pad ?? round(hole.drill * 2)) : null }), "Change the hole")
            }
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

  if (mark) {
    const fid = mark.kind === "fiducial";
    const change = (c: Parameters<typeof setMark>[2], label: string) =>
      edit((d) => setMark(d, mark.id, c), label, `ec-mark-${mark.id}-${Object.keys(c).join()}`);
    const nets = fid
      ? []
      : [
          ...new Set([
            ...(mark.net ? [mark.net] : []),
            ...netlist(design)
              .nets.filter((n) => n.pins.length > 0)
              .map((n) => n.name),
          ]),
        ].sort();
    return (
      <fieldset className="bc-ec-set" disabled={readOnly}>
        <legend>
          {fid ? "Fiducial" : "Test point"} {mark.ref}
        </legend>
        <NumberField
          label={fid ? "Dot" : "Pad"}
          value={mark.size}
          min={0.5}
          max={3}
          step={0.1}
          onCommit={(v) => change({ size: v }, fid ? "Change the fiducial" : "Change the test point")}
        />
        <label className="bc-field-label" htmlFor={`${ids}ms`}>
          Side
        </label>
        <select id={`${ids}ms`} className="bc-select" value={mark.side} onChange={(e) => change({ side: e.target.value as Side }, "Move to the other side")}>
          <option value="top">Top</option>
          <option value="bottom">Bottom</option>
        </select>
        {!fid && (
          <>
            <label className="bc-field-label" htmlFor={`${ids}mn`}>
              Net
            </label>
            <select
              id={`${ids}mn`}
              className="bc-select"
              value={mark.net ?? ""}
              onChange={(e) => change({ net: e.target.value }, "Change the test point's net")}
            >
              <option value="">No net</option>
              {nets.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </>
        )}
        <p className="bc-note">
          {fid
            ? `A ${mark.size} mm copper dot in a ${mark.size * 2} mm clear ring, with no paste. Put three near the corners so the camera can square the board.`
            : "A round pad with no paste, for a meter's probe. Route a track to it like any pad."}
        </p>
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
          <option value="copper-top">Top copper</option>
          <option value="copper-bottom">Bottom copper</option>
        </select>
        {text.layer.startsWith("copper") && <p className="bc-note">Copper text is copper on no net. Tracks and pours keep clear of it.</p>}
      </fieldset>
    );
  }

  return <p className="bc-note">{selected.length > 1 ? "Drag to move them together." : "Select a part, a track, a hole or a fiducial to change it."}</p>;
}
