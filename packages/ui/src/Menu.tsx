import { useEffect, useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { Icon } from "./Icon";
import type { IconName } from "./icons";
import { cx } from "./cx";
import { useDismiss } from "./useDismiss";

export type MenuEntry =
  | {
      kind?: "item";
      id: string;
      label: string;
      icon?: IconName;
      /** Shortcut text shown on the right, such as "Ctrl+S". */
      keys?: string;
      danger?: boolean;
      disabled?: boolean;
      /** For a choice among several (theme): renders as menuitemradio. */
      checked?: boolean;
      onSelect: () => void;
    }
  | { kind: "separator"; id: string }
  | { kind: "title"; id: string; label: string };

export interface MenuProps {
  open: boolean;
  onClose: () => void;
  entries: MenuEntry[];
  /** Accessible name. */
  label: string;
  /** A context menu's first line: what it is for. */
  title?: string;
  style?: CSSProperties;
  className?: string;
  /** Focus the first item on open (true for keyboard and click opening). */
  autoFocus?: boolean;
  children?: ReactNode;
}

const ITEM = '[role^="menuitem"]:not([disabled])';

/** A popover list of actions. Arrow keys move, Enter picks, Esc closes. */
export function Menu({ open, onClose, entries, label, title, style, className, autoFocus = true, children }: MenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, onClose);
  useEffect(() => {
    if (open && autoFocus) ref.current?.querySelector<HTMLElement>(ITEM)?.focus();
  }, [open, autoFocus]);
  if (!open) return null;

  const onKeyDown = (e: KeyboardEvent) => {
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>(ITEM) ?? []);
    const i = items.indexOf(document.activeElement as HTMLElement);
    let next = -1;
    if (e.key === "ArrowDown") next = (i + 1) % items.length;
    else if (e.key === "ArrowUp") next = (i - 1 + items.length) % items.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    else if (e.key === "Tab") onClose();
    if (next >= 0) {
      e.preventDefault();
      items[next]?.focus();
    }
  };

  return (
    <div ref={ref} role="menu" aria-label={label} className={cx("bc-menu", className)} style={style} onKeyDown={onKeyDown}>
      {title && <div className="bc-menu-title">{title}</div>}
      {entries.map((en) => {
        if (en.kind === "separator") return <hr key={en.id} />;
        if (en.kind === "title")
          return (
            <div key={en.id} className="bc-panel-title" role="presentation">
              {en.label}
            </div>
          );
        return (
          <button
            key={en.id}
            type="button"
            role={en.checked === undefined ? "menuitem" : "menuitemradio"}
            aria-checked={en.checked}
            className={cx("bc-menu-item", en.danger && "bc-danger")}
            disabled={en.disabled}
            tabIndex={-1}
            onClick={() => {
              onClose();
              en.onSelect();
            }}
          >
            <span className="bc-menu-icon">{en.icon ? <Icon name={en.icon} size={16} /> : en.checked ? <Icon name="check" size={16} /> : null}</span>
            <span>{en.label}</span>
            {en.keys && <span className="bc-keys">{en.keys}</span>}
          </button>
        );
      })}
      {children}
    </div>
  );
}

export interface ContextMenuState {
  x: number;
  y: number;
}

/** A Menu placed at the pointer, kept inside the window. */
export function ContextMenu({ at, ...props }: Omit<MenuProps, "open" | "style"> & { at: ContextMenuState | null }) {
  const x = at ? Math.min(at.x, window.innerWidth - 290) : 0;
  const y = at ? Math.min(at.y, window.innerHeight - 200) : 0;
  return <Menu {...props} open={!!at} style={{ position: "fixed", left: Math.max(4, x), top: Math.max(4, y) }} />;
}
