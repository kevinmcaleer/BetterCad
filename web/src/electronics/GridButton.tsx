import { Icon, MenuButton, type MenuEntry } from "@bettercad/ui";
import { BOARD_GRIDS, eui, toggleGrid } from "./ui";
import { useEui } from "./useEui";

/** The grid readout on the status strip: a button that shows or hides the grid and, on the board, sets its size. */
export function GridButton({ view }: { view: "schematic" | "pcb" }) {
  const ui = useEui();
  const step = view === "pcb" ? ui.grid : 2.54;
  const entries: MenuEntry[] = [
    { id: "show", label: "Show grid", keys: "G", checked: ui.gridShown, multiple: true, onSelect: toggleGrid },
    { kind: "separator", id: "sep" },
    ...(view === "pcb"
      ? [
          { kind: "title" as const, id: "size", label: "Grid size" },
          ...BOARD_GRIDS.map((g): MenuEntry => ({
            id: `g${g}`,
            label: g === 1.27 || g === 2.54 ? `${g} mm (${g / 25.4} in)` : `${g} mm`,
            checked: ui.grid === g,
            onSelect: () => eui.set({ grid: g }),
          })),
        ]
      : [{ kind: "title" as const, id: "size", label: "Snaps to 2.54 mm, so wires meet pins" }]),
  ];
  return (
    <MenuButton
      label="Grid"
      align="end"
      entries={entries}
      trigger={(props) => (
        <button {...props} type="button" className="bc-ec-pill bc-ec-grid-button" data-tip="Grid options. Show or hide it (G)">
          <Icon name={ui.gridShown ? "grid" : "eyeOff"} size={14} />
          {ui.gridShown ? `Grid ${step} mm` : `Grid hidden, ${step} mm`}
        </button>
      )}
    />
  );
}
