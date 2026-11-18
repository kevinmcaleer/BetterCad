import { useEffect } from "react";

/**
 * The kevsrobots suite switcher (kevsrobots.com#581, #505): Learn, Projects, Snakie and BetterCAD, the same
 * component kevsrobots.com and Snakie use. `vendor/kr-suite.js` is a bundled copy of
 * https://www.kevsrobots.com/assets/suite/kr-suite.js so it works offline; change it there first, then copy it.
 * Its colours come from our tokens (`.bc-suite` in app.css); only the four app marks keep their brand colours.
 * The script loads after first paint, in its own chunk (about 4.5 KB): until then the element keeps its space.
 */

declare module "react" {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      "kr-app-switcher": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & { app?: string; target?: string };
    }
  }
}

/** Other apps open in a new tab, so nothing unsaved here is lost. */
export function SuiteSwitcher() {
  useEffect(() => {
    void import("../vendor/kr-suite.js");
  }, []);
  return <kr-app-switcher className="bc-suite" app="bettercad" target="_blank" />;
}
