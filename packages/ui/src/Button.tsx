import { forwardRef, type ButtonHTMLAttributes, type MouseEvent } from "react";
import { Icon } from "./Icon";
import type { IconName } from "./icons";
import { cx, withShortcut } from "./cx";

export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";
export type ButtonSize = "control" | "dense" | "wide";
/** Design-system kinds kept from the bundle: done = primary, cancel = muted quiet, stale = warn, snap = geometry count. */
export type ButtonKind = "done" | "cancel" | "primary" | "stale" | "snap";

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "title"> {
  icon?: IconName;
  label?: string;
  /** primary: accent fill. secondary: rail fill. quiet (default): no fill. danger: danger text. */
  variant?: ButtonVariant;
  /** control 32px (default), dense 28px, wide 38px full width. */
  size?: ButtonSize;
  kind?: ButtonKind;
  /** A toggle's state: accent-soft fill, accent text, aria-pressed. Leave undefined for a plain action. */
  on?: boolean;
  /** Working: dimmed to 60% with the progress cursor, and clicks are ignored. */
  busy?: boolean;
  /** Tooltip text; the shortcut is appended in brackets. Icon-only buttons also take their name from it. */
  title?: string;
  shortcut?: string;
}

/** The button. Disabled buttons stay focusable (aria-disabled) so their tooltip can still explain why. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { icon, label, variant, size = "control", kind, on, busy, title, shortcut, className, children, disabled, onClick, ...rest },
  ref,
) {
  const tip = withShortcut(title, shortcut);
  const inert = disabled || busy;
  return (
    <button
      ref={ref}
      type="button"
      className={cx(
        size === "wide" ? "bc-wide-btn" : "bc-btn",
        size === "dense" && "bc-dense",
        variant === "primary" && (size === "wide" ? "bc-primary" : "bc-done"),
        variant === "secondary" && "bc-secondary",
        variant === "danger" && "bc-danger-btn",
        on && "bc-on",
        kind && (kind === "snap" ? "bc-snap-count" : "bc-" + kind),
        busy && "bc-busy",
        className,
      )}
      data-tip={tip}
      aria-label={!label && title ? title : undefined}
      aria-pressed={on === undefined ? undefined : on}
      aria-keyshortcuts={shortcut}
      aria-disabled={inert || undefined}
      aria-busy={busy || undefined}
      onClick={(e: MouseEvent<HTMLButtonElement>) => {
        if (inert) {
          e.preventDefault();
          return;
        }
        onClick?.(e);
      }}
      {...rest}
    >
      {icon && <Icon name={icon} size={16} />}
      {label && <span>{label}</span>}
      {children}
    </button>
  );
});

export interface ToolButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "title" | "onClick"> {
  icon: IconName;
  /** The tool's name: its accessible name and the start of its tooltip. */
  label: string;
  shortcut?: string;
  pressed?: boolean;
  onPress?: () => void;
  /** Show the label beside the icon (it hides under 640px). */
  showLabel?: boolean;
  /** The colour icon to draw (see Icon): on by default, or another colour icon's name. */
  colour?: boolean | string;
}

/** An icon tool button for a Toolbar: 32px, aria-pressed, tooltip "Label (K)". */
export const ToolButton = forwardRef<HTMLButtonElement, ToolButtonProps>(function ToolButton(
  { icon, label, shortcut, pressed, onPress, showLabel, colour = true, className, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className={cx("bc-btn bc-tool", pressed && "bc-on", className)}
      aria-pressed={pressed ?? false}
      aria-label={label}
      aria-keyshortcuts={shortcut}
      data-tip={withShortcut(label, shortcut)}
      onClick={onPress}
      {...rest}
    >
      <Icon name={icon} size={16} colour={colour} />
      {showLabel && <span>{label}</span>}
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
      data-tip={title}
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
