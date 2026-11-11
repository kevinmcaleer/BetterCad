import { BufferAttribute, BufferGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, SRGBColorSpace, Texture, type Plane } from "three";
import type { PlaneRef } from "@bettercad/sketch";
import type { BuiltConstruct } from "../state/document";
import { pointOnPicture, type Placement } from "../decal/place";
import { canvasFrame } from "../canvas/canvas";

/** A canvas (#248) for the view: its plane, where on it, how see-through, and its picture as a data: URL. */
export interface EngineCanvas {
  id: string;
  plane: PlaneRef;
  at: Placement;
  opacity: number;
  image: string;
}

/** Off its plane this far (mm), toward the viewer's side of a face, so it shows over the face and under the sketch. */
const LIFT = 0.01;

/**
 * Draws canvases as flat pictures on their planes, loaded with the first canvas so the first page load doesn't carry
 * it. They draw before everything see-through and never write depth, so sketch lines always draw over them.
 */
export class CanvasLayer {
  readonly group = new Group();
  private drawn = new Map<string, { key: string; mesh: Mesh }>();
  private textures = new Map<string, Texture>();

  constructor(private invalidate: () => void) {
    this.group.name = "canvases";
  }

  /** Shows these canvases; construction planes' frames come from `construct`, the steps as built. */
  set(list: EngineCanvas[], construct: BuiltConstruct[], clip: Plane[]): void {
    const framed = list.map((c) => ({ ...c, frame: canvasFrame(c.plane, construct) }));
    const keys = new Map(framed.map((c) => [c.id, JSON.stringify([c.frame, c.at, c.image])]));
    for (const [id, d] of this.drawn) if (keys.get(id) !== d.key) this.drop(id);
    for (const c of framed) {
      let d = this.drawn.get(c.id);
      if (!d) {
        d = { key: keys.get(c.id)!, mesh: this.make(c) };
        this.drawn.set(c.id, d);
        this.group.add(d.mesh);
      }
      const m = d.mesh.material as MeshBasicMaterial;
      m.opacity = c.opacity;
      m.clippingPlanes = clip;
    }
    const used = new Set(list.map((c) => c.image));
    for (const [url, t] of this.textures)
      if (!used.has(url)) {
        t.dispose();
        this.textures.delete(url);
      }
    this.invalidate();
  }

  private make(c: EngineCanvas & { frame: ReturnType<typeof canvasFrame> }): Mesh {
    const corners = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ] as const;
    const positions = new Float32Array(12);
    corners.forEach(([s, t], i) => {
      const p = pointOnPicture(c.frame, c.at, s, t);
      for (let k = 0; k < 3; k++) positions[i * 3 + k] = p[k]! + c.frame.normal[k]! * LIFT;
    });
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(positions, 3));
    g.setAttribute("uv", new BufferAttribute(new Float32Array(corners.flat()), 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.computeBoundingSphere();
    const mesh = new Mesh(g, new MeshBasicMaterial({ map: this.texture(c.image), transparent: true, depthWrite: false, side: DoubleSide, toneMapped: false }));
    mesh.renderOrder = -1;
    mesh.userData.canvas = c.id;
    return mesh;
  }

  private texture(url: string): Texture {
    let t = this.textures.get(url);
    if (t) return t;
    t = new Texture();
    t.colorSpace = SRGBColorSpace;
    t.anisotropy = 4;
    this.textures.set(url, t);
    const img = new Image();
    img.onload = () => {
      const tex = this.textures.get(url);
      if (!tex) return;
      tex.image = img;
      tex.needsUpdate = true;
      this.invalidate();
    };
    img.src = url;
    return t;
  }

  private drop(id: string): void {
    const d = this.drawn.get(id);
    if (!d) return;
    d.mesh.removeFromParent();
    d.mesh.geometry.dispose();
    (d.mesh.material as MeshBasicMaterial).dispose();
    this.drawn.delete(id);
  }
}
