import { ICONS, type IconName } from "./icons";

export interface IconProps {
  /** One of the names in ICONS. Unknown names fall back to "more". */
  name: IconName;
  /** Pixels: 16 in buttons, 18 in titles. */
  size?: number;
  className?: string;
  /** Gives the icon an accessible name; otherwise it is hidden from screen readers. */
  title?: string;
}

/** A line icon drawn in currentColor. Decorative: label the control that holds it instead. */
export function Icon({ name, size = 16, className, title }: IconProps) {
  const d = ICONS[name] ?? ICONS.more;
  return (
    <svg
      className={"bc-icon" + (className ? " " + className : "")}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      aria-label={title}
      focusable="false"
      data-icon={name}
    >
      {title && <title>{title}</title>}
      <path d={d} />
    </svg>
  );
}
