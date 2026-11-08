import { useState, type KeyboardEvent, type ReactNode } from "react";
import { Button, IconButton } from "./Button";
import { Icon } from "./Icon";
import type { IconName } from "./icons";
import { MenuButton, type MenuButtonProps, type MenuEntry } from "./Menu";

type TriggerProps = Parameters<MenuButtonProps["trigger"]>[0];
import { cx } from "./cx";

/** OK or Cancel at the foot of a feature panel. */
export interface PanelAction {
  /** "OK" or "Cancel" unless given. */
  label?: string;
  title: string;
  disabled?: boolean;
  onClick: () => void;
}

export interface FeaturePanelProps {
  /** The tool or step's name, in accent. */
  title: string;
  icon?: IconName;
  /** The rows: FeatureRow, FeaturePicker, FeatureCheck, NumberField or PanelNote. */
  children?: ReactNode;
  cancel: PanelAction;
  /** Left out while the tool waits for its first pick. */
  ok?: PanelAction;
  /** Enter in one of the panel's fields, after the field's own commit: usually keeps the step. */
  onFieldEnter?: (e: KeyboardEvent<HTMLInputElement>) => void;
  className?: string;
}

/**
 * A tall floating panel for a tool's settings, like Fusion's feature dialog: one labelled row per setting, then
 * Cancel and OK. Its title folds it to just the title and the buttons, to see more of the model on a small screen.
 */
export function FeaturePanel({ title, icon, children, cancel, ok, onFieldEnter, className }: FeaturePanelProps) {
  const [folded, setFolded] = useState(false);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    if (e.key === "Enter" && onFieldEnter && t instanceof HTMLInputElement && t.type === "text") onFieldEnter(e as unknown as KeyboardEvent<HTMLInputElement>);
  };
  return (
    <section role="group" aria-label={`${title} options`} className={cx("bc-fpanel", folded && "bc-folded", className)}>
      <header className="bc-fpanel-head">
        <span className="bc-tools-title">
          {icon && <Icon name={icon} size={16} />}
          {title}
        </span>
        <button
          type="button"
          className="bc-fpanel-fold"
          aria-expanded={!folded}
          aria-label={folded ? `Show the ${title.toLowerCase()} settings` : `Fold the ${title.toLowerCase()} settings away`}
          data-tip={folded ? "Show the settings" : "Fold the settings away"}
          onClick={() => setFolded((f) => !f)}
        >
          <Icon name="chevronDown" size={14} />
        </button>
      </header>
      {!folded && (
        <div className="bc-fpanel-body" onKeyDown={onKeyDown}>
          {children}
        </div>
      )}
      <footer className="bc-fpanel-foot">
        <Button kind="cancel" label={cancel.label ?? "Cancel"} title={cancel.title} shortcut="Esc" disabled={cancel.disabled} onClick={cancel.onClick} />
        {ok && <Button kind="done" label={ok.label ?? "OK"} title={ok.title} shortcut="Enter" disabled={ok.disabled} onClick={ok.onClick} />}
      </footer>
    </section>
  );
}

/** One setting: its name on the left, the control on the right. */
export function FeatureRow({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cx("bc-frow", className)}>
      <span className="bc-frow-label">{label}</span>
      <div className="bc-frow-ctl">{children}</div>
    </div>
  );
}

export interface FeaturePickerProps {
  /** "Profile", "Axis", "Edges": the row's name, and the group's. */
  label: string;
  /** How many things are picked. */
  count: number;
  /** Shown when nothing is picked: "Pick shapes". */
  empty: string;
  /** Lit while the next click in the view picks for this row. */
  picking?: boolean;
  title: string;
  /** Pick in the view, and the things it can take by name. Left out, the button picks in the view. */
  entries?: MenuEntry[];
  onPick?: () => void;
  /** The ×: clear and pick again. */
  onClear?: () => void;
  clearTitle?: string;
  /** A name for one pick, shown in place of "1 selected" (such as an axis). */
  named?: string;
}

/** A row that picks things in the view: "1 selected" with an × to clear it, like Fusion's selection rows. */
export function FeaturePicker({ label, count, empty, picking, title, entries, onPick, onClear, clearTitle, named }: FeaturePickerProps) {
  const text = count === 0 ? empty : count === 1 && named ? named : `${count} selected`;
  const btn = (p: Partial<TriggerProps> & { onClick?: () => void }) => (
    <Button {...p} className="bc-picker-btn" icon="arrow" label={text} on={picking} title={title} />
  );
  return (
    <div role="group" aria-label={label} className="bc-frow">
      <span className="bc-frow-label">{label}</span>
      <div className="bc-frow-ctl bc-picker">
        {entries ? <MenuButton label={label} entries={entries} trigger={btn} /> : btn({ onClick: onPick })}
        {count > 0 && onClear && <IconButton icon="close" title={clearTitle ?? `Clear ${label.toLowerCase()}`} onClick={onClear} />}
      </div>
    </div>
  );
}

/** An on or off setting, as a tick box. */
export function FeatureCheck({ label, title, on, onChange }: { label: string; title: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="bc-frow bc-fcheck" data-tip={title}>
      <span className="bc-frow-label">{label}</span>
      <span className="bc-frow-ctl">
        <input type="checkbox" checked={on} onChange={(e) => onChange(e.currentTarget.checked)} />
      </span>
    </label>
  );
}

/** A line of text across the panel: what to click next, what it will do, or (tone "error") why it can't. */
export function PanelNote({ children, tone, live }: { children: ReactNode; tone?: "error"; live?: boolean }) {
  return (
    <p className={cx("bc-fpanel-note", tone === "error" && "bc-armed-error")} role={tone === "error" ? "alert" : live ? "status" : undefined}>
      {children}
    </p>
  );
}
