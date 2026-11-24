import { useEffect, useRef, useState } from "react";
import { styleOf, viewScale, type DrawingSheet } from "@bettercad/kernel/drawing";
import type { ModelView } from "@bettercad/kernel/view";
import type { ViewPicture } from "./export/scene";
import type { PictureModel } from "./pictures";

/**
 * The pictures of a sheet's shaded and rendered views, by view id, as they become ready (`pictures.ts`, loaded the
 * first time a view needs one). A rendered view shows its shaded picture while the path tracer works. A view that
 * needs none, or has none yet, is drawn as line art.
 */
export function usePictures(sheet: DrawingSheet, viewOf: (id: string) => ModelView | undefined, model: PictureModel | undefined): Map<string, ViewPicture> {
  const [got, setGot] = useState<Map<string, ViewPicture>>(new Map());
  // Which views want a render now: one that is running stops when its view stops wanting it.
  const rendering = useRef(new Set<string>());
  useEffect(() => {
    rendering.current = new Set(model ? sheet.views.filter((v) => styleOf(v) === "rendered").map((v) => v.id) : []);
  }, [sheet, model]);
  useEffect(() => () => void (rendering.current = new Set()), []);
  const wants = sheet.views.some((v) => styleOf(v) === "shaded" || styleOf(v) === "rendered");
  useEffect(() => {
    if (!wants || !model) return setGot((g) => (g.size ? new Map() : g));
    let live = true;
    void import("./pictures").then(({ pictureStyle, viewPicture }) => {
      const keep = new Set<string>();
      for (const v of sheet.views) {
        const style = pictureStyle(v);
        const view = viewOf(v.id);
        if (!style || !view) continue;
        keep.add(v.id);
        const s = viewScale(sheet, v);
        const show = (p: ViewPicture | null) => live && p && setGot((g) => (g.get(v.id) === p ? g : new Map(g).set(v.id, p)));
        const shaded = viewPicture(model, view, v, s, "shaded");
        if (style === "shaded") void shaded.then(show);
        else void shaded.then((p) => show(p)).then(() => viewPicture(model, view, v, s, "rendered", () => rendering.current.has(v.id)).then(show));
      }
      if (live) setGot((g) => ([...g.keys()].some((id) => !keep.has(id)) ? new Map([...g].filter(([id]) => keep.has(id))) : g));
    });
    return () => {
      live = false;
    };
  }, [wants, sheet, viewOf, model]);
  return got;
}
