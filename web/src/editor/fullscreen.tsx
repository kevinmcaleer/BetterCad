import { useEffect, useState } from "react";
import { Button } from "@bettercad/ui";

/**
 * Full screen for phones and tablets: hides the browser's own bars so the view gets the whole screen. Uses the
 * Fullscreen API, with Safari's webkit names (iPadOS Safari has element full screen under the prefix). iPhone Safari
 * has none, so there the button explains Add to Home Screen instead; the installed app opens without browser bars
 * (manifest display "standalone"). Esc, the system back gesture and the button all leave it. Loaded lazily: the
 * start-up bundle only holds the import.
 */
const d = document as Document & Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export type Say = (text: string, bad?: boolean) => void;

/** Whether this browser can put the page in full screen. */
export const canFullscreen = (): boolean => !!(d.fullscreenEnabled || d.webkitFullscreenEnabled);

export const isFullscreen = (): boolean => !!(d.fullscreenElement || d.webkitFullscreenElement);

/** Enters or leaves full screen. Resolves false when the browser has no full screen. */
export async function toggleFullscreen(): Promise<boolean> {
  const el = d.documentElement as HTMLElement & Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (isFullscreen()) await (d.exitFullscreen || d.webkitExitFullscreen).call(d);
  else if (!canFullscreen()) return false;
  else await (el.requestFullscreen || el.webkitRequestFullscreen).call(el, { navigationUI: "hide" });
  return true;
}

/** The Full screen command: where there is no full screen (iPhone Safari), it says how to install for one. */
export const switchFullscreen = (say: Say) =>
  toggleFullscreen().then(
    (ok) => ok || say("For the full screen, tap Share, then Add to Home Screen."),
    () => say("Full screen is not available here.", true),
  );

/** Tracks full screen however it is left (Esc, a swipe, the button). */
export function useFullscreen(): boolean {
  const [on, setOn] = useState(isFullscreen);
  useEffect(() => {
    const sync = () => setOn(isFullscreen());
    const names = ["fullscreenchange", "webkitfullscreenchange"];
    names.forEach((n) => d.addEventListener(n, sync));
    return () => names.forEach((n) => d.removeEventListener(n, sync));
  }, []);
  return on;
}

/** The view bar's button. Left out where there is neither full screen nor a Home Screen to install to. */
export default function FullscreenButton({ say }: { say: Say }) {
  const on = useFullscreen();
  if (!canFullscreen() && window.matchMedia?.("(display-mode: standalone)").matches) return null;
  return <Button icon={on ? "shrink" : "expand"} title="Full screen" on={on} onClick={() => void switchFullscreen(say)} />;
}
