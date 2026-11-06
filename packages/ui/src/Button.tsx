import { forwardRef, type ButtonHTMLAttributes } from "react";
import { Icon } from "./Icon";
import type { IconName } from "./icons";
import { cx, withShortcut } from "./cx";

export type ButtonKind = "done" | "cancel" | "primary" | "stale" | "snap";

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "title"> {
  icon?: IconName;
  label?: string;
  /** A pressed tool: accent-soft fill, accent text, aria-pressed. Leave undefined for a plain action. */
  on?: boolean;
  /** done: the one primary action in a bar. cancel: muted. primary: filled. stale: warn text. snap: blue count. */
  kind?: ButtonKind;
  /** Tooltip; the shortcut is appended in brackets. */
  title?: string;
  shortcut?: string;
}

/** The toolbar and bar button. A button with only an icon takes its accessible name from `title`. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { icon, label, on, kind, title, shortcut, className, children, ...rest },
  ref,
) {
  const tip = withShortcut(title, shortcut);
  return (
    <button
      ref={ref}
      type="button"
      className={cx("bc-btn", on && "bc-on", kind && "bc-" + kind, className)}
      title={tip}
      aria-label={!label && title ? title : undefined}
      aria-pressed={on === undefined ? undefined : on}
      aria-keyshortcuts={shortcut}
      {...rest}
    >
      {icon && <Icon name={icon} size={16} />}
      {label && <span>{label}</span>}
      {children}
    </button>
  );
});

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "title"> {
  icon: IconName;
  /** Required: the button's accessible name and tooltip. */
  title: string;
  on?: boolean;
  /** Quiet until pointed at (row buttons in the parts tree). */
  quiet?: boolean;
  inherited?: boolean;
}

/** A 28px icon-only button, as on part rows. */
export function IconButton({ icon, title, on, quiet, inherited, className, ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      className={cx("bc-icon-btn", quiet && "bc-quiet", on && "bc-on", inherited && "bc-inherited", className)}
      title={title}
      aria-label={title}
      aria-pressed={on === undefined ? undefined : on}
      {...rest}
    >
      <Icon name={icon} size={16} />
    </button>
  );
}

export interface WideButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: IconName;
  label: string;
  variant?: "rail" | "outline" | "primary";
}

/** The 38px full-width button at the top of a panel ("Add a part"). */
export function WideButton({ icon, label, variant = "rail", className, ...rest }: WideButtonProps) {
  return (
    <button type="button" className={cx("bc-wide-btn", variant === "outline" && "bc-outline", variant === "primary" && "bc-primary", className)} {...rest}>
      {icon && <Icon name={icon} size={16} />}
      <span>{label}</span>
    </button>
  );
}
