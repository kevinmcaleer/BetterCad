import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { Icon } from "./Icon";
import type { IconName } from "./icons";
import { cx } from "./cx";

export interface ToolbarProps {
  /** Accessible name, such as "View tools". */
  label: string;
  children: ReactNode;
  orientation?: "horizontal" | "vertical";
  className?: string;
}

const ITEMS = "button:not([disabled]):not([aria-disabled='true'])";

/**
 * A floating bar of tools. Tab enters it once, on the pressed tool or the first; the arrow keys move between tools
 * (roving tabindex); Home and End jump to the ends.
 */
function ToolbarBase({ label, children, orientation = "horizontal", className }: ToolbarProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  const items = () => Array.from(ref.current?.querySelectorAll<HTMLElement>(ITEMS) ?? []);
  // Keep exactly one tab stop: the focused item, else the pressed one, else the first.
  const syncTabStops = (focus?: HTMLElement) => {
    const list = items();
    const stop = focus ?? list.find((b) => b.getAttribute("aria-pressed") === "true") ?? list[0];
    for (const b of list) b.tabIndex = b === stop ? 0 : -1;
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const next = orientation === "horizontal" ? "ArrowRight" : "ArrowDown";
    const prev = orientation === "horizontal" ? "ArrowLeft" : "ArrowUp";
    if (![next, prev, "Home", "End"].includes(e.key)) return;
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    e.preventDefault();
    const j = e.key === "Home" ? 0 : e.key === "End" ? list.length - 1 : (i + (e.key === next ? 1 : -1) + list.length) % list.length;
    const target = list[j]!;
    syncTabStops(target);
    target.focus();
  };

  return (
    <div
      ref={(el) => {
        ref.current = el;
        if (el) syncTabStops();
      }}
      role="toolbar"
      aria-label={label}
      aria-orientation={orientation}
      className={cx("bc-tools", orientation === "vertical" && "bc-tools-vertical", className)}
      onKeyDown={onKeyDown}
      onFocus={(e) => {
        if ((e.target as HTMLElement).matches(ITEMS)) syncTabStops(e.target as HTMLElement);
      }}
    >
      {children}
    </div>
  );
}

/** A 1px divider between groups in a bar. */
export function Separator() {
  return <span className="bc-sep" role="separator" />;
}

export const Toolbar = Object.assign(ToolbarBase, { Separator });

export interface ArmedBarProps {
  /** The armed tool's name, in accent. */
  title: string;
  icon?: IconName;
  children?: ReactNode;
}

/** The second strip that appears under the toolbar while a tool is armed: the tool's name then its options. */
export function ArmedBar({ title, icon, children }: ArmedBarProps) {
  return (
    <div role="group" aria-label={`${title} options`} className="bc-tools bc-armed">
      <span className="bc-tools-title">
        {icon && <Icon name={icon} size={16} />}
        {title}
      </span>
      {children}
    </div>
  );
}
