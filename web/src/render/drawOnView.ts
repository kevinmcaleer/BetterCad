/**
 * Plays Draw on (see `drawOn.ts`) in real time with three.js: neon lines that grow behind star-like embers, ghost
 * faces that glow at their rims, and the solid model firming up underneath, all through a bloom pass so the lines
 * glow. It can record itself to a video with the browser's MediaRecorder.
 *
 * Unlike the path tracer this scene stays Z up, as the modelling view is.
 */
import {
  AddEquation,
  CanvasTexture,
  CustomBlending,
  DepthTexture,
  WebGLRenderTarget,
  DirectionalLight,
  HemisphereLight,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OneFactor,
  PlaneGeometry,
  SRGBColorSpace,
  type Blending,
  type BlendingEquation,
  BufferAttribute,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Matrix4,
  MaxEquation,
  Mesh,
  NormalBlending,
  PerspectiveCamera,
  Points,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { SavePass } from "three/examples/jsm/postprocessing/SavePass.js";
import { DEFAULT_COLOUR, type BodyMesh } from "@bettercad/kernel";
import { cameraBasis, FOV, type CameraState } from "../viewport/camera";
import { emberAt, GHOST, GHOST_IN, lineGlow, planDrawOn, SETTLE, type DrawOnPlan, type DrawOnTiming } from "./drawOn";
import type { RenderBody } from "./pathRender";
import { Backgrounds, skyColours, wallGrid } from "./backgrounds";
import type { BackgroundId, DrawOnColour } from "./session";
import { recordCanvas, videoType } from "./video";

/**
 * The glow colours. Like the path tracer's lighting, these are colours of the rendered picture, not of the interface,
 * so they live here rather than in the design tokens.
 */
export const GLOWS: Record<Exclude<DrawOnColour, "parts">, number> = {
  blue: 0x3d7bff,
  amber: 0xffa23a,
  green: 0x3cff8f,
  white: 0xdfe9ff,
};
/**
 * Backgrounds the glow shows on as light, through the bloom. On the others (a white sweep, a grey table) a neon line
 * would vanish into the light behind it, so the lines and ghosts are drawn as coloured ink, with no bloom.
 */
/**
 * How bright the Holoroom's walls and gridded floor are drawn: their grid lines stay under the bloom's threshold, so
 * only the drawing glows.
 */
const WALL_LIGHT = 0x8a8a8a;
const DARK_BACKGROUNDS = new Set<BackgroundId>(["holoroom", "black", "transparent"]);

/** A body with the kernel's edges, as the Render view has it. */
const hasEdges = (m: RenderBody["mesh"]): m is BodyMesh => "edgePositions" in m && "edgeSegs" in m && "faceTris" in m;

const FACE_TIMING = /* glsl */ `
  uniform float uTime;
  uniform float uDrawEnd;
  varying float vClosed;
  float shown() { return smoothstep(vClosed, vClosed + ${GHOST_IN.toFixed(3)}, uTime); }
  // As solidity() in drawOn.ts: from halfway through the drawing, or from when the face closes if that is later.
  float solid() { return smoothstep(max(uDrawEnd * 0.5, vClosed), uDrawEnd + ${SETTLE.toFixed(3)}, uTime); }
`;

const FACE_VERTEX = /* glsl */ `
  attribute float aClosed;
  varying float vClosed;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vClosed = aClosed;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = -mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`;

/**
 * How much of a line or ghost shows: all of it, unless it is behind the front-most solid face, when it shows as
 * much as that face lets through.
 */
const BEHIND = /* glsl */ `
  uniform sampler2D tFront;
  uniform sampler2D tFrontDepth;
  uniform vec2 uScreen;
  uniform float uNear;
  uniform float uFar;
  float viewZ(float d) {
    float z = d * 2.0 - 1.0;
    return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear));
  }
  float seen() {
    vec2 uv = gl_FragCoord.xy / uScreen;
    float d = texture2D(tFrontDepth, uv).r;
    if (d >= 1.0) return 1.0;
    float front = viewZ(d);
    return viewZ(gl_FragCoord.z) > front * 1.002 + 0.02 ? 1.0 - texture2D(tFront, uv).r : 1.0;
  }
`;
const behindUniforms = () => ({
  tFront: { value: null },
  tFrontDepth: { value: null },
  uScreen: { value: new Vector2(1, 1) },
  uNear: { value: 1 },
  uFar: { value: 1000 },
});

/**
 * The front-most face with any solid in it. As depth only (in the picture), so the solid shows just its nearest
 * surface; and as depth plus how solid it is (in the front pass, `front`), so lines and ghosts behind it fade out
 * with it, smoothly, rather than vanishing the moment it is nearly solid.
 */
const prepassMaterial = (front = false) =>
  new ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uDrawEnd: { value: 1 } },
    vertexShader: FACE_VERTEX,
    fragmentShader: /* glsl */ `
      ${FACE_TIMING}
      void main() {
        float a = shown() * solid();
        if (a < 0.003) discard;
        gl_FragColor = vec4(a, 0.0, 0.0, 1.0);
      }
    `,
    colorWrite: front,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 2,
  });

/** The solid model, softly lit, fading in over the ghosts. */
const solidMaterial = (colour: Color, glow: Color) =>
  new ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uDrawEnd: { value: 1 }, uColour: { value: colour }, uGlow: { value: glow } },
    vertexShader: FACE_VERTEX,
    fragmentShader: /* glsl */ `
      ${FACE_TIMING}
      uniform vec3 uColour;
      uniform vec3 uGlow;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        float a = shown() * solid();
        if (a < 0.003) discard;
        vec3 n = normalize(vNormal);
        if (!gl_FrontFacing) n = -n;
        vec3 v = normalize(vView);
        // A key light up and to the left of the camera, a fill from the right, and a rim of the glow colour.
        float key = max(dot(n, normalize(vec3(-0.5, 0.7, 0.6))), 0.0);
        float fill = max(dot(n, normalize(vec3(0.7, -0.1, 0.5))), 0.0);
        float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0);
        // The glow's rim fades with the ghosts, so the finished model is just the model. The solid never blooms (it is
        // not on the glow layer), so it can be lit as brightly as it needs.
        vec3 c = uColour * (0.22 + 0.62 * key + 0.2 * fill) + uGlow * rim * 0.25 * (1.0 - solid());
        gl_FragColor = vec4(c, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: NormalBlending,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 2,
  });

/** The ghost: see-through, glowing at its rims, fading as the solid comes in. */
const ghostMaterial = (glow: Color) =>
  new ShaderMaterial({
    vertexShader: FACE_VERTEX,
    fragmentShader: /* glsl */ `
      ${FACE_TIMING}
      ${BEHIND}
      uniform vec3 uGlow;
      uniform float uInk;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        float a = shown() * (1.0 - solid());
        if (a < 0.003) discard;
        float facing = abs(dot(normalize(vNormal), normalize(vView)));
        float rim = pow(1.0 - facing, 2.0);
        float k = (${GHOST.toFixed(3)} * 0.6 + rim * 0.55) * a * seen();
        // As ink on a light background: a tint of the glow colour; as light, the glow itself.
        gl_FragColor = uInk > 0.5 ? vec4(uGlow, min(1.0, k * 1.4)) : vec4(uGlow * k, min(1.0, max(uGlow.r, max(uGlow.g, uGlow.b)) * k));
      }
    `,
    uniforms: { uTime: { value: 0 }, uDrawEnd: { value: 1 }, uGlow: { value: glow }, uInk: { value: 0 }, ...behindUniforms() },
    transparent: true,
    depthWrite: false,
    // What is in front is worked out from the front pass (seen()), which fades it rather than cutting it off.
    depthTest: false,
    // The brightest ghost wins rather than adding up, so many parts behind each other can't pile up to white.
    ...MAX,
    side: 2,
  });

/** Blending that keeps the brighter of what is there and what is drawn: overlapping glows never add up past one. */
const MAX = { blending: CustomBlending as Blending, blendEquation: MaxEquation as BlendingEquation };
/** Plain adding, colour and alpha alike: the embers' light. */
const ADD = { blending: CustomBlending as Blending, blendEquation: AddEquation as BlendingEquation, blendSrc: OneFactor, blendDst: OneFactor };
/** Over a light background the glowing parts are drawn as see-through ink instead. */
const INK = { blending: NormalBlending as Blending, blendEquation: AddEquation as BlendingEquation };

/** How bright a line is once the white-hot tip has passed, and how much hotter the tip is. */
export const LINE_BRIGHTNESS = 2.4;
const TIP_BRIGHTNESS = 1.8;
/** How quickly the white-hot tip cools, per second: gone in about a fifth of a second. */
export const TIP_COOLING = 12;

/**
 * How much to turn the glow down for a busy picture: the share of the model's on-screen size the lines would cover
 * (their total length × their width ÷ the model's size, squared), kept to about what a simple bracket covers. 1 is
 * full glow; it falls with the square root of the cover, down to 0.45 for a dense assembly or a model far away.
 * Overlaps can't add up (the lines keep the brighter colour), so this only takes the edge off a crowded picture.
 */
export function glowScale(totalLength: number, size: number, widthPx: number, sizePx: number): number {
  if (!(totalLength > 0 && size > 0 && sizePx > 0)) return 1;
  const cover = (totalLength / size) * (widthPx / sizePx);
  return Math.max(MIN_GLOW, Math.min(1, Math.sqrt(COVER / cover)));
}
/** The cover that still gets full glow. */
const COVER = 0.12;
const MIN_GLOW = 0.45;
/** The lines' width in CSS pixels, and the bloom's strength at full glow. */
const LINE_WIDTH = 2.5;
const BLOOM = 1.1;

/** Wide line segments that grow from their start as time reaches them, white hot just where they are drawn. */
const lineMaterial = () =>
  new ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uGlow: { value: 1 },
      uScale: { value: 1 },
      uInk: { value: 0 },
      uResolution: { value: new Vector2(1, 1) },
      uWidth: { value: 2.5 },
      ...behindUniforms(),
    },
    vertexShader: /* glsl */ `
      uniform vec2 uResolution;
      uniform float uWidth;
      attribute vec3 iStart;
      attribute vec3 iEnd;
      attribute vec2 iTime;
      attribute vec3 iColour;
      varying float vT;
      varying float vSide;
      varying vec3 vColour;
      void main() {
        vec4 a = projectionMatrix * modelViewMatrix * vec4(iStart, 1.0);
        vec4 b = projectionMatrix * modelViewMatrix * vec4(iEnd, 1.0);
        vec2 sa = a.xy / a.w * uResolution;
        vec2 sb = b.xy / b.w * uResolution;
        vec2 d = sb - sa;
        vec2 dir = length(d) > 1e-5 ? normalize(d) : vec2(1.0, 0.0);
        vec2 n = vec2(-dir.y, dir.x);
        vec4 p = mix(a, b, position.x);
        vec2 off = (n * position.y + dir * (position.x * 2.0 - 1.0) * 0.5) * uWidth / uResolution;
        p.xy += off * p.w;
        vT = mix(iTime.x, iTime.y, position.x);
        vSide = position.y;
        vColour = iColour;
        gl_Position = p;
      }
    `,
    fragmentShader: /* glsl */ `
      ${BEHIND}
      uniform float uTime;
      uniform float uGlow;
      uniform float uScale;
      uniform float uInk;
      varying float vT;
      varying float vSide;
      varying vec3 vColour;
      void main() {
        if (vT > uTime) discard;
        float hot = exp(-(uTime - vT) * ${TIP_COOLING.toFixed(1)});
        float core = 1.0 - abs(vSide);
        core *= core;
        vec3 tint = mix(vColour, vec3(1.0), hot * 0.6);
        float k = (${LINE_BRIGHTNESS.toFixed(2)} * uGlow + ${TIP_BRIGHTNESS.toFixed(2)} * hot * uScale) * core * seen();
        if (k < 0.002) discard;
        // Light: the colour times its brightness, as opaque as its brightest channel (for a see-through video).
        // Ink: the colour itself, as opaque as the line is bright.
        vec3 c = tint * k;
        gl_FragColor = uInk > 0.5 ? vec4(tint, min(1.0, k)) : vec4(c, min(1.0, max(c.r, max(c.g, c.b))));
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    ...MAX,
  });

/** The embers: a hot white core, a halo of the glow colour and a four-point star that flickers. */
const emberMaterial = () =>
  new ShaderMaterial({
    uniforms: { uSize: { value: 64 }, uFlicker: { value: 1 }, uInk: { value: 0 } },
    vertexShader: /* glsl */ `
      uniform float uSize;
      attribute float aAlpha;
      attribute vec3 aColour;
      varying float vAlpha;
      varying vec3 vColour;
      void main() {
        vAlpha = aAlpha;
        vColour = aColour;
        gl_PointSize = uSize;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uFlicker;
      uniform float uInk;
      varying float vAlpha;
      varying vec3 vColour;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        float r2 = dot(d, d);
        float core = exp(-r2 * 260.0);
        float halo = exp(-r2 * 28.0) * 0.55;
        float star = exp(-abs(d.x) * 70.0) * exp(-abs(d.y) * 7.0) + exp(-abs(d.y) * 70.0) * exp(-abs(d.x) * 7.0);
        vec3 c = (vec3(1.0) * (core * 3.0 + star * 1.6 * uFlicker) + vColour * halo * 2.0) * vAlpha;
        float a = min(1.0, max(c.r, max(c.g, c.b)));
        // On a light background a white star would vanish: the halo's colour shows round a white core.
        gl_FragColor = uInk > 0.5 ? vec4(mix(vColour, vec3(1.0), min(1.0, core * 3.0)), min(1.0, (core * 3.0 + star + halo * 1.5) * vAlpha)) : vec4(c, a);
      }
    `,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    ...ADD,
  });

/** The sky as a flat top-to-horizon gradient, shown behind everything. */
function gradientTexture(top: number, bottom: number): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 2;
  c.height = 256;
  const g = c.getContext("2d")!;
  const fill = g.createLinearGradient(0, 0, 0, c.height);
  fill.addColorStop(0, `#${new Color(top).getHexString()}`);
  fill.addColorStop(1, `#${new Color(bottom).getHexString()}`);
  g.fillStyle = fill;
  g.fillRect(0, 0, c.width, c.height);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/**
 * After the bloom: the bloomed colour, as opaque as the picture was before it or as the bloom's own light, so on the
 * Transparent background the glow fades out to see-through rather than to black.
 */
const keepAlpha = {
  uniforms: { tDiffuse: { value: null }, tBefore: { value: null } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D tBefore;
    varying vec2 vUv;
    void main() {
      vec4 now = texture2D(tDiffuse, vUv);
      vec4 was = texture2D(tBefore, vUv);
      vec3 glow = max(now.rgb - was.rgb, 0.0);
      float a = max(was.a, min(1.0, max(glow.r, max(glow.g, glow.b))));
      gl_FragColor = vec4(now.rgb, a);
    }
  `,
};

export interface DrawOnViewOptions {
  /** Where the camera is: read each frame, so orbiting the picture underneath turns this too. */
  camera?: () => CameraState;
  /** Called as the animation plays (a few times a second), with the time and the whole length in seconds. */
  onTime?: (t: number, total: number) => void;
  /** Called when it reaches the end. */
  onEnd?: () => void;
}

export { videoType };

export class DrawOnView {
  readonly renderer: WebGLRenderer;
  private scene = new Scene();
  private camera = new PerspectiveCamera(FOV, 1, 1, 100_000);
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private saved: SavePass;
  private backgrounds = new Backgrounds();
  private background: BackgroundId = "holoroom";
  /** Drawing as coloured ink on a light background rather than as light. */
  private ink = false;
  private floor: Mesh<PlaneGeometry, MeshStandardMaterial>;
  /** The Holoroom's four walls and roof, as the Render view builds them, in the floor's grid. */
  private walls = new Group();
  private wallMaterial = new MeshBasicMaterial({ color: WALL_LIGHT, side: 2 });
  private roofMaterial = new MeshBasicMaterial({ color: WALL_LIGHT, side: 2 });
  private lights = new Group();
  /** The front-most solid faces, drawn first into `front`: their depth, and how solid they are. */
  private frontScene = new Scene();
  private front = new WebGLRenderTarget(1, 1, { depthTexture: new DepthTexture(1, 1) });
  /** Lines and ghosts, which fade behind the front-most solid. */
  private behind: ShaderMaterial[] = [];
  private sky: CanvasTexture | null = null;
  /** The lines' total length, and the middle and size (diagonal) of the box round them, in mm: how busy the model is. */
  /** How far the glow is turned down for a busy picture, 0.3 to 1. */
  private glow = 1;
  private extent = { length: 0, centre: new Vector3(), size: 0 };
  private model = new Group();
  private lines: Mesh<InstancedBufferGeometry, ShaderMaterial> | null = null;
  private embers: Points<BufferGeometry, ShaderMaterial> | null = null;
  private faceMaterials: ShaderMaterial[] = [];
  private plan: DrawOnPlan | null = null;
  private emberColours: Vector3[] = [];
  private time = 0;
  private playing = false;
  private last = 0;
  private frame = 0;
  private told = -1;
  private size = new Vector2(1, 1);
  private seen: CameraState | null = null;

  /** Throws when the browser has no WebGL. */
  constructor(
    readonly canvas: HTMLCanvasElement,
    private opts: DrawOnViewOptions = {},
  ) {
    // With alpha, so the Transparent background leaves the canvas (and a WebM video of it) see-through.
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.camera.up.set(0, 0, 1);
    // Pushed back a little, so the bottom edges drawn on it don't flicker into it.
    this.floor = new Mesh(
      new PlaneGeometry(1, 1),
      new MeshStandardMaterial({ roughness: 1, metalness: 0, polygonOffset: true, polygonOffsetFactor: 4, polygonOffsetUnits: 8 }),
    );
    this.floor.renderOrder = -1;
    this.lights.add(new HemisphereLight(0xffffff, 0x8a8a8a, 2.3));
    const sun = new DirectionalLight(0xffffff, 2);
    sun.position.set(-0.5, -0.4, 1);
    this.lights.add(sun);
    this.scene.add(this.model, this.camera);
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // The bloom's blur is opaque everywhere, so keep the picture before it: its alpha is put back after.
    this.saved = new SavePass();
    this.composer.addPass(this.saved);
    this.bloom = new UnrealBloomPass(new Vector2(1, 1), BLOOM, 0.55, 0.78);
    this.composer.addPass(this.bloom);
    const alpha = new ShaderPass(keepAlpha);
    // Set after: the pass copies its uniforms, and a copy of the saved picture would be an empty texture.
    alpha.uniforms.tBefore.value = this.saved.renderTarget.texture;
    this.composer.addPass(alpha);
    this.composer.addPass(new OutputPass());
    const plane = new PlaneGeometry(1, 1);
    for (let i = 0; i < 4; i++) this.walls.add(new Mesh(plane, this.wallMaterial));
    this.walls.add(new Mesh(plane, this.roofMaterial));
    for (const w of this.walls.children) w.renderOrder = -1;
    this.setBackground("holoroom");
    this.loop = this.loop.bind(this);
    this.frame = requestAnimationFrame(this.loop);
  }

  /** Builds the lines, faces and embers from the bodies. Starts again from the beginning. */
  setBodies(bodies: readonly RenderBody[], timing: DrawOnTiming, colour: DrawOnColour): void {
    this.clear();
    const shown = bodies.filter((b) => hasEdges(b.mesh));
    const plan = planDrawOn(
      shown.map((b) => ({ mesh: b.mesh as BodyMesh, matrix: b.matrix.elements })),
      timing,
    );
    this.plan = plan;
    {
      const S = plan.segments;
      const min = new Vector3(Infinity, Infinity, Infinity),
        max = new Vector3(-Infinity, -Infinity, -Infinity),
        a = new Vector3(),
        b = new Vector3();
      let length = 0;
      for (let i = 0; i < S.length; i += 6) {
        a.fromArray(S, i);
        b.fromArray(S, i + 3);
        length += a.distanceTo(b);
        min.min(a).min(b);
        max.max(a).max(b);
      }
      this.extent = S.length
        ? { length, centre: min.clone().add(max).multiplyScalar(0.5), size: min.distanceTo(max) }
        : { length: 0, centre: new Vector3(), size: 0 };
    }
    const glowOf = (b: RenderBody) => new Color(colour === "parts" ? (b.colour ?? DEFAULT_COLOUR) : GLOWS[colour]);

    // Faces: one mesh per body, drawn three times (depth, solid, ghost), each vertex knowing when its face closes.
    shown.forEach((b, i) => {
      const m = b.mesh as BodyMesh;
      const g = new BufferGeometry();
      g.setAttribute("position", new BufferAttribute(m.positions, 3));
      g.setAttribute("normal", new BufferAttribute(m.normals, 3));
      g.setIndex(new BufferAttribute(m.indices, 1));
      const closed = new Float32Array(m.positions.length / 3).fill(plan.drawEnd);
      const times = plan.faceTimes[i];
      for (let f = 0; f + 1 < m.faceVerts.length; f++) closed.fill(times[f] ?? plan.drawEnd, m.faceVerts[f], m.faceVerts[f + 1]);
      g.setAttribute("aClosed", new BufferAttribute(closed, 1));
      const glow = glowOf(b);
      const mats = [prepassMaterial(), solidMaterial(new Color(b.colour ?? DEFAULT_COLOUR), glow), ghostMaterial(glow)];
      mats.forEach((mat, order) => {
        const mesh = new Mesh(g, mat);
        mesh.matrixAutoUpdate = false;
        mesh.matrix.copy(b.matrix);
        mesh.renderOrder = order;
        this.model.add(mesh);
        this.faceMaterials.push(mat);
      });
      const front = new Mesh(g, prepassMaterial(true));
      front.matrixAutoUpdate = false;
      front.matrix.copy(b.matrix);
      front.matrixWorld.copy(b.matrix);
      this.frontScene.add(front);
      this.faceMaterials.push(front.material);
      this.behind.push(mats[2]);
    });

    // Lines: one instanced quad per segment. Segments are placed already; their colour is their body's.
    const n = plan.segmentTimes.length / 2;
    const quad = new InstancedBufferGeometry();
    quad.setAttribute("position", new Float32BufferAttribute([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0], 3));
    quad.setIndex([0, 1, 2, 0, 2, 3]);
    const start = new Float32Array(n * 3),
      end = new Float32Array(n * 3),
      colours = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      start.set(plan.segments.subarray(i * 6, i * 6 + 3), i * 3);
      end.set(plan.segments.subarray(i * 6 + 3, i * 6 + 6), i * 3);
    }
    // Which body each segment came from, for its colour: the plan keeps them in edge order, so match by body.
    const segColour = this.segmentColours(shown, plan, glowOf);
    colours.set(segColour);
    quad.setAttribute("iStart", new InstancedBufferAttribute(start, 3));
    quad.setAttribute("iEnd", new InstancedBufferAttribute(end, 3));
    quad.setAttribute("iTime", new InstancedBufferAttribute(plan.segmentTimes, 2));
    quad.setAttribute("iColour", new InstancedBufferAttribute(colours, 3));
    quad.instanceCount = n;
    this.lines = new Mesh(quad, lineMaterial());
    this.behind.push(this.lines.material);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 3;
    this.scene.add(this.lines);

    // Embers: one point each, moved every frame.
    const k = plan.embers.length;
    const eg = new BufferGeometry();
    eg.setAttribute("position", new BufferAttribute(new Float32Array(k * 3), 3));
    eg.setAttribute("aAlpha", new BufferAttribute(new Float32Array(k), 1));
    this.emberColours = plan.embers.map((p) => {
      const c = this.colourNear(p.points[0], shown, glowOf);
      return new Vector3(c.r, c.g, c.b);
    });
    eg.setAttribute("aColour", new BufferAttribute(new Float32Array(this.emberColours.flatMap((c) => [c.x, c.y, c.z])), 3));
    this.embers = new Points(eg, emberMaterial());
    this.embers.frustumCulled = false;
    this.embers.renderOrder = 4;
    this.scene.add(this.embers);
    this.applyInk();
    this.placeFloor();
    this.seek(0);
  }

  /** Each segment's colour: its body's glow. Bodies' segments come in tour order, so look each up by nearest body box. */
  private segmentColours(bodies: RenderBody[], plan: DrawOnPlan, glowOf: (b: RenderBody) => Color): Float32Array {
    const n = plan.segmentTimes.length / 2;
    const out = new Float32Array(n * 3);
    const one = bodies.length === 1 || new Set(bodies.map((b) => glowOf(b).getHex())).size <= 1;
    const p = new Vector3();
    for (let i = 0; i < n; i++) {
      p.fromArray(plan.segments, i * 6);
      const c = one && bodies.length ? glowOf(bodies[0]) : this.colourNear([p.x, p.y, p.z], bodies, glowOf);
      out.set([c.r, c.g, c.b], i * 3);
    }
    return out;
  }

  /** The glow of the body nearest a point (by its bounding box), for lines and embers of several-coloured models. */
  private boxes = new WeakMap<RenderBody, { min: Vector3; max: Vector3 }>();
  private colourNear(at: [number, number, number], bodies: RenderBody[], glowOf: (b: RenderBody) => Color): Color {
    if (!bodies.length) return new Color(GLOWS.blue);
    let best = bodies[0],
      bestD = Infinity;
    const p = new Vector3(...at);
    for (const b of bodies) {
      let box = this.boxes.get(b);
      if (!box) {
        const min = new Vector3(Infinity, Infinity, Infinity),
          max = new Vector3(-Infinity, -Infinity, -Infinity),
          v = new Vector3();
        const P = b.mesh.positions;
        for (let i = 0; i < P.length; i += 3) {
          v.set(P[i], P[i + 1], P[i + 2]).applyMatrix4(b.matrix);
          min.min(v);
          max.max(v);
        }
        box = { min, max };
        this.boxes.set(b, box);
      }
      const d = new Vector3().copy(p).clamp(box.min, box.max).distanceTo(p);
      if (d < bestD) [best, bestD] = [b, d];
    }
    return glowOf(best);
  }

  /**
   * Shows the Render view's background behind Draw on: its sky as a gradient and its floor (with its grid) under the
   * model, lit softly. Holoroom's walls are left out, so the room reads as black. Transparent shows nothing at all.
   */
  setBackground(id: BackgroundId): void {
    this.background = id;
    const b = this.backgrounds.get(id);
    this.sky?.dispose();
    this.sky = null;
    if (b.clear) {
      this.scene.background = null;
      this.scene.remove(this.floor, this.lights, this.walls);
    } else {
      const { top, bottom } = skyColours(b);
      this.sky = gradientTexture(top, bottom);
      this.scene.background = this.sky;
      this.scene.add(this.lights);
      if (b.floorless) this.scene.remove(this.floor);
      else this.scene.add(this.floor);
      if (b.walls) this.scene.add(this.walls);
      else this.scene.remove(this.walls);
      const m = this.floor.material;
      // A gridded floor under the glow is dimmed as the walls are, so its lines don't bloom.
      m.color.set(b.floor.grid && DARK_BACKGROUNDS.has(id) ? WALL_LIGHT : b.floor.colour);
      m.roughness = b.floor.roughness;
      m.map = b.floor.grid?.map ?? null;
      m.emissiveMap = b.floor.grid?.map ?? null;
      m.emissive.set(b.floor.grid ? 0xffffff : 0x000000);
      // Kept under the bloom's threshold, so the floor never glows like the lines.
      m.emissiveIntensity = b.floor.grid ? Math.min(DARK_BACKGROUNDS.has(id) ? 0.3 : 0.5, b.floor.glow ?? 0.5) : 0;
      m.needsUpdate = true;
      this.placeFloor();
    }
    this.ink = !DARK_BACKGROUNDS.has(id);
    this.bloom.enabled = !this.ink;
    this.applyInk();
    this.canvas.dataset.background = id;
    this.draw();
  }

  /** Lines, ghosts and embers as light (on dark) or as ink (on light). */
  private applyInk(): void {
    const ink = this.ink;
    const face = this.faceMaterials.filter((m) => "uInk" in m.uniforms);
    for (const m of [...face, this.lines?.material, this.embers?.material]) {
      if (!m) continue;
      m.uniforms.uInk.value = ink ? 1 : 0;
      Object.assign(m, ink ? INK : m === this.embers?.material ? ADD : MAX);
      m.needsUpdate = true;
    }
  }

  /** The floor sits under the lowest point and reaches well past the model, as in the Render view. */
  private placeFloor(): void {
    const S = this.plan?.segments;
    let low = Infinity;
    let reach = 100;
    if (S) {
      for (let i = 0; i < S.length; i += 3) {
        low = Math.min(low, S[i + 2]);
        reach = Math.max(reach, Math.abs(S[i]), Math.abs(S[i + 1]));
      }
    }
    const z = Number.isFinite(low) ? low : 0;
    this.floor.position.set(0, 0, z);
    this.floor.scale.setScalar(reach * 40);
    this.floor.updateMatrixWorld();
    const g = this.backgrounds.get(this.background).floor.grid;
    if (g) g.map.repeat.setScalar((reach * 40) / g.cell);
    // The Holoroom: a square room six reaches from the middle, three high, as in the Render view.
    const half = reach * 6,
      high = reach * 3;
    const [roof, ...sides] = [this.walls.children[4], ...this.walls.children.slice(0, 4)];
    roof.position.set(0, 0, z + high);
    roof.scale.set(half * 2, half * 2, 1);
    sides.forEach((w, i) => {
      const a = (i * Math.PI) / 2;
      w.position.set(-Math.sin(a) * half, -Math.cos(a) * half, z + high / 2);
      // Stood up, then turned to face the middle.
      w.rotation.set(Math.PI / 2, 0, a, "ZXY");
      w.scale.set(half * 2, high, 1);
    });
    this.walls.updateMatrixWorld(true);
    if (g) {
      const wall = wallGrid(this.wallMaterial, g.map);
      wall.repeat.set((half * 2) / g.cell, high / g.cell);
      wall.needsUpdate = true;
      const top = wallGrid(this.roofMaterial, g.map);
      top.repeat.setScalar((half * 2) / g.cell);
      top.needsUpdate = true;
    }
  }

  setCamera(c: CameraState): void {
    const { position, up } = cameraBasis(c);
    this.camera.position.set(...position);
    this.camera.up.set(...up);
    this.camera.lookAt(...c.target);
    this.camera.near = Math.max(0.1, c.distance / 1000);
    this.camera.far = c.distance * 100 + 10_000;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }

  setSize(width: number, height: number): void {
    this.size.set(width, height);
    this.renderer.setSize(width, height, false);
    this.composer.setSize(width, height);
    const pr = this.renderer.getPixelRatio();
    this.front.setSize(Math.round(width * pr), Math.round(height * pr));
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  get total(): number {
    return this.plan?.total ?? 0;
  }
  get at(): number {
    return this.time;
  }
  get isPlaying(): boolean {
    return this.playing;
  }

  /** Plays from `from` (the start by default, or where it is if it hasn't finished). */
  play(from?: number): void {
    if (from !== undefined) this.time = from;
    else if (this.time >= this.total) this.time = 0;
    this.playing = true;
    this.last = performance.now();
  }
  pause(): void {
    this.playing = false;
  }
  seek(t: number): void {
    this.time = Math.max(0, Math.min(t, this.total));
    this.draw();
  }

  /**
   * Records the animation from the start to a video, playing it as it goes. Resolves with the video, or null if the
   * browser can't record (no MediaRecorder or no format it knows). `signal` stops early, keeping nothing.
   */
  async record(signal?: AbortSignal, seeThrough = false): Promise<{ blob: Blob; type: string } | null> {
    this.seek(0);
    return recordCanvas(
      this.canvas,
      () => {
        this.play(0);
        return new Promise<void>((done) => {
          const check = () => {
            if (signal?.aborted || !this.playing) return done();
            requestAnimationFrame(check);
          };
          check();
        });
      },
      signal,
      seeThrough,
    );
  }

  private loop(now: number): void {
    this.frame = requestAnimationFrame(this.loop);
    if (this.playing) {
      // Steps of at most a tenth of a second, so a stalled tab doesn't skip the drawing.
      // A frame's time can be a little before play() was pressed (it is when the frame began), so never step back.
      this.time += Math.min(0.1, Math.max(0, (now - this.last) / 1000));
      if (this.time >= this.total) {
        this.time = this.total;
        this.playing = false;
        this.opts.onEnd?.();
      }
    }
    this.last = now;
    this.draw(now);
  }

  private draw(now = performance.now()): void {
    const c = this.opts.camera?.();
    if (c && c !== this.seen) {
      this.seen = c;
      this.setCamera(c);
    }
    const plan = this.plan;
    const t = this.time;
    if (plan) {
      for (const m of this.faceMaterials) {
        m.uniforms.uTime.value = t;
        m.uniforms.uDrawEnd.value = plan.drawEnd;
      }
      if (this.lines) {
        const u = this.lines.material.uniforms;
        u.uTime.value = t;
        // A busy picture (many edges, or the model small on screen) glows less, so it never fills with white.
        const e = this.extent;
        const away = Math.max(1e-3, this.camera.position.distanceTo(e.centre));
        const sizePx = (e.size / (2 * away * Math.tan((FOV * Math.PI) / 360))) * this.size.y;
        const scale = glowScale(e.length, e.size, LINE_WIDTH, sizePx);
        // The bloom keeps at least half its strength, so a busy model still glows.
        // It fades with the lines, so the finished model shows without any.
        this.bloom.strength = BLOOM * (0.5 + 0.5 * scale) * lineGlow(plan, t);
        u.uScale.value = scale;
        // For tests and for checking a model by hand: how far the glow is turned down.
        this.glow = scale;
        this.canvas.dataset.glow = scale.toFixed(2);
        this.canvas.dataset.cover = ((e.length / Math.max(1e-6, e.size)) * (LINE_WIDTH / Math.max(1e-6, sizePx))).toFixed(3);
        u.uGlow.value = lineGlow(plan, t) * scale;
        const pr = this.renderer.getPixelRatio();
        u.uResolution.value.set((this.size.x * pr) / 2, (this.size.y * pr) / 2);
        u.uWidth.value = LINE_WIDTH * pr;
      }
      if (this.embers) {
        const pos = this.embers.geometry.getAttribute("position") as BufferAttribute;
        const alpha = this.embers.geometry.getAttribute("aAlpha") as BufferAttribute;
        plan.embers.forEach((p, i) => {
          const e = emberAt(p, t);
          pos.setXYZ(i, ...e.at);
          // Bright while drawing, dimmer in flight, and gone once its run is done.
          const fade = e.done ? Math.max(0, 1 - (t - p.times[p.times.length - 1]) / 0.4) : e.drawing ? 1 : 0.55;
          alpha.setX(i, fade);
        });
        pos.needsUpdate = true;
        alpha.needsUpdate = true;
        const u = this.embers.material.uniforms;
        // Smaller on a busy or far-off model, so the embers don't swamp it.
        u.uSize.value = Math.max(36, Math.min(96, this.size.y * 0.09)) * this.renderer.getPixelRatio() * (0.4 + 0.6 * this.glow);
        u.uFlicker.value = 0.75 + 0.25 * Math.sin(now / 37) * Math.sin(now / 53);
      }
      if (this.playing && Math.floor(t * 10) !== this.told) {
        this.told = Math.floor(t * 10);
        this.opts.onTime?.(t, plan.total);
      }
    }
    // The front pass, then the picture, whose lines and ghosts read it.
    for (const m of this.behind) {
      const u = m.uniforms;
      u.tFront.value = this.front.texture;
      u.tFrontDepth.value = this.front.depthTexture;
      u.uScreen.value.set(this.front.width, this.front.height);
      u.uNear.value = this.camera.near;
      u.uFar.value = this.camera.far;
    }
    this.renderer.setRenderTarget(this.front);
    this.renderer.clear();
    this.renderer.render(this.frontScene, this.camera);
    this.renderer.setRenderTarget(null);
    this.composer.render();
  }

  private clear(): void {
    // Each body's geometry is shared by its three meshes: dispose once.
    const seen = new Set<BufferGeometry>();
    for (const c of [...this.model.children]) {
      const m = c as Mesh;
      this.model.remove(m);
      seen.add(m.geometry);
      (m.material as ShaderMaterial).dispose();
    }
    for (const c of [...this.frontScene.children]) {
      const m = c as Mesh;
      this.frontScene.remove(m);
      (m.material as ShaderMaterial).dispose();
    }
    this.behind = [];
    for (const g of seen) g.dispose();
    this.faceMaterials = [];
    for (const o of [this.lines, this.embers]) {
      if (!o) continue;
      this.scene.remove(o);
      o.geometry.dispose();
      o.material.dispose();
    }
    this.lines = null;
    this.embers = null;
    this.plan = null;
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.clear();
    this.sky?.dispose();
    this.floor.geometry.dispose();
    this.floor.material.dispose();
    (this.walls.children[0] as Mesh).geometry.dispose();
    for (const m of [this.wallMaterial, this.roofMaterial]) {
      m.map?.dispose();
      m.dispose();
    }
    this.backgrounds.dispose();
    this.saved.dispose();
    this.front.dispose();
    this.composer.dispose();
    this.renderer.dispose();
  }
}

/** For tests: the identity, so a body placed in the kernel needs no matrix. */
export const IDENTITY = new Matrix4();
