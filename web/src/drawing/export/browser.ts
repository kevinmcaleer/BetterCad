/**
 * The two exports only a browser can make (#569): a picture of the sheet, and its print. Both start from the SVG
 * with its text as outlines, so no font has to load.
 */

/** Pixels for a page of millimetres at a dots-per-inch. */
export const pixels = (mm: { w: number; h: number }, dpi: number) => ({ w: Math.round((mm.w / 25.4) * dpi), h: Math.round((mm.h / 25.4) * dpi) });

/** The SVG drawn onto a canvas of the size it says, as a PNG. */
export async function svgPng(svg: string, size: { w: number; h: number }): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.decoding = "async";
    await new Promise<void>((done, fail) => {
      img.onload = () => done();
      img.onerror = () => fail(new Error("The picture could not be drawn."));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = size.w;
    canvas.height = size.h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("The picture could not be drawn.");
    ctx.drawImage(img, 0, 0, size.w, size.h);
    return await new Promise<Blob>((done, fail) =>
      canvas.toBlob((b) => (b ? done(b) : fail(new Error("The picture is too big for this browser."))), "image/png"),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** The page a print is made from: just the sheet, at its own size, with no margins. */
export function printPage(svg: string, mm: { w: number; h: number }, title: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>@page{size:${mm.w}mm ${mm.h}mm;margin:0}html,body{margin:0;padding:0}svg{display:block;width:${mm.w}mm;height:${mm.h}mm}</style></head><body>${svg}</body></html>`;
}

/** Opens the browser's print dialog on the sheet alone, from a frame that is taken away afterwards. */
export function printSvg(svg: string, mm: { w: number; h: number }, title: string): void {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  frame.srcdoc = printPage(svg, mm, title);
  frame.onload = () => {
    const win = frame.contentWindow;
    if (!win) return frame.remove();
    win.addEventListener("afterprint", () => frame.remove());
    win.focus();
    win.print();
  };
  document.body.appendChild(frame);
}
