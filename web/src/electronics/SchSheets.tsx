import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { GRID, copiesOf, eid, elsewhere, placeSheetBox, q, repeatLayout, type ElectronicsDesign, type P2, type Sheet } from "@bettercad/electronics";
import { addSheet, duplicateSheet, moveSheet, removeSheet, renameSheet } from "@bettercad/electronics/sheets";
import { ContextMenu, ESC, Icon, longPress, useEscape, type ContextMenuState } from "@bettercad/ui";
import type { EEdit } from "./actions";
import { eui } from "./ui";
import { useEui } from "./useEui";

export interface SchSheetsProps {
  design: ElectronicsDesign;
  /** The sheet that is showing. */
  open: string;
  edit: EEdit;
  readOnly?: boolean;
}

/**
 * The schematic's sheets (#636): a tab for each, and a plus. Arrow keys go from sheet to sheet, F2 renames, Delete
 * deletes and Alt with an arrow moves a sheet along; right-click, or a long press, has them all, and Duplicate, which
 * copies a sheet as a block to use again. With one sheet and nothing to change, there is nothing to show.
 */
export default function SchSheets({ design, open, edit, readOnly }: SchSheetsProps) {
  const [menu, setMenu] = useState<{ at: ContextMenuState; sheet: string } | null>(null);
  const [renaming, setRenaming] = useState<{ sheet: string; name: string } | null>(null);
  const [said, setSaid] = useState("");
  const strip = useRef<HTMLDivElement>(null);
  const sheets = design.sheets;
  const tab = (id: string) => strip.current?.querySelector<HTMLElement>(`[data-sheet="${id}"]`);
  const focus = (id: string) => (tab(id) ? tab(id)!.focus() : requestAnimationFrame(() => tab(id)?.focus()));
  useEscape(renaming !== null, () => setRenaming(null), ESC.overlay);
  useEffect(() => {
    if (!said) return;
    const t = setTimeout(() => setSaid(""), 8000);
    return () => clearTimeout(t);
  }, [said]);

  const show = (id: string) => eui.set({ sheet: id, selected: [], net: null, spot: null });
  const add = () => {
    const id = eid("sh");
    edit((d) => addSheet(d, open, id).design, "Add sheet");
    show(id);
    focus(id);
  };
  const copy = (sheet: string) => {
    const id = eid("sh");
    const made = duplicateSheet(design, sheet, id);
    if (!made) return;
    edit((d) => duplicateSheet(d, sheet, id)?.design ?? d, "Duplicate sheet");
    show(id);
    focus(id);
    const from = sheets.find((s) => s.id === sheet)!.name;
    setSaid(
      made.renamed.length
        ? `Copied ${from}. Its parts have their own references, and ${made.renamed.length === 1 ? `${made.renamed[0]![0]} is ${made.renamed[0]![1]}` : `${made.renamed.length} names used only there end in ${made.renamed[0]![1].split("_").pop()}`} on the copy. Names other sheets use still join.`
        : `Copied ${from}. Its parts have their own references. Its names still join the first sheet's: rename the ones that should not.`,
    );
  };
  const remove = (sheet: string) => {
    const at = sheets.findIndex((s) => s.id === sheet);
    if (at < 0) return;
    if (sheets[at]!.use) return setSaid(`${sheets[at]!.name} is placed as a box. Delete its box instead.`);
    if (sheets.length < 2) return setSaid("A schematic keeps at least one sheet.");
    const next = sheets[at + 1] ?? sheets[at - 1]!;
    if (sheet === open) show(next.id);
    const parts = new Set(sheets[at]!.symbols.map((y) => y.part)).size;
    edit((d) => removeSheet(d, sheet), "Delete sheet");
    setSaid(`Deleted ${sheets[at]!.name}${parts ? ` and its ${parts} ${parts === 1 ? "part" : "parts"}` : ""}. Undo brings it back.`);
    focus(next.id);
  };
  const move = (sheet: string, by: number) => {
    const at = sheets.findIndex((s) => s.id === sheet);
    if (at < 0 || at + by < 0 || at + by >= sheets.length) return;
    edit((d) => moveSheet(d, sheet, at + by), "Move sheet");
    focus(sheet);
  };
  // Hierarchy (#757): the sheet goes on the open one as a box, to the right of what is there.
  const place = (sheet: string) => {
    // Worked out on the design as it is, so the new box can be picked straight away.
    const got = placeSheetBox(design, open, sheet, freeSpot(sheets.find((s) => s.id === open)!));
    if (!got) return setSaid("A sheet can't go inside itself.");
    edit(() => got.design, "Place sheet as a box");
    const name = sheets.find((s) => s.id === sheet)!.name;
    eui.set({ selected: [got.box] });
    setSaid(
      got.sheet === sheet
        ? `${name} is a box here now. Its sheet pins are the box's pins; double-click the box to open it.`
        : `Placed ${name} again. The copy follows ${name}: change that sheet and every copy changes with it.`,
    );
  };
  const repeat = (sheet: string) => {
    edit((d) => repeatLayout(d, sheet), "Repeat block layout");
    setSaid(`Laid the copies of ${sheets.find((s) => s.id === sheet)!.name} out as it is on the board.`);
  };
  const rename = () => {
    if (!renaming) return;
    edit((d) => renameSheet(d, renaming.sheet, renaming.name), "Rename sheet");
    setRenaming(null);
    focus(renaming.sheet);
  };
  const key = (e: KeyboardEvent, id: string, i: number) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    const to = step ? sheets[i + step] : e.key === "Home" ? sheets[0] : e.key === "End" ? sheets[sheets.length - 1] : undefined;
    if (step && e.altKey && !readOnly) {
      e.preventDefault();
      move(id, step);
    } else if (to) {
      e.preventDefault();
      show(to.id);
      focus(to.id);
    } else if (!readOnly && e.key === "F2") {
      e.preventDefault();
      setRenaming({ sheet: id, name: sheets[i]!.name });
    } else if (!readOnly && (e.key === "Delete" || e.key === "Backspace")) {
      e.preventDefault();
      remove(id);
    }
  };
  const at = menu ? sheets.findIndex((s) => s.id === menu.sheet) : -1;

  // A picked label whose name carries on to other sheets: say where, and go there.
  const ui = useEui();
  const picked = sheets.find((s) => s.id === open)?.labels.filter((l) => ui.selected.includes(l.id)) ?? [];
  const name = picked.length === 1 ? picked[0]!.name : null;
  const others = name ? (elsewhere(design, open).get(name) ?? []) : [];
  const follow = (id: string) => {
    const there = sheets.find((s) => s.id === id)?.labels.filter((l) => l.name === name) ?? [];
    const first = there[0];
    eui.set({ sheet: id, selected: there.map((l) => l.id), net: null, spot: first ? { sheet: id, at: [first.x, first.y], n: Date.now() } : null });
  };
  if (readOnly && sheets.length < 2) return null;

  return (
    <div ref={strip} className="bc-sheet-strip bc-ec-sheets" onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
      {others.length > 0 ? (
        <p className="bc-ec-sheets-said" role="status">
          {name} carries on to{" "}
          {others.map((o) => (
            <button key={o.id} type="button" className="bc-ec-pill" onClick={() => follow(o.id)}>
              {o.name}
            </button>
          ))}
        </p>
      ) : (
        said && (
          <p className="bc-ec-sheets-said" role="status">
            {said}
          </p>
        )
      )}
      <div className="bc-sheet-tabs" role="tablist" aria-label="Sheets">
        {sheets.map((s, i) =>
          renaming?.sheet === s.id ? (
            <form
              key={s.id}
              className="bc-sheet-tab bc-sheet-tab-on"
              onSubmit={(e) => {
                e.preventDefault();
                rename();
              }}
            >
              <input
                className="bc-input bc-sheet-name"
                aria-label="Sheet name"
                autoFocus
                value={renaming.name}
                onChange={(e) => setRenaming({ sheet: s.id, name: e.target.value })}
                onFocus={(e) => e.target.select()}
                onBlur={rename}
              />
            </form>
          ) : (
            <button
              key={s.id}
              type="button"
              role="tab"
              data-sheet={s.id}
              className={s.id === open ? "bc-sheet-tab bc-sheet-tab-on" : "bc-sheet-tab"}
              aria-selected={s.id === open}
              aria-label={`${s.name}, sheet ${i + 1} of ${sheets.length}`}
              title={readOnly ? s.name : `${s.name} (F2 to rename)`}
              tabIndex={s.id === open ? 0 : -1}
              onClick={() => show(s.id)}
              onDoubleClick={() => !readOnly && setRenaming({ sheet: s.id, name: s.name })}
              onKeyDown={(e) => key(e, s.id, i)}
              onContextMenu={(e) => {
                if (readOnly) return;
                e.preventDefault();
                setMenu({ at: { x: e.clientX, y: e.clientY }, sheet: s.id });
              }}
              {...(readOnly ? {} : longPress((where) => setMenu({ at: where, sheet: s.id })))}
            >
              <span className="bc-sheet-tab-name">{s.name}</span>
            </button>
          ),
        )}
      </div>
      {!readOnly && (
        <button type="button" className="bc-sheet-add" aria-label="Add sheet" title="Add sheet" onClick={add}>
          <Icon name="plus" />
        </button>
      )}
      <ContextMenu
        at={menu?.at ?? null}
        onClose={() => setMenu(null)}
        label="Sheet actions"
        title={at >= 0 ? sheets[at]!.name : undefined}
        entries={
          menu && at >= 0
            ? [
                { id: "rename", label: "Rename", keys: "F2", onSelect: () => setRenaming({ sheet: menu.sheet, name: sheets[at]!.name }) },
                { id: "copy", label: "Duplicate, as a block to use again", onSelect: () => copy(menu.sheet) },
                {
                  id: "box",
                  label: "Place on this sheet as a box",
                  disabled: menu.sheet === open,
                  onSelect: () => place(menu.sheet),
                },
                ...(design.board && copiesOf(design, menu.sheet).length
                  ? [{ id: "layout", label: "Repeat its board layout on the copies", onSelect: () => repeat(menu.sheet) }]
                  : []),
                { id: "left", label: "Move left", keys: "Alt+←", disabled: at === 0, onSelect: () => move(menu.sheet, -1) },
                { id: "right", label: "Move right", keys: "Alt+→", disabled: at === sheets.length - 1, onSelect: () => move(menu.sheet, 1) },
                { kind: "separator", id: "s" },
                { id: "delete", label: "Delete", danger: true, keys: "Del", disabled: sheets.length < 2, onSelect: () => remove(menu.sheet) },
              ]
            : []
        }
      />
    </div>
  );
}

/** Where a new box goes on a sheet: a little to the right of everything on it, on the grid. */
function freeSpot(sheet: Sheet): P2 {
  const xs = [
    ...sheet.symbols.map((y) => y.x + 10),
    ...sheet.labels.map((l) => l.x + 10),
    ...sheet.wires.flatMap((w) => [w.a[0], w.b[0]]),
    ...(sheet.boxes ?? []).map((b) => b.x + 30),
  ];
  const ys = [...sheet.symbols.map((y) => y.y), ...(sheet.boxes ?? []).map((b) => b.y)];
  const x = xs.length ? Math.max(...xs) + 4 * GRID : 0;
  const y = ys.length ? Math.max(...ys) : 0;
  return [q(Math.round(x / GRID) * GRID), q(Math.round(y / GRID) * GRID)];
}
