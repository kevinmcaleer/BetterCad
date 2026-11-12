import type { ReactNode } from "react";
import { Icon } from "./Icon";
import type { IconName } from "./icons";
import { MenuButton, type MenuEntry } from "./Menu";
import { cx, withShortcut } from "./cx";

export interface RibbonButtonProps {
  icon: IconName;
  /** The colour icon to draw (see Icon): on by default, or another colour icon's name. */
  colour?: boolean | string;
  /** The tool's name: its accessible name and tooltip. */
  label: string;
  /** A shorter name under the icon, when the full one is long. */
  short?: string;
  shortcut?: string;
  pressed?: boolean;
  disabled?: boolean;
  /** Finish sketch: green, as the Done button. */
  done?: boolean;
  onPress?: () => void;
}

/** A ribbon tool: a big colour icon with its name under it. Tooltip "Label (K)". */
export function RibbonButton({ icon, colour = true, label, short, shortcut, pressed, disabled, done, onPress }: RibbonButtonProps) {
  return (
    <button
      type="button"
      className={cx("bc-rb", pressed && "bc-on", done && "bc-rb-done")}
      aria-pressed={done ? undefined : (pressed ?? false)}
      aria-label={label}
      aria-keyshortcuts={shortcut}
      data-tip={withShortcut(label, shortcut)}
      disabled={disabled}
      onClick={onPress}
    >
      <Icon name={icon} size={28} colour={colour} />
      <span className="bc-rb-label">{short ?? label}</span>
    </button>
  );
}

export interface RibbonGroupProps {
  /** The group's name under its tools; it opens the drop-down. */
  label: string;
  /** Every tool in the group, for the drop-down. */
  entries: MenuEntry[];
  children: ReactNode;
}

/** A group of ribbon tools, with its name under them opening a drop-down of every tool in the group. */
export function RibbonGroup({ label, entries, children }: RibbonGroupProps) {
  return (
    <div className="bc-rgroup" role="group" aria-label={label}>
      <div className="bc-rgroup-tools">{children}</div>
      {entries.length > 0 ? (
        <MenuButton
          label={`${label} tools`}
          entries={entries}
          trigger={(t) => (
            <button {...t} type="button" className="bc-rgroup-name" data-tip={`All ${label.toLowerCase()} tools`}>
              {label}
              <Icon name="chevronDown" size={12} />
            </button>
          )}
        />
      ) : (
        <span className="bc-rgroup-name">{label}</span>
      )}
    </div>
  );
}
