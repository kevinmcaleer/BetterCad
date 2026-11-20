import { useEffect } from "react";
import type * as React from "react";

declare module "react" {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      "kr-app-switcher": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & { app?: string; target?: string };
    }
  }
}

/**
 * The kevsrobots apps switcher: a 3 by 3 button beside the logo listing Learn, Projects, Snakie and BetterCad, with
 * BetterCad marked "you are here". The others open in a new tab so an unsaved model is never lost. Its colours come
 * from the theme tokens (`kr-app-switcher` in app.css), so it follows Light, Dark and Holoroom.
 */
export function AppSwitcher() {
  // The kevsrobots suite's shared web components (kevinmcaleer/kevsrobots.com#581), vendored so the switcher works offline
  // (the service worker precaches every chunk). The canonical copy is kevsrobots.com/web/assets/suite/kr-suite.js: change it
  // there first, then copy it here. It loads on the first pointer move, touch, key or focus, so it costs nothing while the
  // app starts; the element keeps its place (app.css) and upgrades when the code arrives.
  useEffect(() => {
    const events = ["pointermove", "pointerdown", "keydown", "focusin"] as const;
    const load = () => {
      for (const e of events) window.removeEventListener(e, load, true);
      void import("../vendor/kr-suite.js");
    };
    for (const e of events) window.addEventListener(e, load, { capture: true, passive: true });
    return () => {
      for (const e of events) window.removeEventListener(e, load, true);
    };
  }, []);
  return <kr-app-switcher app="bettercad" target="_blank" />;
}
