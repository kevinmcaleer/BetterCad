import { useEffect, useRef } from "react";
import { boardPads, emptyDesign, footprintBox, placePart, pushToBoard, type ComponentDef, type Model3D } from "@bettercad/electronics";
import { readColours } from "./colours";
import { drawBoard } from "./drawBoard";
import { drawSymbol } from "./drawSchematic";
import { symbolBox } from "./hit";
import { turnedBox } from "./partDraft";
import { fit, toScreen } from "./view2d";

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

/** A body's outline seen from above, on the footprint: a file's box after its turns, a box, or a cylinder's circle. */
export function bodyOutline(model: Model3D | undefined): { x1: number; y1: number; x2: number; y2: number; round?: boolean } | null {
  const src = model?.source;
  const [x, y] = model?.offset ?? [0, 0];
  if (src?.kind === "step" && src.size) {
    const b = turnedBox(src.size, model?.rotate ?? [0, 0, 0]);
    return { x1: x + b.min[0], y1: y + b.min[1], x2: x + b.max[0], y2: y + b.max[1] };
  }
  // A robot catalogue part's box is kept as it lies once turned.
  if (src?.kind === "catalogue") return { x1: x - src.size[0] / 2, y1: y - src.size[1] / 2, x2: x + src.size[0] / 2, y2: y + src.size[1] / 2 };
  if (src?.kind === "box" && model?.offset) return { x1: x - src.size[0] / 2, y1: y - src.size[1] / 2, x2: x + src.size[0] / 2, y2: y + src.size[1] / 2 };
  if (src?.kind === "cylinder" && model?.offset)
    return { x1: x - src.diameter / 2, y1: y - src.diameter / 2, x2: x + src.diameter / 2, y2: y + src.diameter / 2, round: true };
  return null;
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
      // A body with a place of its own (#628) is outlined from above, see-through, so the pads show under it.
      const body = bodyOutline(choice.model);
      const all = body ? { x1: Math.min(box.x1, body.x1), y1: Math.min(box.y1, body.y1), x2: Math.max(box.x2, body.x2), y2: Math.max(box.y2, body.y2) } : box;
      const fitted = fit(all, f.size, undefined, 10);
      const view = { ...fitted, scale: Math.min(fitted.scale, 40) };
      drawBoard(f.ctx, view, f.size, design, colours, {
        selected: new Set(),
        hidden: new Set(["edge", "ratsnest"]),
        active: "top",
        pads: boardPads(design),
        air: [],
      });
      if (body) {
        const a = toScreen(view, [body.x1, body.y2]);
        const z = toScreen(view, [body.x2, body.y1]);
        const { ctx } = f;
        ctx.save();
        ctx.fillStyle = colours["ec-pcb-ink"];
        ctx.strokeStyle = colours["ec-pcb-ink"];
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 3]);
        ctx.beginPath();
        if (body.round) ctx.ellipse((a[0] + z[0]) / 2, (a[1] + z[1]) / 2, (z[0] - a[0]) / 2, (z[1] - a[1]) / 2, 0, 0, Math.PI * 2);
        else ctx.rect(a[0], a[1], z[0] - a[0], z[1] - a[1]);
        ctx.globalAlpha = 0.18;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.stroke();
        ctx.restore();
      }
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
          <figcaption>{bodyOutline(choice.model) ? "Footprint and body" : "Footprint"}</figcaption>
        </figure>
      )}
    </div>
  );
}
