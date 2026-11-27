import { useEffect, useRef, type KeyboardEvent } from "react";
import { pinKey, type ComponentDef, type Netlist, type Part } from "@bettercad/electronics";
import { setPinNet } from "@bettercad/electronics/netName";
import type { EEdit } from "./actions";
import { useEui } from "./useEui";

/**
 * A part's pins in the inspector, each with the name of the net it is on, changed in place (Kev, 2026-11-27). A new
 * name renames the whole net, labels, power symbols and copper too; a pin on no net gets a label of that name.
 * Double-clicking a pin on the schematic or a pad on the board opens its field.
 */
export default function PinNets({ part, def, nl, edit, readOnly }: { part: Part; def: ComponentDef; nl: Netlist; edit: EEdit; readOnly?: boolean }) {
  const ui = useEui();
  const list = useRef<HTMLDListElement>(null);
  // A double-clicked pin: its field takes the keys.
  const want = ui.pin && ui.pin.part === part.id ? ui.pin : null;
  useEffect(() => {
    if (!want) return;
    const field = list.current?.querySelector<HTMLInputElement>(`input[data-pin="${CSS.escape(want.pin)}"]`);
    field?.scrollIntoView({ block: "nearest" });
    field?.focus();
    field?.select();
  }, [want?.n, want?.pin]); // eslint-disable-line react-hooks/exhaustive-deps

  const seen = new Set<string>();
  const pins = def.symbol.pins.filter((p) => !seen.has(p.number) && seen.add(p.number));
  return (
    <dl ref={list} className="bc-facts bc-ec-pin-nets">
      {pins.map((pin) => {
        const net = nl.of.get(pinKey(part.id, pin.number)) ?? "";
        const open = nl.noConnect.has(pinKey(part.id, pin.number));
        const name = pin.name && pin.name !== pin.number ? `${pin.number} ${pin.name}` : pin.number;
        const commit = (text: string) => {
          const to = text.trim();
          if (!to || to === net) return;
          edit((d) => setPinNet(d, part.id, pin.number, to), net ? `Rename net ${net} to ${to}` : `Join pin ${name} to ${to}`);
        };
        const keys = (e: KeyboardEvent<HTMLInputElement>) => {
          if (e.key === "Enter") e.currentTarget.blur();
          else if (e.key === "Escape") {
            // Back out of the field without the change; the next Esc backs out of the selection.
            e.preventDefault();
            e.stopPropagation();
            e.currentTarget.value = net;
            e.currentTarget.blur();
          }
        };
        return (
          <div key={pin.number} style={{ display: "contents" }}>
            <dt>{name}</dt>
            <dd>
              <input
                key={net}
                className="bc-text"
                aria-label={`Net on pin ${name}`}
                data-pin={pin.number}
                defaultValue={net}
                placeholder={open ? "Left open" : "Not connected"}
                disabled={readOnly}
                spellCheck={false}
                onKeyDown={keys}
                onBlur={(e) => commit(e.target.value)}
              />
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
