import { useState } from "react";
import type { ElectronicsDesign } from "@bettercad/electronics";
import { Icon, cx } from "@bettercad/ui";
import type { EEdit } from "./actions";
import { BoardCanvas } from "./BoardCanvas";
import { LAYERS } from "./drawBoard";
import { eui } from "./ui";
import { useEui } from "./useEui";

function LayersCard() {
  const ui = useEui();
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
    </section>
  );
}

/** The PCB view: the board and its layers card. Loaded the first time the PCB opens. */
export default function BoardView({ design, edit, readOnly }: { design: ElectronicsDesign; edit: EEdit; readOnly?: boolean }) {
  return (
    <>
      <BoardCanvas design={design} edit={edit} readOnly={readOnly} />
      {design.board && <LayersCard />}
    </>
  );
}
