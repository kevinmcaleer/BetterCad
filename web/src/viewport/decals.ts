import { BufferAttribute, BufferGeometry, CanvasTexture, ClampToEdgeWrapping, Mesh, MeshStandardMaterial, SRGBColorSpace, type Group, type Plane } from "three";
import type { BodyMesh } from "@bettercad/kernel";
import { decalMesh, faceFrame, type Placement } from "../decal/place";

/** A decal (#263) for the view: the body's mesh as drawn, the face it sits on, where on it, and its picture. */
export interface EngineDecal {
  id: string;
  body: string;
  mesh: BodyMesh;
  face: number;
  at: Placement;
  /** The picture, as a data: URL. */
  image: string;
}

/** The share of the texture left clear round the picture, so the face's triangles off the picture draw nothing. */
export const DECAL_MARGIN = 0.02;

/** The picture on a canvas with a clear border, so sampling past its edge comes out clear. `loaded` hears when it is in. */
export function decalTexture(url: string, loaded: () => void): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 2;
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = ClampToEdgeWrapping;
  t.anisotropy = 4;
  const img = new Image();
  img.onload = () => {
    // Big enough that the clear border is a few whole pixels even on its short side, small enough for the GPU.
    const w = img.naturalWidth || 512;
    const h = img.naturalHeight || 512;
    const scale = Math.min(4096 / Math.max(w, h), Math.max(1, 256 / Math.min(w, h)));
    const inner = [Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale))] as const;
    const k = 1 - 2 * DECAL_MARGIN;
    const c = document.createElement("canvas");
    c.width = Math.round(inner[0] / k);
    c.height = Math.round(inner[1] / k);
    const ctx = c.getContext("2d");
    ctx?.drawImage(img, (c.width - inner[0]) / 2, (c.height - inner[1]) / 2, inner[0], inner[1]);
    // A texture keeps the size it was first drawn at, and the blank one may have been drawn by now: let it go, so the
    // picture is sent whole at its own size.
    t.dispose();
    t.image = c;
    t.needsUpdate = true;
    loaded();
  };
  // A picture that cannot be read shows nothing, and holds nothing up.
  img.onerror = () => loaded();
  img.src = url;
  return t;
}

const same = (a: EngineDecal, b: EngineDecal) =>
  a.mesh === b.mesh &&
  a.face === b.face &&
  a.image === b.image &&
  a.at.x === b.at.x &&
  a.at.y === b.at.y &&
  a.at.width === b.at.width &&
  a.at.height === b.at.height &&
  a.at.angle === b.at.angle &&
  !!a.at.flip === !!b.at.flip;

interface Drawn {
  spec: EngineDecal;
  mesh: Mesh;
}

/**
 * Draws decals over their faces, loaded with the first decal so the first page load doesn't carry it. Each mesh hangs
 * from its body's group, so it moves and poses with the body.
 */
export class DecalLayer {
  private drawn = new Map<string, Drawn>();
  private textures = new Map<string, CanvasTexture>();

  constructor(private invalidate: () => void) {}

  /**
   * Shows these decals; `groupOf` gives the group a body is drawn in, or null when the body isn't drawn. `clip` is the
   * section's plane, if any, so a decal is cut with its body.
   */
  set(list: EngineDecal[], groupOf: (body: string) => Group | null, clip: Plane[]): void {
    const keep = new Set(list.map((d) => d.id));
    for (const [id, d] of this.drawn) {
      const spec = list.find((x) => x.id === id);
      if (!keep.has(id) || !spec || !same(spec, d.spec)) this.drop(id);
    }
    for (const spec of list) {
      let d = this.drawn.get(spec.id);
      if (!d) {
        const mesh = this.make(spec);
        // A face that isn't flat (or has gone) shows nothing.
        if (!mesh) continue;
        d = { spec, mesh };
        this.drawn.set(spec.id, d);
      }
      d.spec = spec;
      (d.mesh.material as MeshStandardMaterial).clippingPlanes = clip;
      const g = groupOf(spec.body);
      if (!g) d.mesh.removeFromParent();
      else if (d.mesh.parent !== g) g.add(d.mesh);
    }
    // Pictures nothing shows any more.
    const used = new Set(list.map((d) => d.image));
    for (const [url, t] of this.textures)
      if (!used.has(url)) {
        t.dispose();
        this.textures.delete(url);
      }
    this.invalidate();
  }

  private make(spec: EngineDecal): Mesh | null {
    const frame = faceFrame(spec.mesh, spec.face);
    if (!frame) return null;
    const m = decalMesh(spec.mesh, spec.face, frame, spec.at, DECAL_MARGIN);
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(m.positions, 3));
    g.setAttribute("normal", new BufferAttribute(m.normals, 3));
    g.setAttribute("uv", new BufferAttribute(m.uvs, 2));
    g.setIndex(new BufferAttribute(m.indices, 1));
    g.computeBoundingSphere();
    const material = new MeshStandardMaterial({
      map: this.texture(spec.image),
      transparent: true,
      depthWrite: false,
      roughness: 0.9,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const mesh = new Mesh(g, material);
    mesh.renderOrder = 1;
    mesh.userData.decal = spec.id;
    return mesh;
  }

  private texture(url: string): CanvasTexture {
    let t = this.textures.get(url);
    if (t) return t;
    t = decalTexture(url, () => this.textures.has(url) && this.invalidate());
    this.textures.set(url, t);
    return t;
  }

  private drop(id: string): void {
    const d = this.drawn.get(id);
    if (!d) return;
    d.mesh.removeFromParent();
    d.mesh.geometry.dispose();
    (d.mesh.material as MeshStandardMaterial).dispose();
    this.drawn.delete(id);
  }

  dispose(): void {
    for (const id of [...this.drawn.keys()]) this.drop(id);
    for (const t of this.textures.values()) t.dispose();
    this.textures.clear();
  }
}
