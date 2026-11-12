import { useSyncExternalStore } from "react";
import { ICONS, type IconName } from "./icons";

export interface IconProps {
  /** One of the names in ICONS. Unknown names fall back to "more". */
  name?: IconName;
  /** A path from a named import (`import { extrude } from "@bettercad/ui/icons"`), so only that icon ships. */
  path?: string;
  /** Pixels: 16 in buttons, 18 in titles. */
  size?: number;
  className?: string;
  /** Gives the icon an accessible name; otherwise it is hidden from screen readers. */
  title?: string;
  /**
   * Draw the colour tool icon (a muted solid with one highlight) when there is one: true for the one named `name`,
   * or the colour icon's own name ("sk-tangent"). The line icon shows until the colour set has loaded.
   */
  colour?: boolean | string;
}

// The colour set loads after first paint, the first time one is asked for.
let colours: Record<string, string> | null = null;
let loading = false;
const waiting = new Set<() => void>();
function subscribe(fn: () => void) {
  waiting.add(fn);
  if (!loading) {
    loading = true;
    void import("./colourIcons").then((m) => {
      colours = m.colourIcons();
      waiting.forEach((f) => f());
    });
  }
  return () => void waiting.delete(fn);
}
const none = () => null;
const noSubscribe = () => () => {};

/** A line icon drawn in currentColor, or a colour tool icon. Decorative: label the control that holds it instead. */
export function Icon({ name, path, size = 16, className, title, colour }: IconProps) {
  const set = useSyncExternalStore(colour ? subscribe : noSubscribe, colour ? () => colours : none);
  const art = set?.[typeof colour === "string" ? colour : (name ?? "")];
  const d = path ?? (name && ICONS[name]) ?? ICONS.more;
  return (
    <svg
      className={"bc-icon" + (art ? " bc-icon-colour" : "") + (className ? " " + className : "")}
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
      {art ? <g stroke="none" strokeWidth={0.9} dangerouslySetInnerHTML={{ __html: art }} /> : <path d={d} />}
    </svg>
  );
}
