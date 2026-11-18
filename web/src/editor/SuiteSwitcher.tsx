import "../vendor/kr-suite.js";

/**
 * The kevsrobots suite switcher (kevsrobots.com#581, #505): Learn, Projects, Snakie and BetterCAD, the same
 * component kevsrobots.com and Snakie use. `vendor/kr-suite.js` is a bundled copy of
 * https://www.kevsrobots.com/assets/suite/kr-suite.js so it works offline; change it there first, then copy it.
 * Its colours come from our tokens (`.bc-suite` in app.css); only the four app marks keep their brand colours.
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
  return <kr-app-switcher className="bc-suite" app="bettercad" target="_blank" />;
}
