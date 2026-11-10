/**
 * The Render view's backgrounds: what is behind the model and what it stands on, separate from the lighting. The
 * Holoroom takes its black room and yellow grid from the Holoroom theme's own colours.
 */
import { CanvasTexture, RepeatWrapping, SRGBColorSpace, type MeshStandardMaterial, type Texture } from "three";
import { GradientEquirectTexture } from "three-gpu-pathtracer";
import { COLOURS } from "@bettercad/ui";
import type { BackgroundId } from "./session";

export const BACKGROUNDS: { id: BackgroundId; label: string; title: string }[] = [
  { id: "lightbox", label: "Lightbox", title: "A seamless white sweep" },
  { id: "grey", label: "Grey table", title: "A mid grey table that shows a reflection" },
  { id: "workbench", label: "Workbench", title: "A wooden bench in a warm room" },
  { id: "holoroom", label: "Holoroom", title: "A black room with a yellow grid" },
  { id: "replicator", label: "Replicator", title: "A bright floor lit from below, with a grey grid" },
];

/** The floor's look: colour, roughness, and the grid it carries, if any. Picture values, not interface colours. */
export interface Floor {
  colour: number;
  roughness: number;
  /** A grid texture, repeated every `cell` millimetres. */
  grid?: { map: Texture; cell: number };
  /** How brightly the grid texture glows, so the floor lights the model from below. 0.6 when left out. */
  glow?: number;
}

const HOLO = COLOURS.holoroom;

/** One floor tile of the Holoroom grid: 100 mm, a minor line every 10 mm and a bright line round the edge. */
function holoroomTile(): CanvasTexture {
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
 * One floor tile of the Replicator pad: 50 mm of near-white panel with a soft grey line every 10 mm and a darker
 * seam round the edge. The panel glows, so the floor reads as lit from underneath.
 */
function replicatorTile(): CanvasTexture {
  const px = 512;
  const c = document.createElement("canvas");
  c.width = c.height = px;
  const g = c.getContext("2d")!;
  // A faint radial falloff inside each panel, brightest in the middle, like light diffusing through frosted glass.
  const glow = g.createRadialGradient(px / 2, px / 2, px * 0.05, px / 2, px / 2, px * 0.75);
  glow.addColorStop(0, "#ffffff");
  glow.addColorStop(1, "#e6eaee");
  g.fillStyle = glow;
  g.fillRect(0, 0, px, px);
  g.fillStyle = "#a9afb5";
  for (let i = 1; i < 5; i++) {
    g.fillRect((i * px) / 5 - 2, 0, 4, px);
    g.fillRect(0, (i * px) / 5 - 2, px, 4);
  }
  g.fillStyle = "#7d838a";
  g.fillRect(0, 0, 4, px);
  g.fillRect(px - 4, 0, 4, px);
  g.fillRect(0, 0, px, 4);
  g.fillRect(0, px - 4, px, 4);
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/**
 * Gives a wall or roof its own copy of `grid`, so it repeats on its own, and returns that copy. The copy is made
 * again when the grid changes: the walls must carry the Holoroom grid even when another gridded floor (Replicator's
 * white panels) was shown first.
 */
export function wallGrid(material: MeshStandardMaterial, grid: Texture): Texture {
  let copy = material.map;
  if (!copy || copy.userData.from !== grid) {
    copy?.dispose();
    copy = grid.clone();
    copy.userData = { from: grid };
    material.map = copy;
  }
  material.emissiveMap = copy;
  material.needsUpdate = true;
  return copy;
}

export interface Background {
  /** What the camera sees past the floor (and past the walls' tops). */
  sky: Texture;
  floor: Floor;
  /** Holoroom: grid walls and a roof round the model, in the floor's grid. */
  walls?: boolean;
}

/** Makes each background's sky (what the camera sees past the floor) and floor, once, on first use. */
export class Backgrounds {
  private made = new Map<BackgroundId, Background>();

  get(id: BackgroundId): Background {
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

function make(id: BackgroundId): Background {
  switch (id) {
    case "lightbox":
      return { sky: gradient(0xffffff, 0xf4f4f4), floor: { colour: 0xffffff, roughness: 1 } };
    case "grey":
      return { sky: gradient(0xb9bcc1, 0x6d7075), floor: { colour: 0x8a8d91, roughness: 0.45 } };
    case "workbench":
      return { sky: gradient(0xf7e9d6, 0x5a4a3c), floor: { colour: 0xb08a63, roughness: 0.8 } };
    case "holoroom":
      // Black beyond the room; real gridded walls and a roof round the model. The roof lets the light through.
      return { sky: gradient(0x000000, 0x000000), floor: { colour: 0xffffff, roughness: 0.6, grid: { map: holoroomTile(), cell: 100 } }, walls: true };
    case "replicator":
      // A pale haze beyond a glowing, gridded pad; the pad's light comes up under the model.
      return { sky: gradient(0xf2f4f6, 0xc9ced3), floor: { colour: 0xffffff, roughness: 0.35, grid: { map: replicatorTile(), cell: 50 }, glow: 1.1 } };
  }
}
