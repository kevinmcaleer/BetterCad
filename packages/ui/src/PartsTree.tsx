import type { MouseEvent, ReactNode } from "react";
import { Icon } from "./Icon";
import type { IconName } from "./icons";
import { cx } from "./cx";

export interface PartRowProps {
  name: string;
  icon?: IconName;
  depth?: number;
  selected?: boolean;
  /** Hidden in the view: the name at 45%. */
  hidden?: boolean;
  /** A short problem mark in danger, such as "Missing file". */
  warning?: string;
  onSelect?: () => void;
  onContextMenu?: (e: MouseEvent) => void;
  /** Row buttons on the right (IconButton quiet). */
  buttons?: ReactNode;
}

/** One row of the parts tree. */
export function PartRow({ name, icon = "cube", depth = 0, selected, hidden, warning, onSelect, onContextMenu, buttons }: PartRowProps) {
  return (
    <li
      className={cx("bc-row", selected && "bc-on", hidden && "bc-off")}
      style={{ ["--depth" as string]: depth }}
      aria-selected={selected}
      role="treeitem"
      onContextMenu={onContextMenu}
    >
      <button type="button" className="bc-row-name" onClick={onSelect}>
        <Icon name={icon} size={16} />
        <span>{name}</span>
        {warning && <em>{warning}</em>}
      </button>
      {buttons}
    </li>
  );
}

export function PartsTree({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ul className="bc-tree" role="tree" aria-label={label}>
      {children}
    </ul>
  );
}
