import type { ReactNode } from "react";
import { Icon } from "./Icon";
import type { IconName } from "./icons";
import { cx } from "./cx";

export interface ToolbarProps {
  /** Accessible name, such as "View tools". */
  label: string;
  children: ReactNode;
  className?: string;
}

/** The floating bar of tools over the viewport. Groups are split with <Separator />. */
export function Toolbar({ label, children, className }: ToolbarProps) {
  return (
    <div role="toolbar" aria-label={label} className={cx("bc-tools", className)}>
      {children}
    </div>
  );
}

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

/** A 1px divider between groups in a bar. */
export function Separator() {
  return <span className="bc-sep" role="separator" aria-orientation="vertical" />;
}
