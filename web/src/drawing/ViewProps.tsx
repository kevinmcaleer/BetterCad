import { useId } from "react";
import { NumberField, PropsPanel } from "@bettercad/ui";
import type { DrawingSheet, ViewStyle } from "@bettercad/kernel/drawing";
import { scaleLabel, styleOf, VIEW_STYLES, viewName, viewScale } from "./DrawingView";

export interface ViewPropsProps {
  sheet: DrawingSheet;
  /** The view selected on the sheet. */
  view: string;
  onSheet: (change: (s: DrawingSheet) => DrawingSheet, label: string) => void;
}

/** What each style draws, under the list. */
const SAYS: Record<ViewStyle, string> = {
  lineart: "The edges you see, and hidden ones dashed when the view has them on.",
  wireframe: "Every edge, solid, including the ones behind.",
  shaded: "The bodies in their colours, under the edges you see.",
  rendered:
    "Path traced in each body's colour and finish, with no lines. It takes a few seconds and shows shaded until it is ready. Without a graphics card it stays shaded.",
};

/**
 * Properties of a view selected on a drawing sheet (Kev, 2026-11-24): its style. A projected view that had its
 * parent's style follows the parent when that changes. Sections and details are always line art.
 */
export function ViewProps({ sheet, view: id, onSheet }: ViewPropsProps) {
  const field = useId();
  const v = sheet.views.find((x) => x.id === id);
  if (!v) return null;
  const styled = v.kind === "base" || v.kind === "projected";
  const style = styleOf(v);
  const set = (next: ViewStyle) =>
    onSheet((s) => {
      const before = s.views.find((x) => x.id === id);
      if (!before) return s;
      // Projected views still in its old style take the new one too, and those projected from them.
      const was = styleOf(before);
      const follows = new Set([id]);
      for (let grew = true; grew;) {
        grew = false;
        for (const x of s.views)
          if (!follows.has(x.id) && x.kind === "projected" && x.parent && follows.has(x.parent) && styleOf(x) === was) grew = !!follows.add(x.id);
      }
      return {
        ...s,
        views: s.views.map((x) => {
          if (!follows.has(x.id)) return x;
          const out = { ...x };
          if (next === "lineart") delete out.style;
          else out.style = next;
          return out;
        }),
      };
    }, "Set the view style");
  const explode = Math.round((v.explode ?? 0) * 100);
  const spread = (percent: number) =>
    onSheet((s) => {
      const before = s.views.find((x) => x.id === id);
      if (!before) return s;
      const next = Math.min(Math.max(percent, 0), 500) / 100;
      // Views projected from it that were as far apart stay in step with it.
      const follows = new Set([id]);
      for (let grew = true; grew;) {
        grew = false;
        for (const x of s.views)
          if (!follows.has(x.id) && x.kind === "projected" && x.parent && follows.has(x.parent) && (x.explode ?? 0) === (before.explode ?? 0))
            grew = !!follows.add(x.id);
      }
      return {
        ...s,
        views: s.views.map((x) => {
          if (!follows.has(x.id)) return x;
          const out = { ...x };
          if (next > 0) out.explode = next;
          else delete out.explode;
          return out;
        }),
      };
    }, "Explode the view");
  return (
    <PropsPanel
      sections={[
        {
          id: "drawing-view",
          title: viewName(v),
          content: (
            <>
              <dl className="bc-facts">
                <dt>Scale</dt>
                <dd>{scaleLabel(viewScale(sheet, v))}</dd>
              </dl>
              {styled ? (
                <>
                  <label className="bc-field-label" htmlFor={field}>
                    Style
                  </label>
                  <select id={field} className="bc-select" value={style} onChange={(e) => set(e.target.value as ViewStyle)}>
                    {VIEW_STYLES.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                  <p className="bc-note">
                    {(v.breaks?.length || v.explode) && (style === "shaded" || style === "rendered")
                      ? `${v.explode ? "An exploded view" : "A view with breaks"} is drawn as line art.`
                      : SAYS[style]}
                  </p>
                  <NumberField label="Explode" value={explode} unit="%" min={0} max={500} step={10} onCommit={spread} />
                  <p className="bc-note">
                    {explode
                      ? "Parts are moved out from the middle. Sizes between two parts are not the model's."
                      : "Above 0 %, each part moves out from the middle so you can see how they go together."}
                  </p>
                </>
              ) : (
                <p className="bc-note">{v.kind === "section" ? "Section views" : "Detail views"} are always drawn as line art.</p>
              )}
            </>
          ),
        },
      ]}
    />
  );
}
