import type { PathCommand } from "@bettercad/sketch";
import type { V2 } from "@bettercad/kernel/view";
import { cubics, roundOf, type Scene } from "./scene";
import { grouped } from "./svg";

/**
 * A scene as a one-page vector PDF (#569), written by hand: a drawing needs only lines, curves and filled letter
 * outlines, which is a few dozen lines of PDF rather than a library. The page is the sheet's exact size, lines keep
 * their paper widths, and text goes as outlines so it looks the same everywhere.
 */
const PT = 72 / 25.4;
const n = (v: number) => {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? "0" : String(r);
};
const p = (q: V2) => `${n(q[0])} ${n(q[1])}`;
/** A PDF text string: brackets and backslashes escaped, anything outside Latin-1 left out. */
const str = (s: string) =>
  `(${[...s]
    .filter((c) => c.charCodeAt(0) < 256)
    .join("")
    .replace(/[\\()]/g, "\\$&")})`;

/** The page's drawing instructions, in millimetres (the page is scaled once at the start). */
export function pdfContent(scene: Scene, outlines: PathCommand[]): string {
  const out: string[] = [`q ${n(PT)} 0 0 ${n(PT)} 0 0 cm`, "0 G 0 g 1 j"];
  for (const g of grouped(scene.strokes)) {
    // Dashes end square, as hidden lines are drawn on the sheet; solid lines end round.
    out.push(`${n(g.width)} w ${g.dash ? `0 J [${g.dash.map(n).join(" ")}] 0 d` : "1 J [] 0 d"}`);
    for (const s of g.strokes) {
      const c = s.curve;
      if (c.kind === "line") out.push(`${p(c.a)} m ${p(c.b)} l S`);
      else if (c.kind === "poly") {
        if (c.pts.length < 2) continue;
        const first = c.pts[0]!;
        const last = c.pts[c.pts.length - 1]!;
        const closed = c.pts.length > 2 && first[0] === last[0] && first[1] === last[1];
        const pts = closed ? c.pts.slice(0, -1) : c.pts;
        out.push(`${pts.map((q, i) => `${p(q)} ${i ? "l" : "m"}`).join(" ")} ${closed ? "s" : "S"}`);
      } else {
        const r = roundOf(c);
        const { start, pieces } = cubics(r);
        out.push(`${p(start)} m ${pieces.map((b) => `${p(b[0])} ${p(b[1])} ${p(b[2])} c`).join(" ")} ${r.sweep >= Math.PI * 2 - 1e-9 ? "s" : "S"}`);
      }
    }
  }
  if (outlines.length) {
    let at: V2 = [0, 0];
    const text: string[] = [];
    for (const c of outlines) {
      if (c.type === "Z") text.push("h");
      else if (c.type === "C") text.push(`${n(c.x1)} ${n(c.y1)} ${n(c.x2)} ${n(c.y2)} ${n(c.x)} ${n(c.y)} c`);
      else if (c.type === "Q") {
        // A quadratic curve as the cubic that draws the same line.
        const c1: V2 = [at[0] + (2 / 3) * (c.x1 - at[0]), at[1] + (2 / 3) * (c.y1 - at[1])];
        const c2: V2 = [c.x + (2 / 3) * (c.x1 - c.x), c.y + (2 / 3) * (c.y1 - c.y)];
        text.push(`${p(c1)} ${p(c2)} ${n(c.x)} ${n(c.y)} c`);
      } else text.push(`${n(c.x)} ${n(c.y)} ${c.type === "M" ? "m" : "l"}`);
      if (c.type !== "Z") at = [c.x, c.y];
    }
    out.push(`${text.join(" ")} f`);
  }
  out.push("Q");
  return out.join("\n") + "\n";
}

export interface PdfInfo {
  title?: string;
  author?: string;
}

/**
 * The page's instructions squeezed with deflate, which every PDF reader undoes; a sheet's worth of letter outlines
 * is about a fifth of the size. Nothing comes back where the browser can't do it, and the file is written plain.
 */
export async function deflated(content: string): Promise<Uint8Array | undefined> {
  if (typeof CompressionStream === "undefined") return undefined;
  const squeeze = new CompressionStream("deflate");
  const writer = squeeze.writable.getWriter();
  void writer.write(new TextEncoder().encode(content));
  void writer.close();
  const chunks: Uint8Array[] = [];
  const reader = squeeze.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value as Uint8Array);
  }
  const out = new Uint8Array(chunks.reduce((sum, c) => sum + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/**
 * The whole file. Everything but a squeezed stream is ASCII, so offsets in the cross-reference table are byte counts.
 * `packed` is `deflated(pdfContent(scene, outlines))`; left out, the stream is written as it is.
 */
export function scenePdf(scene: Scene, outlines: PathCommand[], info: PdfInfo = {}, packed?: Uint8Array): Uint8Array {
  const enc = new TextEncoder();
  const stream = packed ?? enc.encode(pdfContent(scene, outlines));
  const box = `[0 0 ${n(scene.w * PT)} ${n(scene.h * PT)}]`;
  const meta = [`/Producer (BetterCad)`, info.title ? `/Title ${str(info.title)}` : "", info.author ? `/Author ${str(info.author)}` : ""]
    .filter(Boolean)
    .join(" ");
  const objects: (string | Uint8Array)[][] = [
    [`<< /Type /Catalog /Pages 2 0 R >>`],
    [`<< /Type /Pages /Kids [3 0 R] /Count 1 >>`],
    [`<< /Type /Page /Parent 2 0 R /MediaBox ${box} /Contents 4 0 R /Resources << >> >>`],
    [`<< /Length ${stream.length}${packed ? " /Filter /FlateDecode" : ""} >>\nstream\n`, stream, `${packed ? "\n" : ""}endstream`],
    [`<< ${meta} >>`],
  ];
  const parts: Uint8Array[] = [];
  let at = 0;
  const put = (piece: string | Uint8Array) => {
    const b = typeof piece === "string" ? enc.encode(piece) : piece;
    parts.push(b);
    at += b.length;
  };
  put("%PDF-1.4\n");
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(at);
    put(`${i + 1} 0 obj\n`);
    body.forEach(put);
    put("\nendobj\n");
  });
  const xref = at;
  put(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`);
  put(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const file = new Uint8Array(at);
  let o = 0;
  for (const b of parts) {
    file.set(b, o);
    o += b.length;
  }
  return file;
}
