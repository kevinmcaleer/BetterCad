/**
 * The Render view's backgrounds: what is behind the model and what it stands on, separate from the lighting. The
 * Holodeck takes its black room and yellow grid from the Holodeck theme's own colours.
 */
import { CanvasTexture, EquirectangularReflectionMapping, RepeatWrapping, SRGBColorSpace, type Texture } from "three";
import { GradientEquirectTexture } from "three-gpu-pathtracer";
import { COLOURS } from "@bettercad/ui";
import type { BackgroundId } from "./session";

export const BACKGROUNDS: { id: BackgroundId; label: string; title: string }[] = [
  { id: "lightbox", label: "Lightbox", title: "A seamless white sweep" },
  { id: "grey", label: "Grey table", title: "A mid grey table that shows a reflection" },
  { id: "workbench", label: "Workbench", title: "A wooden bench in a warm room" },
  { id: "holodeck", label: "Holodeck", title: "A black room with a yellow grid" },
];

/** The floor's look: colour, roughness, and the grid it carries, if any. Picture values, not interface colours. */
export interface Floor {
  colour: number;
  roughness: number;
  /** A grid texture, repeated every `cell` millimetres. */
  grid?: { map: Texture; cell: number };
}

const HOLO = COLOURS.holodeck;

/** One floor tile of the Holodeck grid: 100 mm, a minor line every 10 mm and a bright line round the edge. */
function holodeckTile(): CanvasTexture {
  const px = 512;
  const c = document.createElement("canvas");
  c.width = c.height = px;
  const g = c.getContext("2d")!;
  g.fillStyle = HOLO.room;
  g.fillRect(0, 0, px, px);
  g.fillStyle = HOLO.grid;
  for (let i = 1; i < 10; i++) {
    g.fillRect((i * px) / 10 - 1, 0, 2, px);
    g.fillRect(0, (i * px) / 10 - 1, px, 2);
  }
  g.fillStyle = HOLO["grid-major"];
  g.fillRect(0, 0, 3, px);
  g.fillRect(px - 3, 0, 3, px);
  g.fillRect(0, 0, px, 3);
  g.fillRect(0, px - 3, px, 3);
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/**
 * The Holodeck's walls and ceiling, as seen from inside a cube room: an equirectangular picture with a grid line
 * wherever a direction meets the cube near a cell boundary. Black between the lines.
 */
function holodeckRoom(): CanvasTexture {
  const w = 1024,
    h = 512,
    cells = 12;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  const img = g.createImageData(w, h);
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const minor = rgb(HOLO.grid),
    major = rgb(HOLO["grid-major"]),
    room = rgb(HOLO.room);
  for (let y = 0; y < h; y++) {
    const lat = Math.PI / 2 - ((y + 0.5) / h) * Math.PI;
    for (let x = 0; x < w; x++) {
      const lon = ((x + 0.5) / w) * Math.PI * 2 - Math.PI;
      const d = [Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)];
      // Where the ray meets the cube, and its two coordinates across that face, in cells.
      const m = Math.max(Math.abs(d[0]), Math.abs(d[1]), Math.abs(d[2]));
      const p = d.map((v) => v / m);
      const across = [0, 1, 2].filter((i) => Math.abs(p[i]) < 1 - 1e-9 || Math.abs(d[i]) !== m);
      // Lines thicken towards the face's edges, where the picture is stretched, so they look even.
      const width = 0.02 / m;
      let col = room;
      for (const i of across) {
        const s = ((p[i] + 1) / 2) * cells;
        const n = Math.round(s);
        if (Math.abs(s - n) < width * cells * 0.5) col = n % (cells / 2) === 0 || col === major ? major : minor;
      }
      const k = (y * w + x) * 4;
      img.data[k] = col[0];
      img.data[k + 1] = col[1];
      img.data[k + 2] = col[2];
      img.data[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new CanvasTexture(c);
  t.mapping = EquirectangularReflectionMapping;
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** Makes each background's sky (what the camera sees past the floor) and floor, once, on first use. */
export class Backgrounds {
  private made = new Map<BackgroundId, { sky: Texture; floor: Floor }>();

  get(id: BackgroundId): { sky: Texture; floor: Floor } {
    let b = this.made.get(id);
    if (!b) this.made.set(id, (b = make(id)));
    return b;
  }

  dispose(): void {
    for (const b of this.made.values()) {
      b.sky.dispose();
      b.floor.grid?.map.dispose();
    }
    this.made.clear();
  }
}

function gradient(top: number, bottom: number): Texture {
  const t = new GradientEquirectTexture();
  t.topColor.set(top);
  t.bottomColor.set(bottom);
  t.update();
  return t;
}

function make(id: BackgroundId): { sky: Texture; floor: Floor } {
  switch (id) {
    case "lightbox":
      return { sky: gradient(0xffffff, 0xf4f4f4), floor: { colour: 0xffffff, roughness: 1 } };
    case "grey":
      return { sky: gradient(0xb9bcc1, 0x6d7075), floor: { colour: 0x8a8d91, roughness: 0.45 } };
    case "workbench":
      return { sky: gradient(0xf7e9d6, 0x5a4a3c), floor: { colour: 0xb08a63, roughness: 0.8 } };
    case "holodeck":
      return { sky: holodeckRoom(), floor: { colour: 0xffffff, roughness: 0.6, grid: { map: holodeckTile(), cell: 100 } } };
  }
}
