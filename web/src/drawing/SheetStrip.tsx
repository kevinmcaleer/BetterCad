import { useRef, useState, type KeyboardEvent } from "react";
import { ContextMenu, ESC, Icon, useEscape, type ContextMenuState } from "@bettercad/ui";
import { sheetBox, type Drawing, type DrawingSheet } from "@bettercad/kernel/drawing";
import { sizeName } from "./layout";
import { addSheet, duplicateSheet, moveSheet, removeSheet, renameSheet } from "./sheets";

export interface SheetStripProps {
  drawing: Drawing;
  /** The sheet that is open. */
  open: string;
  onOpen: (id: string) => void;
  /** A change to the drawing's sheets. Left out, the strip only switches sheets. */
  onChange?: (change: (d: Drawing) => Drawing, label: string) => void;
  newId: (kind: "sh" | "vw" | "mk" | "dm") => string;
  say?: (text: string) => void;
}

/** A sheet at a glance: its page, where its title block is, and a box for each view. */
function Thumb({ sheet }: { sheet: DrawingSheet }) {
  const { w, h } = sheetBox(sheet);
  return (
    <svg className="bc-sheet-thumb" viewBox={`0 0 ${w} ${h}`} width={Math.round((30 * w) / h)} height={30} aria-hidden="true">
      <rect className="bc-sheet-thumb-page" width={w} height={h} />
      <rect className="bc-sheet-thumb-title" x={w - Math.min(180, w * 0.5) - 10} y={h - 46} width={Math.min(180, w * 0.5)} height={36} />
      {sheet.views.map((v) => {
        const [vw, vh] = [v.laid?.w || 40, v.laid?.h || 30];
        return <rect key={v.id} className="bc-sheet-thumb-view" x={v.at[0] - vw / 2} y={h - v.at[1] - vh / 2} width={vw} height={vh} />;
      })}
    </svg>
  );
}

/**
 * The strip of sheets along the bottom of a drawing (#572), as Fusion has it: a tab for each sheet with a picture of
 * it, and a plus. Arrow keys go from sheet to sheet; F2 renames, Delete deletes, Alt with an arrow moves a sheet
 * along, and right-click has them all.
 */
export function SheetStrip({ drawing, open, onOpen, onChange, newId, say }: SheetStripProps) {
  const [menu, setMenu] = useState<{ at: ContextMenuState; sheet: string } | null>(null);
  const [renaming, setRenaming] = useState<{ sheet: string; name: string } | null>(null);
  const strip = useRef<HTMLDivElement>(null);
  const sheets = drawing.sheets;
  const tab = (id: string) => strip.current?.querySelector<HTMLElement>(`[data-sheet="${id}"]`);
  /** Focus goes with the sheet: now when its tab is there, after the next paint when it is still to be drawn. */
  const focus = (id: string) => (tab(id) ? tab(id)!.focus() : requestAnimationFrame(() => tab(id)?.focus()));
  useEscape(renaming !== null, () => setRenaming(null), ESC.overlay);

  const add = () => {
    if (!onChange) return;
    const id = newId("sh");
    onChange((d) => addSheet(d, open, id), "Add sheet");
    onOpen(id);
  };
  const copy = (sheet: string) => {
    if (!onChange) return;
    const id = newId("sh");
    onChange((d) => duplicateSheet(d, sheet, (kind) => (kind === "sh" ? id : newId(kind))), "Duplicate sheet");
    onOpen(id);
  };
  const remove = (sheet: string) => {
    const at = sheets.findIndex((s) => s.id === sheet);
    if (!onChange || at < 0) return;
    if (sheets.length < 2) return say?.("A drawing keeps at least one sheet.");
    const next = sheets[at + 1] ?? sheets[at - 1]!;
    if (sheet === open) onOpen(next.id);
    onChange((d) => removeSheet(d, sheet), "Delete sheet");
    say?.(`Deleted ${sheets[at]!.name}. Undo brings it back.`);
    focus(next.id);
  };
  const move = (sheet: string, by: number) => {
    const at = sheets.findIndex((s) => s.id === sheet);
    if (!onChange || at < 0 || at + by < 0 || at + by >= sheets.length) return;
    onChange((d) => moveSheet(d, sheet, at + by), "Move sheet");
    focus(sheet);
  };
  const rename = () => {
    if (!renaming) return;
    onChange?.((d) => renameSheet(d, renaming.sheet, renaming.name), "Rename sheet");
    setRenaming(null);
    focus(renaming.sheet);
  };
  const key = (e: KeyboardEvent, s: DrawingSheet, i: number) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (step && e.altKey) {
      e.preventDefault();
      move(s.id, step);
    } else if (step) {
      const to = sheets[i + step];
      if (!to) return;
      e.preventDefault();
      onOpen(to.id);
      focus(to.id);
    } else if (e.key === "Home" || e.key === "End") {
      const to = e.key === "Home" ? sheets[0]! : sheets[sheets.length - 1]!;
      e.preventDefault();
      onOpen(to.id);
      focus(to.id);
    } else if (onChange && e.key === "F2") {
      e.preventDefault();
      setRenaming({ sheet: s.id, name: s.name });
    } else if (onChange && (e.key === "Delete" || e.key === "Backspace")) {
      e.preventDefault();
      remove(s.id);
    }
  };
  const at = menu ? sheets.findIndex((s) => s.id === menu.sheet) : -1;

  return (
    <div
      ref={strip}
      className="bc-sheet-strip"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
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
              <Thumb sheet={s} />
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
              aria-label={`${s.name}, ${sizeName(s.size)}, sheet ${i + 1} of ${sheets.length}`}
              title={onChange ? `${s.name} (F2 to rename)` : s.name}
              tabIndex={s.id === open ? 0 : -1}
              onClick={() => onOpen(s.id)}
              onDoubleClick={() => onChange && setRenaming({ sheet: s.id, name: s.name })}
              onKeyDown={(e) => key(e, s, i)}
              onContextMenu={(e) => {
                if (!onChange) return;
                e.preventDefault();
                setMenu({ at: { x: e.clientX, y: e.clientY }, sheet: s.id });
              }}
            >
              <Thumb sheet={s} />
              <span className="bc-sheet-tab-name">{s.name}</span>
            </button>
          ),
        )}
      </div>
      {onChange && (
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
                { id: "copy", label: "Duplicate", onSelect: () => copy(menu.sheet) },
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
