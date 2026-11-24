import { useId } from "react";
import { PropsPanel } from "@bettercad/ui";
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
                    {v.breaks?.length && (style === "shaded" || style === "rendered") ? "A view with breaks is drawn as line art." : SAYS[style]}
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
