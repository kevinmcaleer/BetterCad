import { useId, useMemo, useState } from "react";
import { netlist, type ElectronicsDesign, type PointKind, type SchGroup } from "@bettercad/electronics";
import { blockFromGroup, markAsBlock, pointChoices, type PointChoice } from "@bettercad/electronics/ownBlocks";
import { Button } from "@bettercad/ui";
import { useAccount } from "../cloud/account";
import type { EEdit } from "./actions";
import { useMyLibrary } from "./myLibrary";
import { KIND_TEXT } from "./pointKinds";

const KINDS = Object.keys(KIND_TEXT) as PointKind[];

/**
 * Save as block (#772): name it, say what it does, and tick the nets that are its connection points, with what each
 * one is. It goes on Your blocks, and the group becomes a placed copy of it. Saving a block of your own again makes
 * a new version.
 */
export default function SaveBlock({ design, sheet, group, edit }: { design: ElectronicsDesign; sheet: string; group: SchGroup; edit: EEdit }) {
  const ids = useId();
  const { api, account } = useAccount();
  const my = useMyLibrary(api, !!account);
  const mine = my.blocks.find((b) => b.spec.id === group.block?.def);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(mine?.spec.name ?? group.name);
  const [summary, setSummary] = useState(mine?.spec.summary ?? "");
  const nl = useMemo(() => netlist(design), [design]);
  const [points, setPoints] = useState<PointChoice[]>(() => pointChoices(design, sheet, group.id, nl));
  const [said, setSaid] = useState("");
  const change = (i: number, c: Partial<PointChoice>) => setPoints((ps) => ps.map((p, j) => (j === i ? { ...p, ...c } : p)));

  if (!open)
    return (
      <>
        <Button
          size="dense"
          variant="secondary"
          label={mine ? "Save a new version" : "Save as block"}
          title="Keep this group on Your blocks, to place again in any design"
          onClick={() => {
            setPoints(pointChoices(design, sheet, group.id, nl));
            setOpen(true);
          }}
        />
        {said && (
          <p className="bc-note" role="status">
            {said}
          </p>
        )}
      </>
    );
  const save = () => {
    const own = blockFromGroup(
      design,
      sheet,
      group.id,
      { name, summary, points: points.filter((p) => p.pick), ...(mine ? { id: mine.spec.id, version: mine.spec.version + 1 } : {}) },
      nl,
    );
    if (!own) return setSaid("This group has no parts to save.");
    my.saveBlock(own);
    edit((d) => markAsBlock(d, sheet, group.id, own), mine ? "Save a new version of the block" : "Save as block");
    setOpen(false);
    setSaid(`${own.spec.name} is on Your blocks${mine ? `, version ${own.spec.version}` : ""}.`);
  };
  return (
    <form
      className="bc-ec-save-block"
      aria-label="Save as block"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <label className="bc-field-label" htmlFor={`${ids}n`}>
        Name
      </label>
      <input id={`${ids}n`} className="bc-text" value={name} onChange={(e) => setName(e.target.value)} required />
      <label className="bc-field-label" htmlFor={`${ids}s`}>
        What it does
      </label>
      <input id={`${ids}s`} className="bc-text" value={summary} placeholder="Drives two small motors from 6 V" onChange={(e) => setSummary(e.target.value)} />
      <fieldset className="bc-ec-set">
        <legend>Connection points</legend>
        {points.length === 0 && (
          <p className="bc-note">Nothing leaves this group yet. Wire it to the rest of the circuit, or add a label, to give it points.</p>
        )}
        {points.map((p, i) => (
          <div key={p.net} className="bc-ec-save-point">
            <label className="bc-ec-fitted">
              <input type="checkbox" checked={p.pick} onChange={(e) => change(i, { pick: e.target.checked })} />
              {p.name}
            </label>
            <select
              className="bc-select"
              aria-label={`What ${p.name} is`}
              value={p.kind}
              disabled={!p.pick}
              onChange={(e) => change(i, { kind: e.target.value as PointKind })}
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_TEXT[k]}
                </option>
              ))}
            </select>
            <input
              className="bc-text"
              aria-label={`Volts for ${p.name}`}
              placeholder="Volts"
              value={p.volts ?? ""}
              disabled={!p.pick}
              onChange={(e) => change(i, { volts: e.target.value })}
            />
          </div>
        ))}
      </fieldset>
      <div className="bc-ec-library-tools">
        <Button size="dense" variant="primary" label={mine ? "Save version" : "Save block"} disabled={!name.trim()} onClick={save} />
        <Button size="dense" variant="secondary" label="Cancel" onClick={() => setOpen(false)} />
      </div>
    </form>
  );
}
