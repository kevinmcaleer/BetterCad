/**
 * The Render view's path tracer (#197): three-gpu-pathtracer over a scene of its own, built from the bodies' meshes
 * with each body's colour and finish (#196), a floor that catches a soft shadow, and one of three lighting presets.
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
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";
import { GradientEquirectTexture, WebGLPathTracer } from "three-gpu-pathtracer";
import { DEFAULT_COLOUR, finishById, finishOf, type BodyMesh, type FinishId } from "@bettercad/kernel";
import { cameraBasis, FOV, type CameraState } from "../viewport/camera";

export type { LightPresetId as LightPreset } from "./session";
import type { LightPresetId as LightPreset, RenderStyle } from "./session";

export const LIGHT_PRESETS: { id: LightPreset; label: string; title: string }[] = [
  { id: "studio", label: "Studio", title: "Soft white light on a seamless floor" },
  { id: "daylight", label: "Daylight", title: "A blue sky and a low sun" },
  { id: "workbench", label: "Workbench", title: "Warm overhead light on a bench" },
];

/** A body as the render needs it: its triangles, where they sit, and how they look. */
export interface RenderBody {
  id: string;
  mesh: BodyMesh;
  /** Places the mesh; identity when the kernel built it in place. */
  matrix: Matrix4;
  colour?: string;
  finish?: FinishId;
  catalogue?: Parameters<typeof finishOf>[0]["catalogue"];
}

/**
 * Each preset's sky, floor and sun. These are lighting values for the rendered picture, not interface colours, so
 * they live here rather than in the design tokens.
 */
const LOOKS: Record<LightPreset, { skyTop: number; skyBottom: number; floor: number; sun: number; sunIntensity: number; sunDir: [number, number, number] }> = {
  studio: { skyTop: 0xffffff, skyBottom: 0x9a9da3, floor: 0xf2f2f2, sun: 0xffffff, sunIntensity: 1.2, sunDir: [-0.5, 1, 0.6] },
  daylight: { skyTop: 0x6fa8e6, skyBottom: 0xd9dfe6, floor: 0xd6d3cc, sun: 0xfff1dc, sunIntensity: 3, sunDir: [0.8, 0.7, 0.4] },
  workbench: { skyTop: 0xf7e9d6, skyBottom: 0x5a4a3c, floor: 0xb08a63, sun: 0xffe2b8, sunIntensity: 1.8, sunDir: [0.1, 1, 0.2] },
};

/** Z up, millimetres, to the render scene's Y up. */
const yUp = (v: [number, number, number]) => new Vector3(v[0], v[2], -v[1]);
const Z_TO_Y = new Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1);

export interface PathRenderOptions {
  /** Called after each sample, with the count. */
  onSample?: (samples: number) => void;
}

export class PathRender {
  readonly renderer: WebGLRenderer;
  private tracer: WebGLPathTracer;
  private scene = new Scene();
  private camera = new PerspectiveCamera(FOV, 1, 1, 100_000);
  private model = new Group();
  private floor: Mesh<PlaneGeometry, MeshStandardMaterial>;
  private sun = new DirectionalLight();
  private sky = new GradientEquirectTexture();
  private frame = 0;
  private watchdog = 0;
  private style: RenderStyle = "finishes";
  /** Paper: an off-white, very rough surface with a soft sheen at grazing angles, the way card catches light. */
  private paper = new MeshPhysicalMaterial({ color: 0xf3efe6, roughness: 0.95, metalness: 0, sheen: 0.5, sheenRoughness: 0.9, sheenColor: 0xffffff });
  private paused = false;
  private stopped = false;
  /** Stop adding samples here: the picture has stopped changing. */
  maxSamples = 2000;
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
    this.scene.background = this.sky;
    this.scene.environment = this.sky;
    this.scene.add(this.model, this.floor, this.sun, this.sun.target, this.camera);
  }

  /** Builds the scene from the bodies: one standard material per body from its colour and finish. */
  setBodies(bodies: RenderBody[]): void {
    this.clearModel();
    for (const b of bodies) {
      const g = new BufferGeometry();
      g.setAttribute("position", new BufferAttribute(b.mesh.positions, 3));
      g.setAttribute("normal", new BufferAttribute(b.mesh.normals, 3));
      g.setIndex(new BufferAttribute(b.mesh.indices, 1));
      const f = finishById(finishOf(b));
      const material = new MeshStandardMaterial({ color: new Color(b.colour ?? DEFAULT_COLOUR), roughness: f.roughness, metalness: f.metalness });
      const mesh = new Mesh(g, this.style === "paper" ? this.paper : material);
      mesh.userData.finish = material;
      mesh.matrixAutoUpdate = false;
      mesh.matrix.multiplyMatrices(Z_TO_Y, b.matrix);
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
    this.floor.updateMatrixWorld();
    const d = LOOKS.studio.sunDir;
    this.sun.position.set(d[0] * reach * 4, d[1] * reach * 4, d[2] * reach * 4);
  }

  /** Colours and finishes, or every part in one matte paper white, like a clay render. */
  setStyle(style: RenderStyle): void {
    this.style = style;
    for (const m of this.model.children as Mesh[]) m.material = style === "paper" ? this.paper : (m.userData.finish as MeshStandardMaterial);
    this.tracer.updateMaterials();
    this.restart();
  }

  setPreset(p: LightPreset): void {
    const l = LOOKS[p];
    this.sky.topColor.set(l.skyTop);
    this.sky.bottomColor.set(l.skyBottom);
    this.sky.update();
    this.floor.material.color.set(l.floor);
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

  setCamera(c: CameraState): void {
    const { position, up } = cameraBasis(c);
    this.camera.position.copy(yUp(position));
    this.camera.up.copy(yUp(up));
    this.camera.lookAt(yUp(c.target));
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
      if (!this.paused && n >= this.maxSamples) this.stopped = true;
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
   * A PNG at `width` × `height`: renders `samples` samples at that size, then puts the view back. `progress` hears
   * how far it has got (0 to 1).
   */
  async snapshot(width: number, height: number, samples: number, progress?: (f: number) => void): Promise<Blob> {
    this.stopLoop();
    const pr = this.renderer.getPixelRatio();
    const before = this.size;
    try {
      this.renderer.setPixelRatio(1);
      this.setSize(width, height);
      this.tracer.pausePathTracing = false;
      while (this.samples < samples) {
        this.tracer.renderSample();
        progress?.(this.samples / samples);
        await new Promise((r) => setTimeout(r, 0));
      }
      return await new Promise<Blob>((resolve, reject) => this.canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("No image"))), "image/png"));
    } finally {
      this.renderer.setPixelRatio(pr);
      this.setSize(before.width, before.height);
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
    this.tracer.dispose();
    this.renderer.dispose();
  }
}
