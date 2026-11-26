import { PIN_TYPES, type ElectronicsDesign, type PinType } from "@bettercad/electronics";
import { pinMeet, resetPinMeets, setPinMeet, type PinMeet } from "@bettercad/electronics/erc";
import { Button, cx } from "@bettercad/ui";
import type { EEdit } from "./actions";

/** Short names for the table's columns; the full name is in each cell's label and the column's title. */
const SHORT: Record<PinType, string> = {
  input: "In",
  output: "Out",
  bidirectional: "I/O",
  tristate: "3S",
  passive: "Pas",
  power_in: "PIn",
  power_out: "POut",
  open_collector: "OC",
  open_emitter: "OE",
  unspecified: "?",
  no_connect: "NC",
};
const NEXT: Record<PinMeet, PinMeet> = { ok: "warning", warning: "error", error: "ok" };
const SAY: Record<PinMeet, string> = { ok: "fine", warning: "a warning", error: "an error" };
const MARK: Record<PinMeet, string> = { ok: "·", warning: "W", error: "E" };

/**
 * The pin table (#738): which pin types may share a net, as KiCad's table has it. Click a cell to step it from fine to
 * a warning to an error. Changes are kept with the model; Reset puts the table back.
 */
export function PinTable({ design, edit, readOnly }: { design: ElectronicsDesign; edit: EEdit; readOnly?: boolean }) {
  const changed = !!design.checks?.pins && Object.keys(design.checks.pins).length > 0;
  return (
    <div className="bc-ec-pins">
      <table aria-label="Pin types that meet">
        <thead>
          <tr>
            <td />
            {PIN_TYPES.map((t) => (
              <th key={t.id} scope="col" title={t.label}>
                {SHORT[t.id]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {PIN_TYPES.map((row, i) => (
            <tr key={row.id}>
              <th scope="row">{row.label}</th>
              {PIN_TYPES.map((col, j) => {
                if (j > i) return <td key={col.id} />;
                const meet = pinMeet(design, row.id, col.id);
                return (
                  <td key={col.id}>
                    <button
                      type="button"
                      className={cx("bc-ec-pin-cell", `bc-ec-pin-${meet}`)}
                      aria-label={`${row.label} with ${col.label.toLowerCase()}: ${SAY[meet]}`}
                      title={`${row.label} with ${col.label.toLowerCase()}: ${SAY[meet]}. Click to change`}
                      disabled={readOnly}
                      onClick={() => edit((d) => setPinMeet(d, row.id, col.id, NEXT[meet]), "Change the pin table")}
                    >
                      {MARK[meet]}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="bc-note">
        · fine, W a warning, E an error.{" "}
        {changed && (
          <Button
            size="dense"
            variant="secondary"
            label="Reset"
            title="Put the table back as it came"
            disabled={readOnly}
            onClick={() => edit(resetPinMeets, "Reset the pin table")}
          />
        )}
      </p>
    </div>
  );
}
