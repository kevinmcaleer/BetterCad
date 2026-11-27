import { useState } from "react";
import type { ElectronicsDesign } from "@bettercad/electronics";
import { Icon, cx } from "@bettercad/ui";
import type { EEdit } from "./actions";
import { BoardCanvas } from "./BoardCanvas";
import { layersFor } from "./drawBoard";
import { PICK_KINDS } from "./hitBoard";
import { BOARD_GRIDS, eui } from "./ui";
import { useEui } from "./useEui";

function LayersCard({ board }: { board: { copperLayers: number } }) {
  const ui = useEui();
  const LAYERS = layersFor(board);
  const [open, setOpen] = useState(false);
  const hidden = new Set(ui.hidden);
  const active = LAYERS.find((l) => l.copper === ui.layer) ?? LAYERS[0]!;
  return (
    <section className={cx("bc-ec-layers", open && "bc-open")} aria-label="Layers">
      <button type="button" className="bc-ec-layers-chip" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="bc-ec-swatch" style={{ background: `var(--bc-color-${active.colour})` }} />
        {active.label}
        <Icon name="chevronDown" size={14} />
      </button>
      <h2 className="bc-ec-layers-title">Layers</h2>
      <ul>
        {LAYERS.map((l) => (
          <li key={l.id} className={cx(l.copper === ui.layer && "bc-on")}>
            <button
              type="button"
              className="bc-ec-layer"
              aria-pressed={l.copper ? l.copper === ui.layer : undefined}
              disabled={!l.copper}
              data-tip={l.copper ? `Work on ${l.label.toLowerCase()}` : undefined}
              onClick={() => l.copper && eui.set({ layer: l.copper })}
            >
              <span className="bc-ec-swatch" style={{ background: `var(--bc-color-${l.colour})` }} />
              {l.label}
            </button>
            <button
              type="button"
              className="bc-ec-eye"
              aria-pressed={!hidden.has(l.id)}
              aria-label={`Show ${l.label.toLowerCase()}`}
              onClick={() => eui.set({ hidden: hidden.has(l.id) ? ui.hidden.filter((x) => x !== l.id) : [...ui.hidden, l.id] })}
            >
              <Icon name={hidden.has(l.id) ? "eyeOff" : "eye"} size={16} />
            </button>
          </li>
        ))}
      </ul>
      <label className="bc-ec-grid">
        Grid
        <select className="bc-select" value={ui.grid} onChange={(e) => eui.set({ grid: Number(e.target.value) })}>
          {BOARD_GRIDS.map((g) => (
            <option key={g} value={g}>
              {g} mm
            </option>
          ))}
        </select>
      </label>
      <label className="bc-ec-fitted bc-ec-outlines" data-tip="Draw pours as their edges only, so tracks and pads under them show">
        <input type="checkbox" checked={ui.pourOutlines} onChange={(e) => eui.set({ pourOutlines: e.target.checked })} />
        Pours as outlines
      </label>
      <fieldset className="bc-ec-pick" data-tip="What a click or a drag box picks on the board">
        <legend>Pick</legend>
        {PICK_KINDS.map(([kind, name]) => (
          <label key={kind}>
            <input
              type="checkbox"
              checked={!ui.pick.off.includes(kind)}
              onChange={(e) =>
                eui.set({ pick: { ...ui.pick, off: e.target.checked ? ui.pick.off.filter((k) => k !== kind) : [...ui.pick.off, kind] }, selected: [] })
              }
            />
            {name}
          </label>
        ))}
        <label>
          <input
            type="checkbox"
            checked={!ui.pick.skipLocked}
            onChange={(e) => eui.set({ pick: { ...ui.pick, skipLocked: !e.target.checked }, selected: [] })}
          />
          Locked parts
        </label>
      </fieldset>
    </section>
  );
}

/** The PCB view: the board and its layers card. Loaded the first time the PCB opens. */
export default function BoardView({ design, edit, readOnly }: { design: ElectronicsDesign; edit: EEdit; readOnly?: boolean }) {
  return (
    <>
      <BoardCanvas design={design} edit={edit} readOnly={readOnly} />
      {design.board && <LayersCard board={design.board} />}
    </>
  );
}
