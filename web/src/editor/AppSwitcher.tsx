// The kevsrobots suite's shared web components (kevinmcaleer/kevsrobots.com#581). Vendored so the switcher
// works offline: the canonical copy is kevsrobots.com/web/assets/suite/kr-suite.js. Change it there first, then copy it here.
import type * as React from "react";
import "../vendor/kr-suite.js";

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
  return <kr-app-switcher app="bettercad" target="_blank" />;
}
