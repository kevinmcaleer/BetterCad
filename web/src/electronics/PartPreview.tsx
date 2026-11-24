import { useEffect, useRef } from "react";
import { boardPads, emptyDesign, footprintBox, placePart, pushToBoard, type ComponentDef } from "@bettercad/electronics";
import { readColours } from "./colours";
import { drawBoard } from "./drawBoard";
import { drawSymbol } from "./drawSchematic";
import { symbolBox } from "./hit";
import { fit } from "./view2d";

function canvasFor(el: HTMLCanvasElement | null): { ctx: CanvasRenderingContext2D; size: { w: number; h: number } } | null {
  if (!el) return null;
  const w = el.clientWidth;
  const h = el.clientHeight;
  if (w < 4 || h < 4) return null;
  const ratio = window.devicePixelRatio || 1;
  el.width = Math.round(w * ratio);
  el.height = Math.round(h * ratio);
  const ctx = el.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, size: { w, h } };
}

/** The symbol and the footprint of a part, side by side, drawn the way the views draw them. */
export function PartPreview({ def, pkg }: { def: ComponentDef; pkg: number }) {
  const sym = useRef<HTMLCanvasElement>(null);
  const fp = useRef<HTMLCanvasElement>(null);
  const choice = def.packages[pkg] ?? def.packages[0];
  useEffect(() => {
    const colours = readColours(sym.current);
    const s = canvasFor(sym.current);
    if (s) {
      const view = fit(symbolBox(def.symbol), s.size, undefined, 10);
      drawSymbol(s.ctx, { ...view, scale: Math.min(view.scale, 12) }, def.symbol, { x: 0, y: 0, rot: 0 }, colours, {});
    }
    const f = canvasFor(fp.current);
    if (f && choice) {
      // A one-part board, so the footprint is drawn by the same code as the PCB view.
      const one = placePart(emptyDesign(), "sh1", def, { x: 0, y: 0 }, { pkg });
      const made = pushToBoard(one.design).design;
      if (!made.board) return;
      const box = footprintBox(choice.footprint);
      const far = 1e4;
      const design = {
        ...made,
        board: {
          ...made.board,
          outline: [
            { x: -far, y: -far },
            { x: far, y: -far },
            { x: far, y: far },
            { x: -far, y: far },
          ],
          placements: made.board.placements.map((p) => ({ ...p, x: 0, y: 0, rot: 0 })),
        },
      };
      const view = fit(box, f.size, undefined, 10);
      drawBoard(f.ctx, { ...view, scale: Math.min(view.scale, 40) }, f.size, design, colours, {
        selected: new Set(),
        hidden: new Set(["edge", "ratsnest"]),
        active: "top",
        pads: boardPads(design),
        air: [],
      });
    }
  }, [def, pkg, choice]);
  return (
    <div className="bc-ec-preview">
      <figure>
        <canvas ref={sym} role="img" aria-label={`Symbol of ${def.name}`} />
        <figcaption>Symbol</figcaption>
      </figure>
      {choice && (
        <figure>
          <canvas ref={fp} role="img" aria-label={`Footprint ${choice.footprint.name}`} />
          <figcaption>Footprint</figcaption>
        </figure>
      )}
    </div>
  );
}
