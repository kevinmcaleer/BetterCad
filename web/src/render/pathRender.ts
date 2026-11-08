/**
 * The Render view's path tracer (#197): three-gpu-pathtracer over a scene of its own, built from the bodies' meshes
 * with each body's colour and finish (#196), a floor that catches a soft shadow, a lighting preset and a background.
 * The grid, the bed and every overlay stay out. This module loads only when you first press Render.
 *
 * The scene is Y up, the way the path tracer's sky gradient expects: points go from BetterCad's Z up by
 * (x, y, z) → (x, z, −y), as glTF export does.
 */
import {
  ACESFilmicToneMapping,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  Group,
  Matrix4,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";
import { GradientEquirectTexture, PhysicalCamera, WebGLPathTracer } from "three-gpu-pathtracer";
import { DEFAULT_COLOUR, finishById, finishOf, type FinishId } from "@bettercad/kernel";
import { cameraBasis, FOV, type CameraState } from "../viewport/camera";
import { Backgrounds } from "./backgrounds";
import { cutMesh, type CutPlane, type Triangles } from "./cut";

export type { LightPresetId as LightPreset } from "./session";
import type { BackgroundId, LightPresetId as LightPreset, RenderStyle } from "./session";

export const LIGHT_PRESETS: { id: LightPreset; label: string; title: string }[] = [
  { id: "studio", label: "Studio", title: "Soft white light from above and to one side" },
  { id: "daylight", label: "Daylight", title: "A blue sky and a low sun" },
  { id: "workbench", label: "Workbench", title: "Warm overhead light on a bench" },
  { id: "lightbox", label: "Lightbox", title: "Even white light from every side and a soft shadow straight down" },
];

/** A body as the render needs it: its triangles, where they sit, and how they look. */
export interface RenderBody {
  id: string;
  mesh: Triangles;
  /** Places the mesh; identity when the kernel built it in place. */
  matrix: Matrix4;
  colour?: string;
  finish?: FinishId;
  catalogue?: Parameters<typeof finishOf>[0]["catalogue"];
}

/**
 * Each preset's sky (the light all round) and sun. These are lighting values for the rendered picture, not interface colours, so
 * they live here rather than in the design tokens.
 */
const LOOKS: Record<LightPreset, { skyTop: number; skyBottom: number; sun: number; sunIntensity: number; sunDir: [number, number, number] }> = {
  studio: { skyTop: 0xffffff, skyBottom: 0x9a9da3, sun: 0xffffff, sunIntensity: 1.2, sunDir: [-0.5, 1, 0.6] },
  daylight: { skyTop: 0x6fa8e6, skyBottom: 0xd9dfe6, sun: 0xfff1dc, sunIntensity: 3, sunDir: [0.8, 0.7, 0.4] },
  // A light tent: white all round, so nothing falls dark, and a faint sun overhead for a soft shadow under the model.
  lightbox: { skyTop: 0xffffff, skyBottom: 0xf2f2f2, sun: 0xffffff, sunIntensity: 1, sunDir: [0.05, 1, 0.08] },
  workbench: { skyTop: 0xf7e9d6, skyBottom: 0x5a4a3c, sun: 0xffe2b8, sunIntensity: 1.8, sunDir: [0.1, 1, 0.2] },
};

/** Z up, millimetres, to the render scene's Y up. */
const yUp = (v: [number, number, number]) => new Vector3(v[0], v[2], -v[1]);
const IDENTITY = new Matrix4();
const Z_TO_Y = new Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1);

export interface PathRenderOptions {
  /** Called after each sample, with the count. */
  onSample?: (samples: number) => void;
}

export class PathRender {
  readonly renderer: WebGLRenderer;
  private tracer: WebGLPathTracer;
  private scene = new Scene();
  private camera = new PhysicalCamera(FOV, 1, 1, 100_000);
  /** The lens opening as a share of the distance to the model: 0 keeps everything sharp. */
  private aperture = 0;
  private distance = 100;
  private model = new Group();
  private floor: Mesh<PlaneGeometry, MeshStandardMaterial>;
  private sun = new DirectionalLight();
  private sky = new GradientEquirectTexture();
  private backgrounds = new Backgrounds();
  private background: BackgroundId = "lightbox";
  private reach = 100;
  /** The Holoroom's four walls and roof, round the model. */
  private walls = new Group();
  private wallMaterial = new MeshStandardMaterial({ roughness: 0.6, metalness: 0, emissive: 0xffffff, emissiveIntensity: 0.35 });
  /**
   * The roof carries the grid too, but lets the light through: the path tracer reads `castShadow` off a material, and
   * with it false the sun and sky still reach the model past the roof.
   */
  private roofMaterial = Object.assign(new MeshStandardMaterial({ roughness: 0.6, metalness: 0, emissive: 0xffffff, emissiveIntensity: 0.35 }), {
    castShadow: false,
  });
  private roof = new Mesh(new PlaneGeometry(1, 1), this.roofMaterial);
  private frame = 0;
  private watchdog = 0;
  private style: RenderStyle = "finishes";
  /** Paper: an off-white, very rough surface with a soft sheen at grazing angles, the way card catches light. */
  private paper = new MeshPhysicalMaterial({ color: 0xf3efe6, roughness: 0.95, metalness: 0, sheen: 0.5, sheenRoughness: 0.9, sheenColor: 0xffffff });
  private paused = false;
  private stopped = false;
  private max = 512;
  /** Stop adding samples here. Raising it past the count so far starts the picture clearing again. */
  get maxSamples(): number {
    return this.max;
  }
  set maxSamples(n: number) {
    this.max = n;
    this.stopped = this.samples >= n;
  }
  private size = { width: 1, height: 1 };

  /** Throws when the browser has no WebGL2. */
  constructor(
    readonly canvas: HTMLCanvasElement,
    private opts: PathRenderOptions = {},
  ) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.tracer = new WebGLPathTracer(this.renderer);
    this.tracer.tiles.set(2, 2);
    this.tracer.minSamples = 1;
    this.tracer.renderDelay = 0;
    this.tracer.fadeDuration = 200;
    this.tracer.filterGlossyFactor = 0.5;
    this.tracer.bounces = 6;

    this.floor = new Mesh(new PlaneGeometry(1, 1), new MeshStandardMaterial({ roughness: 1, metalness: 0 }));
    this.floor.rotation.x = -Math.PI / 2;
    this.sky.update();
    this.scene.environment = this.sky;
    this.applyBackground("lightbox");
    const plane = new PlaneGeometry(1, 1);
    for (let i = 0; i < 4; i++) {
      const w = new Mesh(plane, this.wallMaterial);
      w.rotation.y = (i * Math.PI) / 2;
      this.walls.add(w);
    }
    // Facing down into the room.
    this.roof.rotation.x = Math.PI / 2;
    this.walls.add(this.roof);
    this.scene.add(this.model, this.floor, this.sun, this.sun.target, this.camera);
  }

  /**
   * Builds the scene from the bodies: one standard material per body from its colour and finish. With a section
   * plane, each body is cut and capped there, as the modelling view shows it.
   */
  setBodies(bodies: RenderBody[], section: CutPlane | null = null): void {
    this.clearModel();
    for (const b of bodies) {
      const g = new BufferGeometry();
      let matrix = b.matrix;
      let tris = b.mesh;
      if (section) {
        // Cut in model space: place the mesh first, then the plane needs no moving.
        if (!b.matrix.equals(IDENTITY)) {
          const placed = new BufferGeometry();
          placed.setAttribute("position", new BufferAttribute(b.mesh.positions.slice(), 3));
          placed.setAttribute("normal", new BufferAttribute(b.mesh.normals.slice(), 3));
          placed.applyMatrix4(b.matrix);
          tris = {
            positions: placed.getAttribute("position").array as Float32Array,
            normals: placed.getAttribute("normal").array as Float32Array,
            indices: b.mesh.indices,
          };
          matrix = IDENTITY;
        }
        tris = cutMesh(tris, section);
        if (!tris.indices.length) continue;
      }
      g.setAttribute("position", new BufferAttribute(tris.positions, 3));
      g.setAttribute("normal", new BufferAttribute(tris.normals, 3));
      g.setIndex(new BufferAttribute(tris.indices, 1));
      const f = finishById(finishOf(b));
      const material = new MeshStandardMaterial({ color: new Color(b.colour ?? DEFAULT_COLOUR), roughness: f.roughness, metalness: f.metalness });
      const mesh = new Mesh(g, this.style === "paper" ? this.paper : material);
      mesh.userData.finish = material;
      mesh.matrixAutoUpdate = false;
      mesh.matrix.multiplyMatrices(Z_TO_Y, matrix);
      this.model.add(mesh);
    }
    this.model.updateMatrixWorld(true);
    this.placeFloor();
    this.tracer.setScene(this.scene, this.camera);
  }

  private clearModel(): void {
    for (const m of this.model.children as Mesh[]) {
      m.geometry.dispose();
      (m.userData.finish as MeshStandardMaterial).dispose();
    }
    this.model.clear();
  }

  /** The floor sits under the lowest point and reaches well past the model, so its edge never shows. */
  private placeFloor(): void {
    let low = Infinity;
    let reach = 100;
    const v = new Vector3();
    for (const m of this.model.children as Mesh[]) {
      const p = m.geometry.getAttribute("position");
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i).applyMatrix4(m.matrix);
        low = Math.min(low, v.y);
        reach = Math.max(reach, Math.abs(v.x), Math.abs(v.z));
      }
    }
    this.floor.position.set(0, Number.isFinite(low) ? low : 0, 0);
    this.floor.scale.setScalar(reach * 40);
    this.reach = reach;
    this.placeWalls();
    this.fitGrid();
    this.floor.updateMatrixWorld();
    const d = LOOKS.studio.sunDir;
    this.sun.position.set(d[0] * reach * 4, d[1] * reach * 4, d[2] * reach * 4);
  }

  /** Colours and finishes, or every part in one matte paper white, like a clay render. */
  setStyle(style: RenderStyle): void {
    this.style = style;
    for (const m of this.model.children as Mesh[]) m.material = style === "paper" ? this.paper : (m.userData.finish as MeshStandardMaterial);
    // The tracer keeps the list of materials it read in setScene, so a swapped material only shows once it re-reads the scene.
    if (this.model.children.length) this.tracer.setScene(this.scene, this.camera);
    this.restart();
  }

  /** What is behind the model and what it stands on; the lighting stays as it is. */
  setBackground(id: BackgroundId): void {
    const walls = !!this.walls.parent;
    this.applyBackground(id);
    // Walls coming or going change the scene's shape, so the tracer re-reads it.
    if (!!this.walls.parent !== walls && this.model.children.length) this.tracer.setScene(this.scene, this.camera);
    this.tracer.updateEnvironment();
    this.tracer.updateMaterials();
    this.restart();
  }

  private applyBackground(id: BackgroundId): void {
    this.background = id;
    const b = this.backgrounds.get(id);
    if (b.walls) this.scene.add(this.walls);
    else this.scene.remove(this.walls);
    this.scene.background = b.sky;
    const m = this.floor.material;
    m.color.set(b.floor.colour);
    m.roughness = b.floor.roughness;
    m.map = b.floor.grid?.map ?? null;
    m.emissiveMap = b.floor.grid?.map ?? null;
    m.emissive.set(b.floor.grid ? 0xffffff : 0x000000);
    m.emissiveIntensity = b.floor.grid ? 0.6 : 0;
    m.needsUpdate = true;
    this.fitGrid();
  }

  /** Each wall stands on the floor, a square room six times the model's reach from the middle, three reaches high. */
  private placeWalls(): void {
    const half = this.reach * 6,
      high = this.reach * 3;
    this.roof.position.set(0, this.floor.position.y + high, 0);
    this.roof.scale.set(half * 2, half * 2, 1);
    this.walls.children.forEach((w, i) => {
      if (w === this.roof) return;
      const a = (i * Math.PI) / 2;
      // Each plane faces back into the room.
      w.position.set(-Math.sin(a) * half, this.floor.position.y + high / 2, -Math.cos(a) * half);
      w.scale.set(half * 2, high, 1);
    });
    this.walls.updateMatrixWorld(true);
  }

  /** The grid's cells stay the same size in millimetres however big the floor is. */
  private fitGrid(): void {
    const g = this.backgrounds.get(this.background).floor.grid;
    if (!g) return;
    g.map.repeat.setScalar((this.reach * 40) / g.cell);
    // The walls carry the same grid at the same cell size, from a copy so they repeat on their own.
    const wall = (this.wallMaterial.map ??= g.map.clone());
    wall.repeat.set((this.reach * 12) / g.cell, (this.reach * 3) / g.cell);
    wall.needsUpdate = true;
    this.wallMaterial.emissiveMap = wall;
    this.wallMaterial.needsUpdate = true;
    const roof = (this.roofMaterial.map ??= g.map.clone());
    roof.repeat.setScalar((this.reach * 12) / g.cell);
    roof.needsUpdate = true;
    this.roofMaterial.emissiveMap = roof;
    this.roofMaterial.needsUpdate = true;
  }

  setPreset(p: LightPreset): void {
    const l = LOOKS[p];
    this.sky.topColor.set(l.skyTop);
    this.sky.bottomColor.set(l.skyBottom);
    this.sky.update();
    this.sun.color.set(l.sun);
    this.sun.intensity = l.sunIntensity;
    const dist = this.sun.position.length() || 400;
    this.sun.position
      .set(...l.sunDir)
      .normalize()
      .multiplyScalar(dist);
    this.sun.target.position.set(0, this.floor.position.y, 0);
    this.sun.updateMatrixWorld();
    this.sun.target.updateMatrixWorld();
    this.tracer.updateEnvironment();
    this.tracer.updateLights();
    this.tracer.updateMaterials();
    this.restart();
  }

  /** Depth of field: focused on the point the camera turns round, which is the model. */
  setFocus(aperture: number): void {
    this.aperture = aperture;
    this.focusLens();
    this.tracer.updateCamera();
    this.restart();
  }

  private focusLens(): void {
    this.camera.focusDistance = this.distance;
    // The tracer reads bokehSize in millimetres and the scene in metres; this scene is in millimetres already.
    this.camera.bokehSize = this.distance * this.aperture * 1000;
    // Six blades make round-ish highlights, like a real lens.
    this.camera.apertureBlades = this.aperture ? 6 : 0;
  }

  setCamera(c: CameraState): void {
    const { position, up } = cameraBasis(c);
    this.camera.position.copy(yUp(position));
    this.camera.up.copy(yUp(up));
    this.camera.lookAt(yUp(c.target));
    this.distance = c.distance;
    this.focusLens();
    this.camera.near = Math.max(0.1, c.distance / 1000);
    this.camera.far = c.distance * 100 + 10_000;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    this.tracer.updateCamera();
    this.restart();
  }

  setSize(width: number, height: number): void {
    this.size = { width, height };
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    this.tracer.updateCamera();
    this.restart();
  }

  get samples(): number {
    return Math.floor(this.tracer.samples);
  }

  /** While orbiting: draw the plain preview and add no samples. */
  pause(on: boolean): void {
    this.paused = on;
    this.tracer.pausePathTracing = on;
  }

  private restart(): void {
    this.tracer.reset();
    this.stopped = false;
  }

  /**
   * Starts the loop: a sample each animation frame until maxSamples. A slow GPU can hold animation frames back for
   * seconds, so a watchdog takes a sample itself when no frame has come for a quarter of a second. The loop rests
   * while the tab is hidden.
   */
  start(): void {
    this.stopLoop();
    let last = performance.now();
    const sample = () => {
      last = performance.now();
      if (this.stopped || document.hidden) return;
      this.tracer.renderSample();
      const n = this.samples;
      this.opts.onSample?.(n);
      if (!this.paused && n >= this.max) this.stopped = true;
    };
    const frame = () => {
      this.frame = requestAnimationFrame(frame);
      sample();
    };
    this.frame = requestAnimationFrame(frame);
    this.watchdog = window.setInterval(() => performance.now() - last > 250 && sample(), 250);
  }

  private stopLoop(): void {
    cancelAnimationFrame(this.frame);
    window.clearInterval(this.watchdog);
  }

  /**
   * A PNG at `width` × `height`, with at least `samples` samples. At the picture's own size it keeps what is already
   * rendered and only adds any samples still missing; at another size it renders afresh, then puts the view back.
   * `progress` hears how far it has got (0 to 1); `signal` stops it early, and the promise then rejects.
   */
  async snapshot(width: number, height: number, samples: number, progress?: (f: number) => void, signal?: AbortSignal): Promise<Blob> {
    const same = width === this.canvas.width && height === this.canvas.height;
    this.stopLoop();
    const pr = this.renderer.getPixelRatio();
    const before = this.size;
    try {
      if (!same) {
        this.renderer.setPixelRatio(1);
        this.setSize(width, height);
      }
      this.tracer.pausePathTracing = false;
      while (this.samples < samples) {
        if (signal?.aborted) throw new Error("Stopped");
        this.tracer.renderSample();
        progress?.(this.samples / samples);
        if (same) this.opts.onSample?.(this.samples);
        await new Promise((r) => setTimeout(r, 0));
      }
      return await new Promise<Blob>((resolve, reject) => this.canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("No image"))), "image/png"));
    } finally {
      if (!same) {
        this.renderer.setPixelRatio(pr);
        this.setSize(before.width, before.height);
      }
      this.start();
    }
  }

  dispose(): void {
    this.stopLoop();
    this.clearModel();
    this.floor.geometry.dispose();
    this.floor.material.dispose();
    this.paper.dispose();
    this.sky.dispose();
    this.backgrounds.dispose();
    this.wallMaterial.map?.dispose();
    this.wallMaterial.dispose();
    this.roofMaterial.map?.dispose();
    this.roofMaterial.dispose();
    this.roof.geometry.dispose();
    (this.walls.children[0] as Mesh).geometry.dispose();
    this.tracer.dispose();
    this.renderer.dispose();
  }
}
