import { useId, useMemo } from "react";
import { netlist, type ElectronicsDesign, type NetColour } from "@bettercad/electronics";
import { netRules } from "@bettercad/electronics/pcb/copper";
import { NET_COLOURS, addNetClass, changeNetClass, classOf, netFacts, setNetClass, setNetLook, setNetWidth } from "@bettercad/electronics/pcb/netclass";
import { layerShort, layersOf } from "@bettercad/electronics/pcb/stack";
import { renameNet } from "@bettercad/electronics/netName";
import { Button, NumberField } from "@bettercad/ui";
import type { EEdit } from "./actions";
import { eui } from "./ui";
import { useEui } from "./useEui";

const round = (n: number) => Math.round(n * 100) / 100;
const NEW = "\u0000new";

/**
 * One net in the inspector: its class and the width its tracks are drawn at, both changed right here, and what is on
 * it. Board → Setup keeps the whole list of classes. Shown for a track, a via, a wire, a label or a power symbol.
 */
export default function NetProps({ design, edit, net, readOnly }: { design: ElectronicsDesign; edit: EEdit; net: string; readOnly?: boolean }) {
  const ids = useId();
  const ui = useEui();
  const board = design.board;
  const pins = useMemo(() => netlist(design).nets.find((n) => n.name === net)?.pins.length ?? 0, [design, net]);
  if (!net) return null;
  const k = board && classOf(board, net);
  const rules = board && netRules(board, net);
  const facts = board && netFacts(board, net, layersOf(board));
  const left = ui.view === "pcb" && ui.airs && (pins > 1 || ui.airs[net]) ? (ui.airs[net] ?? 0) : undefined;
  const mixed = facts && facts.widths.length > 1;
  const look = board?.netLooks?.[net];
  const pickClass = (value: string) => {
    if (value === NEW) edit((d) => addNetClass(d, net).design, `Put ${net} in a new class`);
    else edit((d) => setNetClass(d, net, value || null), value ? `Put ${net} in a class` : `Take ${net} out of its class`);
  };
  return (
    <fieldset className="bc-ec-set" disabled={readOnly}>
      <legend>Net {net}</legend>
      <label className="bc-field-label" htmlFor={`${ids}n`}>
        Name
      </label>
      <input
        id={`${ids}n`}
        key={net}
        className="bc-text"
        defaultValue={net}
        spellCheck={false}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            e.currentTarget.value = net;
            e.currentTarget.blur();
          }
        }}
        onBlur={(e) => {
          const to = e.target.value.trim();
          if (to && to !== net) edit((d) => renameNet(d, net, to), `Rename net ${net} to ${to}`);
        }}
      />
      {board && rules && facts ? (
        <>
          <label className="bc-field-label" htmlFor={`${ids}c`}>
            Net class
          </label>
          <select id={`${ids}c`} className="bc-select" value={k?.id ?? ""} onChange={({ target: { value } }) => pickClass(value)}>
            <option value="">None, the board's own</option>
            {board.classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
            <option value={NEW}>New class…</option>
          </select>
          {k ? (
            <>
              <div className="bc-ec-set-row">
                <NumberField
                  label={`${k.name} track width`}
                  value={k.trackWidth}
                  min={0.05}
                  max={10}
                  step={0.05}
                  precision={3}
                  onCommit={(v) => edit((d) => changeNetClass(d, k.id, { trackWidth: v }), "Change a net class", `ec-class-${k.id}-trackWidth`)}
                />
                <NumberField
                  label={`${k.name} clearance`}
                  value={k.clearance}
                  min={0.05}
                  max={10}
                  step={0.05}
                  precision={3}
                  onCommit={(v) => edit((d) => changeNetClass(d, k.id, { clearance: v }), "Change a net class", `ec-class-${k.id}-clearance`)}
                />
              </div>
              <p className="bc-note">
                {k.nets.length > 1 ? `Changes all ${k.nets.length} nets in ${k.name}. ` : ""}Tracks drawn at the old width take the new one.
              </p>
            </>
          ) : (
            facts.tracks > 0 && (
              <NumberField
                label="Width of its tracks"
                value={mixed ? null : facts.widths[0]!}
                min={0.05}
                max={10}
                step={0.05}
                precision={3}
                onCommit={(v) => edit((d) => setNetWidth(d, net, v), `Change ${net}'s track width`, `ec-net-width-${net}`)}
              />
            )
          )}
          {!k && <p className="bc-note">New tracks on it are {rules.trackWidth} mm, from Board setup. Put it in a class to give it its own width.</p>}
          {mixed && (
            <p className="bc-note">
              Its tracks are {facts.widths.join(", ")} mm wide.
              {k ? "" : " Type a width to make them all the same."}
            </p>
          )}
          <div className="bc-ec-set-row">
            <span>
              <label className="bc-field-label" htmlFor={`${ids}k`}>
                Colour
              </label>
              <select
                id={`${ids}k`}
                className="bc-select"
                value={look?.colour ?? ""}
                data-tip="Its unrouted lines, and its tracks while it is lit"
                onChange={({ target: { value } }) =>
                  edit(
                    (d) => setNetLook(d, net, { colour: (value || undefined) as NetColour | undefined }),
                    value ? `Colour ${net}` : `Take ${net}'s colour off`,
                  )
                }
              >
                <option value="">None</option>
                {NET_COLOURS.map((c) => (
                  <option key={c} value={c}>
                    {c[0]!.toUpperCase() + c.slice(1)}
                  </option>
                ))}
              </select>
            </span>
            <label className="bc-ec-fitted" data-tip="Hidden lines still count as left to route">
              <input
                type="checkbox"
                checked={!look?.hideAir}
                onChange={(e) =>
                  edit(
                    (d) => setNetLook(d, net, { hideAir: e.target.checked ? undefined : true }),
                    e.target.checked ? `Show ${net}'s unrouted lines` : `Hide ${net}'s unrouted lines`,
                  )
                }
              />
              Show unrouted lines
            </label>
          </div>
          <dl className="bc-facts">
            <dt>Pins</dt>
            <dd>{pins}</dd>
            <dt>Tracks</dt>
            <dd>{facts.tracks ? `${facts.tracks}, ${round(facts.length)} mm in all` : "None yet"}</dd>
            {facts.layers.length > 0 && (
              <>
                <dt>Layers</dt>
                <dd>{facts.layers.map(layerShort).join(", ")}</dd>
              </>
            )}
            <dt>Vias</dt>
            <dd>
              {facts.vias}, {rules.viaDiameter} mm with a {rules.viaDrill} mm hole
            </dd>
            <dt>Clearance</dt>
            <dd>{rules.clearance} mm</dd>
            {left !== undefined && (
              <>
                <dt>To route</dt>
                <dd>{left ? `${left} connection${left === 1 ? "" : "s"}` : "Done"}</dd>
              </>
            )}
          </dl>
          {ui.view === "pcb" && facts.tracks + facts.vias > 0 && (
            <Button
              size="dense"
              variant="secondary"
              label="Select all its copper"
              title={`Select every track and via on ${net}`}
              onClick={() => eui.set({ selected: [...board.tracks.filter((t) => t.net === net), ...board.vias.filter((v) => v.net === net)].map((x) => x.id) })}
            />
          )}
        </>
      ) : (
        <>
          <dl className="bc-facts">
            <dt>Pins</dt>
            <dd>{pins}</dd>
          </dl>
          <p className="bc-note">Make a board to give this net a class and a track width.</p>
        </>
      )}
    </fieldset>
  );
}
