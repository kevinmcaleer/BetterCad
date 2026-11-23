import type { V2 } from "@bettercad/kernel/view";
import type { CutArt } from "./cuts";

/** What an armed cut tool would do where the pointer is, in paper mm from the view's middle, y up. */
export type CutGhost =
  { kind: "line"; a: V2; b: V2; side: V2 } | { kind: "ring"; c: V2; r: number } | { kind: "band"; x: number; y: number; w: number; h: number };

const n = (v: number) => String(Math.round(v * 1000) / 1000);
const pts = (list: V2[]) => list.map((p) => `${n(p[0])},${n(-p[1])}`).join(" ");

/**
 * A view's cutting lines, detail circles and letters (#571), and its own caption, over its lines. Drawn only: a
 * section or detail is changed from its own view.
 */
export function CutLayer({ art, ghost }: { art: CutArt; ghost?: CutGhost }) {
  return (
    <g className="bc-cut" aria-hidden="true">
      {art.chain.map(([a, b], i) => (
        <line key={`c${i}`} className="bc-cut-chain" x1={a[0]} y1={-a[1]} x2={b[0]} y2={-b[1]} />
      ))}
      {art.thick.map(([a, b], i) => (
        <line key={`t${i}`} className="bc-cut-thick" x1={a[0]} y1={-a[1]} x2={b[0]} y2={-b[1]} />
      ))}
      {art.arrows.map((a, i) => (
        <polygon key={`a${i}`} className="bc-cut-arrow" points={pts(a)} />
      ))}
      {art.rings.map((r, i) => (
        <circle key={`r${i}`} className="bc-cut-ring" cx={r.c[0]} cy={-r.c[1]} r={r.r} />
      ))}
      {art.labels.map((l, i) => (
        <text key={`l${i}`} className="bc-cut-text" x={l.at[0]} y={-l.at[1]} fontSize={l.size}>
          {l.text}
        </text>
      ))}
      {ghost?.kind === "line" && (
        <>
          <line className="bc-cut-ghost" x1={ghost.a[0]} y1={-ghost.a[1]} x2={ghost.b[0]} y2={-ghost.b[1]} />
          {[ghost.a, ghost.b].map((p, i) => (
            <line key={i} className="bc-cut-ghost" x1={p[0]} y1={-p[1]} x2={p[0] + ghost.side[0] * 6} y2={-(p[1] + ghost.side[1] * 6)} />
          ))}
        </>
      )}
      {ghost?.kind === "ring" && <circle className="bc-cut-ghost" cx={ghost.c[0]} cy={-ghost.c[1]} r={ghost.r} />}
      {ghost?.kind === "band" && <rect className="bc-cut-ghost bc-cut-band" x={ghost.x} y={-ghost.y - ghost.h} width={ghost.w} height={ghost.h} />}
    </g>
  );
}
