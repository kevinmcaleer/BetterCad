import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";
import type { IconName } from "./icons";
import { cx } from "./cx";
import { useDismiss } from "./useDismiss";
import { useEscape } from "./useEscape";
import { overlayRoot, placeInWindow } from "./overlay";

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
  /** Focus the first item on open. */
  autoFocus?: boolean;
  /** A press inside this element (the menu's own trigger) does not count as outside. */
  ignore?: RefObject<HTMLElement | null>;
  children?: ReactNode;
}

const ITEM = '[role^="menuitem"]:not([disabled])';

/** A popover list of actions. Arrow keys move, a letter jumps, Enter picks, Esc closes. */
export function Menu({ open, onClose, entries, label, title, style, className, autoFocus = true, ignore, children }: MenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, onClose, ignore);
  useEscape(open, onClose);
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
    else if (e.key.length === 1 && /\S/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Typeahead: jump to the next item starting with the letter.
      const k = e.key.toLowerCase();
      const order = [...items.slice(i + 1), ...items.slice(0, i + 1)];
      const hit = order.find((el) => (el.dataset.label ?? "").toLowerCase().startsWith(k));
      if (hit) next = items.indexOf(hit);
    }
    if (next >= 0) {
      e.preventDefault();
      e.stopPropagation();
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
            data-label={en.label}
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

/** Renders a menu into the overlay layer at a point, flipping to stay inside the window. */
function FloatingMenu({ at, ...props }: Omit<MenuProps, "style"> & { at: { x: number; y: number } }) {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = wrap.current?.firstElementChild as HTMLElement | null;
    if (!el) return;
    setPos(placeInWindow(at.x, at.y, el.offsetWidth, el.offsetHeight));
  }, [at.x, at.y, props.open]);
  if (!props.open) return null;
  return createPortal(
    <div ref={wrap} className="bc-floating" style={pos ? { left: pos.left, top: pos.top } : { left: at.x, top: at.y, visibility: "hidden" }}>
      <Menu {...props} />
    </div>,
    overlayRoot(),
  );
}

export interface ContextMenuState {
  x: number;
  y: number;
}

/** A menu at the pointer (right-click, or a long press on touch), kept inside the window. */
export function ContextMenu({ at, ...props }: Omit<MenuProps, "open" | "style"> & { at: ContextMenuState | null }) {
  if (!at) return null;
  return <FloatingMenu {...props} open at={at} />;
}

export interface MenuButtonProps {
  /** Renders the trigger; spread `props` onto a button. */
  trigger: (props: { ref: (el: HTMLElement | null) => void; onClick: () => void; "aria-haspopup": "menu"; "aria-expanded": boolean }) => ReactNode;
  entries: MenuEntry[];
  label: string;
  /** Line the menu's right edge up with the trigger's. */
  align?: "start" | "end";
  children?: ReactNode;
}

/** A button that opens a menu under itself. Focus returns to the button when the menu closes. */
export function MenuButton({ trigger, entries, label, align = "start", children }: MenuButtonProps) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const btn = useRef<HTMLElement | null>(null);
  const open = () => {
    const r = btn.current!.getBoundingClientRect();
    setAt({ x: align === "end" ? r.right - 280 : r.left, y: r.bottom + 4 });
  };
  const close = () => {
    setAt(null);
    btn.current?.focus();
  };
  return (
    <>
      {trigger({
        ref: (el) => {
          btn.current = el;
        },
        onClick: () => (at ? close() : open()),
        "aria-haspopup": "menu",
        "aria-expanded": !!at,
      })}
      {at && (
        <FloatingMenu open at={at} onClose={close} entries={entries} label={label} ignore={btn}>
          {children}
        </FloatingMenu>
      )}
    </>
  );
}

/** Opens a context menu after a long press (touch). Returns pointer handlers for the target. */
export function longPress(onLongPress: (at: ContextMenuState) => void, ms = 500) {
  let timer: number | undefined;
  let start: { x: number; y: number } | null = null;
  const cancel = () => {
    window.clearTimeout(timer);
    start = null;
  };
  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType !== "touch") return;
      start = { x: e.clientX, y: e.clientY };
      timer = window.setTimeout(() => start && onLongPress(start), ms);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
  };
}
