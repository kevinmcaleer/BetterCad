import { CanvasTexture, Mesh, MeshBasicMaterial, PlaneGeometry, type Color } from "three";

/**
 * The build volume's name, written flat on the bed's front-left corner like Tinkercad's "Workplane": faint, italic,
 * reading from the front. A canvas texture, so it needs no font files; null where there is no 2D canvas (tests).
 */
export function bedLabelMesh(text: string, bedX: number, bedY: number, colour: Color): Mesh | null {
  const canvas = document.createElement("canvas");
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = canvas.getContext("2d");
  } catch {
    return null;
  }
  if (!ctx) return null;
  const px = 96;
  const family = getComputedStyle(document.documentElement).getPropertyValue("--bc-font-sans").trim() || "sans-serif";
  const font = `italic 700 ${px}px ${family}`;
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + px / 2;
  const h = Math.ceil(px * 1.3);
  canvas.width = w;
  canvas.height = h;
  ctx.font = font;
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#fff"; // a mask: the material's colour, from the palette, tints it
  ctx.fillText(text, px / 4, h / 2);
  const tex = new CanvasTexture(canvas);
  tex.anisotropy = 8;
  // Up to half the bed's width, and no taller than a fifteenth of its depth.
  const margin = Math.min(bedX, bedY) * 0.04;
  let width = bedX * 0.5;
  let height = (width * h) / w;
  if (height > bedY / 15) {
    height = bedY / 15;
    width = (height * w) / h;
  }
  const mesh = new Mesh(
    new PlaneGeometry(width, height).translate(width / 2, height / 2, 0),
    new MeshBasicMaterial({ color: colour, map: tex, transparent: true, opacity: 0.35, depthWrite: false }),
  );
  mesh.name = "bed-label";
  mesh.position.set(-bedX / 2 + margin, -bedY / 2 + margin, 0.06);
  mesh.renderOrder = -0.4;
  return mesh;
}
