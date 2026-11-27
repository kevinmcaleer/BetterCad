import { useMemo, useState } from "react";
import { netlist, type ElectronicsDesign } from "@bettercad/electronics";
import { MATCH_TOLERANCE, groupOf, matchLengths, pairSkew, unmatch } from "@bettercad/electronics/pcb/match";
import { Button, NumberField } from "@bettercad/ui";
import type { EEdit } from "./actions";

/**
 * Length matching in the inspector (#745), for the tracks picked. Tracks on several nets can be matched to the
 * longest of them; a track on one half of a pair shows the pair's skew and can match its pair. Loaded when a track is
 * picked.
 */
export default function LengthMatch({ design, edit, nets }: { design: ElectronicsDesign; edit: EEdit; nets: string[] }) {
  const [tolerance, setTolerance] = useState(MATCH_TOLERANCE);
  const [said, setSaid] = useState("");
  const all = useMemo(() => netlist(design).nets.map((n) => n.name), [design]);
  const names = [...new Set(nets.filter(Boolean))];
  const one = names.length === 1 ? names[0]! : null;
  const pair = one ? pairSkew(design, one, all) : null;
  const group = one ? groupOf(design, one) : undefined;
  const toMatch = one ? (pair ? [one, pair.mate] : []) : names;
  if (!toMatch.length && !group) return null;
  const go = () => {
    const out = matchLengths(design, toMatch, tolerance);
    const stuck = out.results.filter((r) => r.why);
    setSaid(stuck.length ? stuck.map((r) => `${r.net}: ${r.why}`).join(" ") : `All ${toMatch.length} are within ${tolerance} mm of ${out.target} mm.`);
    edit((d) => matchLengths(d, toMatch, tolerance).design, "Match lengths");
  };
  return (
    <fieldset className="bc-ec-set">
      <legend>Length matching</legend>
      {pair && (
        <dl className="bc-facts">
          <dt>{one}</dt>
          <dd>{pair.mine} mm</dd>
          <dt>{pair.mate}</dt>
          <dd>{pair.theirs} mm</dd>
          <dt>Skew</dt>
          <dd>{pair.skew} mm</dd>
        </dl>
      )}
      {group && (
        <p className="bc-note">
          Matched with {group.nets.filter((n) => n !== one).join(", ") || "its group"} to within {group.tolerance} mm.
        </p>
      )}
      {toMatch.length > 1 && (
        <div className="bc-ec-set-row">
          <NumberField label="Tolerance" unit="mm" value={tolerance} min={0.01} max={10} step={0.05} precision={2} onCommit={setTolerance} />
          <Button
            size="dense"
            variant="secondary"
            label={one ? "Match the pair" : `Match ${toMatch.length} lengths`}
            title="Add wiggles so each net is as long as the longest"
            onClick={go}
          />
        </div>
      )}
      {group && one && <Button size="dense" variant="secondary" label="Stop matching" onClick={() => edit((d) => unmatch(d, one), "Stop matching lengths")} />}
      {said && (
        <p className="bc-note" role="status">
          {said}
        </p>
      )}
    </fieldset>
  );
}
