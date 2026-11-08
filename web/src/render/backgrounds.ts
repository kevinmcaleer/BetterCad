/**
 * The Render view's backgrounds: what is behind the model and what it stands on, separate from the lighting. The
 * Holodeck takes its black room and yellow grid from the Holodeck theme's own colours.
 */
import { CanvasTexture, RepeatWrapping, SRGBColorSpace, type Texture } from "three";
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

export interface Background {
  /** What the camera sees past the floor (and past the walls' tops). */
  sky: Texture;
  floor: Floor;
  /** Holodeck: grid walls round the model, in the floor's grid. */
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
    case "holodeck":
      // Black beyond the room; the walls are real gridded walls round the model, open to the light above.
      return { sky: gradient(0x000000, 0x000000), floor: { colour: 0xffffff, roughness: 0.6, grid: { map: holodeckTile(), cell: 100 } }, walls: true };
  }
}
