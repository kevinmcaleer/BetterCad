import { THEME_NAMES, cx } from "@bettercad/ui";
import type { ThemeSetting } from "../state/theme";

const OPTIONS: ThemeSetting[] = ["system", "light", "dark", "holoroom"];

/**
 * A segmented control for the theme. Each swatch previews its theme: Holoroom shows its black room and yellow grid,
 * never yellow as an accent.
 */
export function ThemePicker({ value, onChange, compact }: { value: ThemeSetting; onChange: (t: ThemeSetting) => void; compact?: boolean }) {
  return (
    <div className={cx("bc-theme-picker", compact && "bc-compact")} role="radiogroup" aria-label="Theme">
      {OPTIONS.map((t) => (
        <button
          key={t}
          type="button"
          role="radio"
          aria-checked={value === t}
          className={cx("bc-theme-opt", value === t && "bc-on")}
          onClick={() => onChange(t)}
          onKeyDown={(e) => {
            const i = OPTIONS.indexOf(t);
            const j = e.key === "ArrowRight" || e.key === "ArrowDown" ? i + 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? i - 1 : -99;
            if (j === -99) return;
            e.preventDefault();
            const next = OPTIONS[(j + OPTIONS.length) % OPTIONS.length]!;
            onChange(next);
            (e.currentTarget.parentElement?.children[OPTIONS.indexOf(next)] as HTMLElement | undefined)?.focus();
          }}
          tabIndex={value === t ? 0 : -1}
        >
          <span className="bc-swatch" data-theme={t === "system" ? undefined : t} data-swatch={t} aria-hidden="true" />
          <span>{t === "system" ? "System" : THEME_NAMES[t]}</span>
        </button>
      ))}
    </div>
  );
}
