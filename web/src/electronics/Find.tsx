import { useId, useMemo, useState } from "react";
import { netAt, netlist, type ElectronicsDesign, type Netlist } from "@bettercad/electronics";
import { findInDesign, type Found } from "@bettercad/electronics/find";
import { ESC, FeaturePanel, PanelNote, cx, useEscape } from "@bettercad/ui";
import { eui, type EView } from "./ui";

/**
 * Goes to what was found (#734): the sheet it is on, or the board, with it picked and brought into the middle. A net
 * is lit and its wires or copper picked.
 */
export function goToFound(d: ElectronicsDesign, f: Found, view: EView, nl: Netlist = netlist(d)): void {
  const ui = eui.get();
  const bump = (sheet?: string) => {
    // A sheet that was not showing mounts first; it is asked to bring the pick into view once it is up.
    if (sheet && sheet !== (ui.sheet ?? d.sheets[0]?.id)) setTimeout(() => eui.set({ focus: eui.get().focus + 1 }), 30);
    else eui.set({ focus: eui.get().focus + 1 });
  };
  if (f.kind === "group") {
    // A group is a schematic thing: its parts on the board, or its members on its sheet.
    const sheet = d.sheets.find((s) => s.id === f.sheet);
    const members = sheet?.groups?.find((g) => g.id === f.id)?.members ?? [];
    if (!sheet) return;
    if (view === "pcb") {
      const parts = new Set(sheet.symbols.filter((y) => members.includes(y.id)).map((y) => y.part));
      eui.set({ selected: (d.board?.placements ?? []).filter((p) => parts.has(p.part)).map((p) => p.part), net: null, spot: null });
      return bump();
    }
    eui.set({ sheet: sheet.id, selected: members, net: null, spot: null, inGroup: null });
    return bump(sheet.id);
  }
  if (view === "pcb") {
    const board = d.board;
    if (f.kind === "part") {
      eui.set({ selected: board?.placements.some((p) => p.part === f.id) ? [f.id] : [], net: null, spot: null });
    } else {
      const copper = [...(board?.tracks ?? []), ...(board?.vias ?? [])].filter((x) => x.net === f.name).map((x) => x.id);
      const placed = new Set(board?.placements.map((p) => p.part));
      const parts = [...new Set(nl.nets.find((n) => n.name === f.name)?.pins.map((p) => p.part) ?? [])].filter((id) => placed.has(id));
      eui.set({ selected: copper.length ? copper : parts, net: f.name, spot: null });
    }
    return bump();
  }
  if (f.kind === "part") {
    const sheet = d.sheets.find((s) => s.symbols.some((y) => y.part === f.id));
    if (!sheet) return;
    eui.set({ sheet: sheet.id, selected: sheet.symbols.filter((y) => y.part === f.id).map((y) => y.id), net: null, spot: null });
    return bump(sheet.id);
  }
  for (const sheet of d.sheets) {
    const ids = [
      ...sheet.wires.filter((w) => netAt(nl, sheet.id, w.a) === f.name).map((w) => w.id),
      ...sheet.labels.filter((l) => (netAt(nl, sheet.id, [l.x, l.y]) ?? l.name) === f.name).map((l) => l.id),
    ];
    // A net with no wire of its own on a sheet (pins that touch) still has its parts there.
    const pins = new Set(
      nl.nets
        .find((n) => n.name === f.name)
        ?.pins.filter((p) => p.sheet === sheet.id)
        .map((p) => p.part),
    );
    const symbols = ids.length ? [] : sheet.symbols.filter((y) => pins.has(y.part)).map((y) => y.id);
    if (!ids.length && !symbols.length) continue;
    eui.set({ sheet: sheet.id, selected: ids.length ? ids : symbols, net: f.name, spot: null });
    return bump(sheet.id);
  }
}

/** The find box (#734): type a reference, a value or a net's name, and choose a result to go to it. */
export default function FindCard({ design, view, onClose }: { design: ElectronicsDesign; view: EView; onClose: () => void }) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [at, setAt] = useState<string | null>(null);
  const nl = useMemo(() => netlist(design), [design]);
  const found = useMemo(() => findInDesign(design, query, nl), [design, query, nl]);
  useEscape(true, onClose, ESC.panel);
  const keyOf = (f: Found) => (f.kind === "net" ? `n:${f.name}` : `${f.kind[0]}:${f.id}`);
  const go = (f: Found) => {
    setAt(keyOf(f));
    goToFound(design, f, view, nl);
  };
  return (
    <FeaturePanel title="Find" icon="search" className="bc-ec-card bc-ec-find" cancel={{ label: "Close", title: "Close the find box (Esc)", onClick: onClose }}>
      <label className="bc-field-label" htmlFor={`${id}q`}>
        A part or a net
      </label>
      <input
        id={`${id}q`}
        className="bc-text"
        type="search"
        autoFocus
        value={query}
        placeholder="R1, 10 kΩ or GND"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && found[0]) {
            e.preventDefault();
            go(found[0]);
          }
        }}
      />
      {query.trim() && !found.length && <PanelNote>Nothing in this design matches that.</PanelNote>}
      {found.length > 0 && (
        <ul className="bc-ec-check-list" aria-label="Found">
          {found.map((f) => (
            <li key={keyOf(f)} className={cx(at === keyOf(f) && "bc-on")}>
              <button type="button" className="bc-ec-check-go" aria-current={at === keyOf(f) || undefined} onClick={() => go(f)}>
                <span className="bc-ec-check-text">{f.text}</span>
                <span className="bc-note">{f.note}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </FeaturePanel>
  );
}
