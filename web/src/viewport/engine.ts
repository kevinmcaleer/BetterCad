import {
  AlwaysStencilFunc,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  DecrementWrapStencilOp,
  DirectionalLight,
  Euler,
  FrontSide,
  Group,
  HemisphereLight,
  IncrementWrapStencilOp,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NearestFilter,
  NotEqualStencilFunc,
  Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  Plane,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Quaternion,
  Raycaster,
  Scene,
  ShaderMaterial,
  Sphere,
  Vector2,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
  ZeroStencilOp,
  BoxGeometry,
  Box3,
  EdgesGeometry,
  ArrowHelper,
  Camera,
  type Material,
  type Texture,
} from "three";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { faceCount, type BodyMesh } from "@bettercad/kernel";
import {
  DEFAULT_CAMERA,
  FOV,
  cameraBasis,
  fit as fitCamera,
  fitInRect,
  gridStep,
  halfHeight,
  lerpCamera,
  lookFrom,
  orbit,
  pan,
  presetOf,
  toPreset,
  zoom,
  type CameraState,
  type Preset,
  type V3,
  type ViewRect,
} from "./camera";
import { FACE_ONLY, encodeId, findPick, samePick, type Pick, type SelectFilter } from "./ids";
import { edgesOnOutline } from "./faceEdges";
import { blurMaterial, capMaterial, dofMaterial, gridMaterial, outlineMaterial, pickMaterial, QUAD_VERT } from "./shaders";
import { readPalette, type Palette } from "./colours";

export type RenderStyle = "shaded" | "lineart";

/**
 * A step's result shown while its tool is open (Fillet, Shell, Combine). A body with a mesh is drawn from that mesh in
 * place of its own; a dim one is drawn see-through (a body a combine uses up). Picks still land on the bodies as they
 * are, so edges and faces keep their numbers while the preview changes.
 */
export interface PreviewBody {
  id: string;
  /** The result, in world space. */
  mesh?: BodyMesh;
  dim?: boolean;
}

export interface EngineBody {
  id: string;
  mesh: BodyMesh;
  position: { x: number; y: number; z: number };
  /** Degrees, applied Z, then Y, then X (as Layers does). */
  rotation?: { x: number; y: number; z: number };
  ghost?: boolean;
  highlight?: boolean;
  /** Off the printer's bed (#100): tinted warn. */
  warn?: boolean;
  /** A reference body (#185): there to design around, never printed. Drawn see-through in the accent colour. */
  reference?: boolean;
  /** The mesh is already in place (the kernel built it there); position and rotation only place the gizmo. */
  world?: boolean;
  /** The body's own colour (#196), sRGB "#rrggbb", in place of the theme's part colour. */
  colour?: string;
}

/**
 * A tool that takes the pointer (sketching). While set, the left button and hover go to it instead of orbiting and
 * picking; the right button still pans and the wheel still zooms.
 */
export interface EngineInput {
  /** Return false to let the press orbit the view as usual. */
  down?(p: ScreenPoint, mods: Mods): boolean;
  move?(p: ScreenPoint, mods: Mods, pressed: boolean): void;
  up?(p: ScreenPoint, mods: Mods): void;
  leave?(): void;
  /** The press ended without an up: a second finger landed to pinch, or the browser took the pointer. */
  cancel?(): void;
}
/** A drag that took a body (#173): told where the pointer goes, then that it ended or was called off. */
export interface BodyDrag {
  move(p: ScreenPoint, mods: Mods): void;
  end(): void;
  cancel(): void;
}
export interface ScreenPoint {
  x: number;
  y: number;
}
export interface Mods {
  shift: boolean;
  mod: boolean;
  alt: boolean;
  /** A finger, not a mouse: snapping reaches further. */
  touch?: boolean;
}
export type WorldPlaneName = "XY" | "XZ" | "YZ";

export interface Section {
  origin: V3;
  normal: V3;
  /** How far the plane has been pushed along the normal from origin, mm. */
  offset: number;
}

export interface Stats {
  ms: number;
  fps: number;
  triangles: number;
  calls: number;
  bodies: number;
}

export interface EngineEvents {
  /** The camera moved (once per frame at most). */
  camera?: (c: CameraState) => void;
  /** A click without a drag, with what was under it (null: empty space). */
  click?: (pick: Pick | null, mods: { shift: boolean; mod: boolean }, at: { x: number; y: number }) => void;
  /**
   * A long press with a finger, or a right click without a drag: what was under it, and where on the page
   * (client coordinates) to open a menu.
   */
  menu?: (pick: Pick | null, at: { x: number; y: number }) => void;
  /** The gizmo finished a drag: the body's new place. */
  transform?: (id: string, position: V3, rotation: V3) => void;
  /** The gizmo is dragging: live values to show. */
  transforming?: (id: string, position: V3, rotation: V3) => void;
  /** The section arrow was dragged. */
  section?: (offset: number) => void;
  /**
   * A left press on a body has started to drag (#173): return a handler to move it (posing a joint), or null to orbit
   * as usual.
   */
  bodyDrag?: (pick: Pick, at: ScreenPoint) => BodyDrag | null;
  stats?: (s: Stats) => void;
}

const DEG = Math.PI / 180;
const PICK_SIZE = 15;
/** A finger covers more than a cursor: the square it picks from, in CSS pixels. */
const TOUCH_PICK = 33;
/** How far a press moves before it is a drag rather than a tap or click, in CSS pixels. */
const DRAG_MOUSE = 4;
const DRAG_TOUCH = 10;
/** How long a finger rests still before it counts as a right click. */
const LONG_PRESS_MS = 500;

/** The pick square in device pixels: odd, so it has a centre. */
export function pickSize(touch: boolean, dpr: number): number {
  if (!touch) return PICK_SIZE;
  const n = Math.min(99, Math.max(PICK_SIZE, Math.round(TOUCH_PICK * dpr)));
  return n % 2 ? n : n + 1;
}
/** The Holodeck's widest depth-of-field blur, as a fraction of the view's height. */
const DOF_BLUR = 0.016;

/** Three's matrix for a body's place: move, then turn about its origin. */
export function bodyMatrix(b: { position: EngineBody["position"]; rotation?: EngineBody["rotation"] }): Matrix4 {
  const r = b.rotation ?? { x: 0, y: 0, z: 0 };
  const m = new Matrix4().makeRotationFromEuler(new Euler(r.x * DEG, r.y * DEG, r.z * DEG, "ZYX"));
  return m.setPosition(b.position.x, b.position.y, b.position.z);
}

interface BodyObjects {
  body: EngineBody;
  index: number;
  group: Group;
  geometry: BufferGeometry;
  shaded: Mesh;
  shadedMaterial: MeshStandardMaterial;
  flat: Mesh;
  flatMaterial: MeshBasicMaterial;
  edges: LineSegments;
  edgeGeometry: BufferGeometry;
  creases: LineSegments2;
  creaseGeometry: LineSegmentsGeometry;
  pick: Group;
  pickMaterials: ShaderMaterial[];
  pointGeometry: BufferGeometry;
  idMesh: Mesh;
  idMaterial: MeshBasicMaterial;
  stencil: Mesh[];
  /** The face each vertex belongs to. */
  faceOfVertex: Uint32Array;
}

/** The face index of every vertex, from the mesh's face ranges. */
function facesOfVertices(m: BodyMesh): Uint32Array {
  const out = new Uint32Array(m.positions.length / 3);
  for (let f = 0; f < faceCount(m); f++) out.fill(f, m.faceVerts[f]!, m.faceVerts[f + 1]!);
  return out;
}

/** Per-segment element IDs for edges (both ends of a segment carry its edge). */
function edgeElements(m: BodyMesh): Float32Array {
  const out = new Float32Array(m.edgePositions.length / 3);
  for (let e = 0; e < m.edgeSegs.length - 1; e++) out.fill(e, m.edgeSegs[e]! * 2, m.edgeSegs[e + 1]! * 2);
  return out;
}

/**
 * The 3D view: one WebGL canvas drawing the bodies the kernel hands it, with the grid (or the Holodeck room), the
 * gizmo, the section and ID-buffer picking. It draws only when something changes.
 */
export class Engine {
  readonly renderer: WebGLRenderer;
  private scene = new Scene();
  private pickScene = new Scene();
  private idScene = new Scene();
  private quadScene = new Scene();
  private quadCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private persp = new PerspectiveCamera(FOV, 1, 0.1, 10_000);
  private ortho = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10_000);
  private cam: CameraState = { ...DEFAULT_CAMERA };
  private tween: { from: CameraState; to: CameraState; start: number; ms: number } | null = null;
  private palette: Palette;
  private style: RenderStyle = "shaded";
  private bodies = new Map<string, BodyObjects>();
  private order: BodyObjects[] = [];
  /** The preview on show: what each body it changes is drawn as, and the objects drawing it. */
  private previewOf = new Map<string, PreviewBody>();
  private previews: BodyObjects[] = [];
  private grid: Mesh;
  private gridMat = gridMaterial(false);
  private room: Mesh;
  private roomMat = gridMaterial(true);
  private roomOn = false;
  /** Off while a sketch draws its own grid on its plane. */
  private floorGrid = true;
  // Depth of field: the room drawn on its own, blurred where it is far from the model, then laid down as the background.
  private dofScene = new Scene();
  private dofRoomMat = gridMaterial(true);
  private blur = blurMaterial();
  private dof = dofMaterial();
  private dofRoom: Mesh;
  private dofQuad: Mesh;
  private dofQuadScene = new Scene();
  private dofTargets: { sharp: WebGLRenderTarget; a: WebGLRenderTarget; b: WebGLRenderTarget } | null = null;
  private headlight = new DirectionalLight();
  private hemi = new HemisphereLight();
  private top = new DirectionalLight();
  private pickTarget = new WebGLRenderTarget(PICK_SIZE, PICK_SIZE, { minFilter: NearestFilter, magFilter: NearestFilter });
  private idTarget: WebGLRenderTarget | null = null;
  private outline = outlineMaterial();
  private pickBuffer = new Uint8Array(PICK_SIZE * PICK_SIZE * 4);
  /** The last press came from a finger: picks look further around the point. */
  private touchPick = false;
  private dirty = true;
  private frame = 0;
  private disposed = false;
  private width = 1;
  private height = 1;

  // Selection and hover
  private filter: SelectFilter = "body";
  private selected: Pick[] = [];
  private hover: Pick | null = null;
  private hoverEnabled = true;
  private selectLines: LineSegments2;
  private hoverLines: LineSegments2;
  private selectMat = new LineMaterial({ linewidth: 3, worldUnits: false });
  private hoverMat = new LineMaterial({ linewidth: 2, worldUnits: false });
  private markers: Points;
  private markerMat = new PointsMaterial({ size: 10, sizeAttenuation: false });
  /** The origin point, shown from the browser and while picking a plane: a dot at (0, 0, 0) over everything. */
  private originMat = new PointsMaterial({ size: 9, sizeAttenuation: false, depthTest: false, transparent: true });
  private originPoint = new Points(new BufferGeometry().setAttribute("position", new BufferAttribute(new Float32Array(3), 3)), this.originMat);
  private originPointShown = false;

  // Gizmo
  private gizmo: TransformControls;
  private proxy = new Object3D();
  private gizmoBody: string | null = null;

  // Section
  private section: Section | null = null;
  private clip = new Plane();
  private cap: Mesh;
  private capMat = capMaterial();
  private arrow: ArrowHelper;
  /** Joint glyphs (#172): an arrow along each joint's axis, from its origin. */
  private jointArrows = new Group();
  private centres = new Group();
  private arrowDrag: { startOffset: number; x: number; y: number } | null = null;

  // Input
  private pointers = new Map<number, { x: number; y: number }>();
  private press: {
    x: number;
    y: number;
    button: number;
    shift: boolean;
    dragged: boolean;
    mod: boolean;
    input?: boolean;
    touch?: boolean;
    id?: number;
    /** A long press opened the menu: the rest of the press does nothing. */
    held?: boolean;
    /** The press took a body to drag (#173). */
    body?: BodyDrag;
  } | null = null;
  private holdTimer = 0;
  private pinch: { d: number; mid: { x: number; y: number } } | null = null;
  private hoverAt: { x: number; y: number } | null = null;
  private hoverFrame = 0;

  // Sketching: a tool that takes the pointer, overlays it draws, origin planes to pick
  private input: EngineInput | null = null;
  private overlays = new Set<Object3D>();
  private lineMats = new Set<LineMaterial>();
  private planes: Group;
  private planeHover: WorldPlaneName | null = null;
  /** Picking a sketch plane: all three show and answer the pointer. */
  private planesPicking = false;
  /** The origin planes on show from the browser, outside picking. */
  private originShown: WorldPlaneName[] = [];
  /** The origin plane chosen in the browser, drawn brighter. */
  private planeChosen: WorldPlaneName | null = null;

  // Stats
  private statsOn = false;
  private frameTimes: number[] = [];
  private lastFrame = 0;

  constructor(
    readonly canvas: HTMLCanvasElement,
    private events: EngineEvents = {},
  ) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, stencil: true, preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.localClippingEnabled = true;
    this.palette = readPalette();
    for (const c of [this.persp, this.ortho]) c.up.set(0, 0, 1);

    // Soft studio light: a sky-and-floor fill, a key light that follows the camera from the upper left, and a
    // light from straight above, so faces at different angles read as different greys.
    this.persp.add(this.headlight);
    this.headlight.position.set(-0.6, 0.8, 1);
    this.headlight.intensity = 1.25;
    this.hemi.intensity = 0.75;
    this.hemi.position.set(0, 0, 1);
    this.top.position.set(0.3, -0.2, 1);
    this.top.intensity = 0.55;
    this.scene.add(this.persp, this.ortho, this.hemi, this.top);
    // The key light follows whichever camera draws.
    const orthoKey = this.headlight.clone();
    this.ortho.add(orthoKey);
    // A directional light shines from its position towards its target, so the targets ride with the cameras too.
    this.persp.add(this.headlight.target);
    this.headlight.target.position.set(0, 0, -1);
    this.ortho.add(orthoKey.target);
    orthoKey.target.position.set(0, 0, -1);

    this.grid = new Mesh(new PlaneGeometry(1, 1), this.gridMat);
    this.grid.renderOrder = -1;
    this.grid.frustumCulled = false;
    this.scene.add(this.grid);
    const roomGeo = new BoxGeometry(1, 1, 1).translate(0, 0, 0.5);
    this.room = new Mesh(roomGeo, this.roomMat);
    this.room.visible = false;
    this.room.frustumCulled = false;
    this.room.renderOrder = -2;
    this.scene.add(this.room);
    // The blurred room shares the room's uniforms, so the grid step, fade and eye stay in step.
    this.dofRoomMat.uniforms = {
      ...this.roomMat.uniforms,
      dof: { value: 1 },
      focus: { value: 100 },
      range: { value: 100 },
      bg: { value: new Color() },
    };
    Object.assign(this.dofRoomMat, { transparent: false, polygonOffset: false });
    this.dofRoom = new Mesh(roomGeo, this.dofRoomMat);
    this.dofRoom.frustumCulled = false;
    this.dofScene.add(this.dofRoom);
    this.dofQuad = new Mesh(new PlaneGeometry(2, 2), this.blur);
    this.dofQuad.frustumCulled = false;
    this.dofQuadScene.add(this.dofQuad);

    this.selectLines = new LineSegments2(new LineSegmentsGeometry(), this.selectMat);
    this.hoverLines = new LineSegments2(new LineSegmentsGeometry(), this.hoverMat);
    for (const l of [this.selectLines, this.hoverLines]) {
      l.renderOrder = 5;
      l.frustumCulled = false;
      l.visible = false;
      (l.material as LineMaterial).depthTest = true;
      this.scene.add(l);
    }
    this.markers = new Points(new BufferGeometry(), this.markerMat);
    this.markers.renderOrder = 6;
    this.markers.frustumCulled = false;
    this.markerMat.depthTest = false;
    this.scene.add(this.markers);

    this.gizmo = new TransformControls(this.persp, canvas);
    this.gizmo.setSpace("world");
    this.gizmo.setSize(0.9);
    this.gizmo.attach(this.proxy);
    this.scene.add(this.proxy);
    const helper = this.gizmo.getHelper();
    helper.visible = false;
    this.scene.add(helper);
    this.gizmo.enabled = false;
    this.gizmo.addEventListener("change", () => this.invalidate());
    this.gizmo.addEventListener("objectChange", () => this.onGizmoMove(false));
    this.gizmo.addEventListener("mouseUp", () => this.onGizmoMove(true));

    this.cap = new Mesh(new PlaneGeometry(1, 1), this.capMat);
    this.cap.visible = false;
    this.cap.renderOrder = 3;
    this.cap.frustumCulled = false;
    Object.assign(this.capMat, {
      stencilWrite: true,
      stencilRef: 0,
      stencilFunc: NotEqualStencilFunc,
      stencilFail: ZeroStencilOp,
      stencilZFail: ZeroStencilOp,
      stencilZPass: ZeroStencilOp,
    });
    this.cap.onAfterRender = (r) => r.clearStencil();
    this.scene.add(this.cap);
    this.arrow = new ArrowHelper(new Vector3(0, 0, 1), new Vector3(), 30);
    this.arrow.visible = false;
    this.scene.add(this.arrow);
    this.scene.add(this.jointArrows);
    this.scene.add(this.centres);

    this.planes = new Group();
    this.planes.visible = false;
    this.planes.renderOrder = 4;
    // Each square sits in its plane's positive quadrant, as Fusion's do: XZ turns X-up about X; YZ then turns about Z.
    const planeTurn: Record<WorldPlaneName, [number, number, number]> = { XY: [0, 0, 0], XZ: [Math.PI / 2, 0, 0], YZ: [Math.PI / 2, 0, Math.PI / 2] };
    for (const name of ["XY", "XZ", "YZ"] as WorldPlaneName[]) {
      const m = new Mesh(
        new PlaneGeometry(1, 1).translate(0.5, 0.5, 0),
        new MeshBasicMaterial({ transparent: true, opacity: 0.15, depthWrite: false, side: 2 }),
      );
      m.name = name;
      m.rotation.set(...planeTurn[name], "ZYX");
      this.planes.add(m);
    }
    this.scene.add(this.planes);
    this.originPoint.visible = false;
    this.originPoint.renderOrder = 6;
    this.originPoint.frustumCulled = false;
    this.scene.add(this.originPoint);

    const quad = new Mesh(new PlaneGeometry(2, 2), this.outline);
    quad.frustumCulled = false;
    this.quadScene.add(quad);

    this.applyPalette();
    this.listen();
    this.applyCamera();
  }

  // ------------------------------------------------------------ public API

  get camera(): CameraState {
    return this.cam;
  }

  /** Where the camera is heading: the end of a glide, or where it is when still. Saved views take this. */
  get goal(): CameraState {
    return this.tween?.to ?? this.cam;
  }

  private get activeCamera(): PerspectiveCamera | OrthographicCamera {
    return this.cam.ortho ? this.ortho : this.persp;
  }

  /** The canvas size in CSS pixels. */
  get size(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  /** Shows or hides the floor grid (the Holodeck room stays). A sketch hides it while it draws its own. */
  setFloorGrid(on: boolean): void {
    if (this.floorGrid === on) return;
    this.floorGrid = on;
    this.grid.visible = !this.roomOn && on;
    this.invalidate();
  }

  setSize(width: number, height: number): void {
    this.width = Math.max(1, Math.round(width));
    this.height = Math.max(1, Math.round(height));
    this.renderer.setSize(this.width, this.height, false);
    const r = new Vector2();
    this.renderer.getDrawingBufferSize(r);
    for (const m of [this.selectMat, this.hoverMat]) m.resolution.set(this.width, this.height);
    for (const b of [...this.order, ...this.previews]) (b.creases.material as LineMaterial).resolution.set(this.width, this.height);
    for (const m of this.lineMats) m.resolution.set(this.width, this.height);
    this.idTarget?.dispose();
    this.idTarget = null;
    this.disposeDof();
    this.outline.uniforms.px!.value.set(1 / r.x, 1 / r.y);
    this.applyCamera();
  }

  /** Re-reads the theme's colours; `room` turns on the Holodeck room. */
  setTheme(room: boolean): void {
    this.palette = readPalette();
    this.roomOn = room;
    this.applyPalette();
    if (this.bedSpec) this.setBed(this.bedSpec);
    this.recolourAll();
    this.invalidate();
  }

  setStyle(style: RenderStyle): void {
    this.style = style;
    for (const b of [...this.order, ...this.previews]) this.applyStyle(b);
    this.invalidate();
  }

  setCamera(c: CameraState, animate = false): void {
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (animate && !reduce) {
      this.tween = { from: this.cam, to: c, start: performance.now(), ms: 280 };
    } else {
      this.tween = null;
      this.cam = c;
      this.applyCamera();
    }
    this.invalidate();
  }

  preset(p: Preset): void {
    this.setCamera(toPreset(this.tween?.to ?? this.cam, p), true);
  }

  /** Glides round to look from `dir` (a view cube face, edge or corner). */
  lookFrom(dir: V3): void {
    this.setCamera(lookFrom(this.tween?.to ?? this.cam, dir), true);
  }

  /** Turns the view by a drag on the view cube, in pixels; stops any glide. */
  orbitBy(dxPx: number, dyPx: number): void {
    this.setCamera(orbit(this.cam, -dxPx * 0.5, dyPx * 0.5));
  }

  /** Goes home: to `camera` when one is set, else the corner view with the model fitted. Keeps the projection. */
  home(camera?: CameraState | null): void {
    if (camera) {
      this.setCamera({ ...camera, ortho: this.cam.ortho }, true);
      return;
    }
    this.preset("iso");
    this.fit();
  }

  setOrtho(on: boolean): void {
    this.setCamera({ ...this.cam, ortho: on });
  }

  /**
   * The part of the view no floating panel covers, in CSS px from the canvas's top left. Fit frames the model in it.
   * The app measures it; the engine never reads the DOM.
   */
  private safeArea: (() => ViewRect | null) | null = null;
  setSafeArea(fn: (() => ViewRect | null) | null): void {
    this.safeArea = fn;
  }

  /** Frames a box in world space (a print check's area, #101, #102). */
  fitBox(min: [number, number, number], max: [number, number, number]): void {
    const c: [number, number, number] = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
    const r = Math.max(Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2, 5);
    this.setCamera(fitInRect(this.tween?.to ?? this.cam, c, r * 1.4, this.width, this.height, this.safeArea?.()), true);
  }

  /**
   * A print check's tint (#101, #102): per body, a value per vertex from 0 (fine) to 1 (worst), blended to warn.
   * null clears it.
   */
  setCheck(values: Map<string, Float32Array> | null): void {
    this.check = values;
    this.recolourAll();
    this.invalidate();
  }
  private check: Map<string, Float32Array> | null = null;

  /** Frames the given bodies (all when empty). */
  fit(ids?: string[]): void {
    const s = this.bounds(ids?.length ? ids : undefined);
    const base = this.tween?.to ?? this.cam;
    if (!s) {
      this.setCamera({ ...base, target: [0, 0, 10], distance: DEFAULT_CAMERA.distance }, true);
      return;
    }
    this.setCamera(fitInRect(base, [s.center.x, s.center.y, s.center.z], s.radius, this.width, this.height, this.safeArea?.()), true);
  }

  /**
   * The printer's bed (#100): a plate at Z = 0 with its outline, the build volume as a faint box, and the slicer's
   * origin marked (centre, or the front-left corner). null takes it away. The grid stays for snapping.
   */
  setBed(bed: { x: number; y: number; z: number; origin: "centre" | "corner"; label?: string } | null): void {
    if (this.bed) {
      this.scene.remove(this.bed);
      this.bed.traverse((o) => {
        const m = o as Mesh;
        m.geometry?.dispose();
        const mat = m.material as (Material & { map?: Texture | null }) | undefined;
        mat?.map?.dispose();
        mat?.dispose();
      });
      this.bed = null;
    }
    if (bed) {
      const g = new Group();
      g.name = "bed";
      const p = this.palette;
      const plate = new Mesh(
        new PlaneGeometry(bed.x, bed.y),
        new MeshBasicMaterial({
          color: p.rail,
          transparent: true,
          opacity: 0.55,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: 1,
          polygonOffsetUnits: 1,
        }),
      );
      plate.renderOrder = -0.5;
      const box = new BoxGeometry(bed.x, bed.y, bed.z).translate(0, 0, bed.z / 2);
      const volume = new Mesh(box, new MeshBasicMaterial({ color: p.snap, transparent: true, opacity: 0.08, depthWrite: false, side: BackSide }));
      const edges = new LineSegments(new EdgesGeometry(box), new LineBasicMaterial({ color: p.snap, transparent: true, opacity: 0.35 }));
      const rim = new LineSegments(new EdgesGeometry(new PlaneGeometry(bed.x, bed.y)), new LineBasicMaterial({ color: p.line }));
      // The origin: a small cross where the slicer's 0,0 is.
      const o: [number, number] = bed.origin === "corner" ? [-bed.x / 2, -bed.y / 2] : [0, 0];
      const k = Math.min(bed.x, bed.y) * 0.04;
      const cross = new BufferGeometry().setAttribute(
        "position",
        new BufferAttribute(new Float32Array([o[0] - k, o[1], 0.05, o[0] + k, o[1], 0.05, o[0], o[1] - k, 0.05, o[0], o[1] + k, 0.05]), 3),
      );
      const mark = new LineSegments(cross, new LineBasicMaterial({ color: p.muted }));
      for (const m of [plate, volume, edges, rim, mark]) {
        m.userData.bed = true;
        g.add(m);
      }
      // The printer's name on the floor loads on its own, off the first-paint bundle.
      const text = bed.label;
      if (text)
        void import("./bedLabel").then(({ bedLabelMesh }) => {
          if (this.bed !== g) return; // a different bed, or none, since
          const label = bedLabelMesh(text, bed.x, bed.y, p.snap);
          if (!label) return;
          label.userData.bed = true;
          g.add(label);
          this.invalidate();
        });
      this.bed = g;
      this.bedSpec = bed;
      this.scene.add(g);
    } else this.bedSpec = null;
    this.invalidate();
  }
  private bed: Group | null = null;
  private bedSpec: { x: number; y: number; z: number; origin: "centre" | "corner"; label?: string } | null = null;

  /** Puts the bodies on stage, reusing what has not changed. */
  setBodies(list: EngineBody[]): void {
    const keep = new Set(list.map((b) => b.id));
    for (const [id, o] of this.bodies) {
      if (!keep.has(id)) {
        this.removeBody(o);
        this.bodies.delete(id);
      }
    }
    this.order = list.map((b, i) => {
      let o = this.bodies.get(b.id);
      if (o && o.body.mesh !== b.mesh) {
        this.removeBody(o);
        o = undefined;
      }
      if (!o) {
        o = this.makeBody(b, i);
        this.bodies.set(b.id, o);
      }
      o.body = b;
      o.index = i;
      for (const m of o.pickMaterials) m.uniforms.body!.value = i;
      o.idMaterial.color.setRGB(
        ...(encodeId(i, 0)
          .slice(0, 3)
          .map((v) => v / 255) as [number, number, number]),
      );
      this.place(o);
      this.applyStyle(o);
      return o;
    });
    this.selected = this.selected.filter((p) => keep.has(p.body));
    if (this.hover && !keep.has(this.hover.body)) this.hover = null;
    this.recolourAll();
    this.syncGizmo();
    this.invalidate();
  }

  /** Puts a body where it is drawn: its own placement, then the pose (#173) when its link has moved. */
  private place(o: BodyObjects): void {
    const m = o.body.world ? new Matrix4() : bodyMatrix(o.body);
    const posed = this.poseOf.get(o.body.id);
    if (posed) m.premultiply(posed);
    for (const g of [o.group, o.pick, o.idMesh]) {
      g.matrixAutoUpdate = false;
      g.matrix.copy(m);
      g.matrixWorldNeedsUpdate = true;
    }
  }

  /**
   * Poses bodies (#173): each body's move from home, by body id, or none. Moves the drawn meshes only, so posing never
   * waits on the kernel.
   */
  setPose(moves: Map<string, Matrix4> | null): void {
    if (!moves?.size && !this.poseOf.size) return;
    this.poseOf = moves ?? new Map();
    for (const o of this.order) this.place(o);
    this.invalidate();
  }
  private poseOf = new Map<string, Matrix4>();

  /** Shows a step's result over the bodies it changes, or takes it away (null). See PreviewBody. */
  setPreview(list: PreviewBody[] | null): void {
    if (!list?.length && !this.previewOf.size) return;
    this.clearPreviews();
    this.previewOf = new Map((list ?? []).map((p) => [p.id, p]));
    for (const p of list ?? []) {
      const owner = this.bodies.get(p.id);
      if (!p.mesh || !owner) continue;
      // Drawn like a body, but never picked: picks stay on the body as it is. The outline takes the body's ID.
      const o = this.makeBody({ id: p.id, mesh: p.mesh, world: true, position: { x: 0, y: 0, z: 0 }, colour: owner.body.colour }, owner.index);
      this.pickScene.remove(o.pick);
      o.idMaterial.color.copy(owner.idMaterial.color);
      this.previews.push(o);
    }
    for (const o of [...this.order, ...this.previews]) this.applyStyle(o);
    this.recolourAll();
    this.invalidate();
  }

  setSelection(picks: Pick[]): void {
    this.selected = picks;
    this.recolourAll();
    this.invalidate();
  }

  setFilter(filter: SelectFilter): void {
    this.filter = filter;
    this.setHover(null);
  }

  /** Hover highlighting on or off (off while a tool that does not pick is armed). */
  setHoverEnabled(on: boolean): void {
    this.hoverEnabled = on;
    if (!on) this.setHover(null);
  }

  /** Shows the gizmo on a body, or hides it (null). */
  setGizmo(id: string | null, mode: "translate" | "rotate" = "translate"): void {
    this.gizmoBody = id;
    this.gizmo.setMode(mode);
    this.syncGizmo();
    this.invalidate();
  }

  /** Shift snaps the gizmo to 5 mm and 15° steps. */
  setSnap(on: boolean): void {
    this.gizmo.setTranslationSnap(on ? 5 : null);
    this.gizmo.setRotationSnap(on ? 15 * DEG : null);
  }

  setSection(s: Section | null, showArrow = false): void {
    this.section = s;
    const planes = s ? [this.clip] : [];
    if (s) {
      const n = new Vector3(...s.normal).normalize();
      const o = new Vector3(...s.origin).addScaledVector(n, s.offset);
      this.clip.set(n.clone().negate(), n.dot(o));
      const r = Math.max(this.bounds()?.radius ?? 100, 50) * 4;
      this.cap.position.copy(o);
      this.cap.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), n);
      this.cap.scale.set(r, r, 1);
      this.arrow.position.copy(o);
      this.arrow.setDirection(n);
      const len = Math.max(20, halfHeight(this.cam) * 0.25);
      this.arrow.setLength(len, len * 0.3, len * 0.15);
    }
    this.cap.visible = !!s;
    this.arrow.visible = !!s && showArrow;
    for (const b of this.order) {
      for (const m of [b.shadedMaterial, b.flatMaterial, b.edges.material as Material, b.creases.material as Material]) m.clippingPlanes = planes;
      for (const m of b.pickMaterials) m.clippingPlanes = planes;
      for (const st of b.stencil) {
        st.visible = !!s;
        (st.material as Material).clippingPlanes = planes;
      }
    }
    for (const m of [this.selectMat, this.hoverMat]) m.clippingPlanes = planes;
    this.invalidate();
  }

  /** Marks each link's centre of mass (#174) with a small three-axis cross, drawn over the bodies, or none. */
  setCentres(list: V3[] | null): void {
    for (const c of this.centres.children as LineSegments[]) {
      c.geometry.dispose();
      (c.material as Material).dispose();
    }
    this.centres.clear();
    if (list?.length) {
      const r = Math.max(4, (this.bounds()?.radius ?? 50) * 0.06);
      const pts: number[] = [];
      for (const [x, y, z] of list) pts.push(x - r, y, z, x + r, y, z, x, y - r, z, x, y + r, z, x, y, z - r, x, y, z + r);
      const g = new BufferGeometry();
      g.setAttribute("position", new BufferAttribute(new Float32Array(pts), 3));
      const line = new LineSegments(g, new LineBasicMaterial({ color: this.palette.snap, depthTest: false, transparent: true }));
      line.renderOrder = 6;
      this.centres.add(line);
    }
    this.invalidate();
  }

  /** Shows an arrow along each joint's axis (#172), or none. Drawn over the bodies so it shows inside them. */
  setJoints(list: { origin: V3; axis: V3 }[] | null): void {
    for (const a of this.jointArrows.children as ArrowHelper[]) a.dispose();
    this.jointArrows.clear();
    const len = Math.max(15, (this.bounds()?.radius ?? 50) * 0.3);
    for (const j of list ?? []) {
      const a = new ArrowHelper(new Vector3(...j.axis).normalize(), new Vector3(...j.origin), len, this.palette.snap, len * 0.25, len * 0.12);
      a.renderOrder = 6;
      a.traverse((o) => {
        const m = (o as Mesh).material as Material | undefined;
        if (m) {
          m.depthTest = false;
          m.transparent = true;
        }
      });
      this.jointArrows.add(a);
    }
    this.invalidate();
  }

  showStats(on: boolean): void {
    this.statsOn = on;
    this.frameTimes = [];
    this.invalidate();
  }

  /**
   * What is under a point (CSS px from the canvas's top left), for the filter given. Ghosted bodies are passed over
   * unless `ghosts` (a sketch ghosts the model, but its edges can still be sized to).
   */
  pick(x: number, y: number, filter: SelectFilter = this.filter, ghosts = false): Pick | null {
    if (!this.order.length) return null;
    const cam = this.activeCamera;
    const dpr = this.renderer.getPixelRatio();
    const W = this.width * dpr;
    const H = this.height * dpr;
    const size = pickSize(this.touchPick, dpr);
    if (this.pickTarget.width !== size) {
      this.pickTarget.setSize(size, size);
      this.pickBuffer = new Uint8Array(size * size * 4);
    }
    const half = (size - 1) / 2;
    cam.setViewOffset(W, H, x * dpr - half, y * dpr - half, size, size);
    for (const b of this.order) {
      const [faces, lines, points] = b.pick.children as [Mesh, LineSegments, Points];
      b.pick.visible = !b.body.ghost || filter === "body" || ghosts;
      lines.visible = filter === "edge";
      points.visible = filter === "vertex";
      const faceElement = filter === "face" ? 0 : FACE_ONLY;
      faces.geometry.setAttribute("element", faceElement === 0 ? (faces.userData.faceIds as BufferAttribute) : (faces.userData.faceOnly as BufferAttribute));
    }
    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    const clear = r.getClearColor(new Color());
    const alpha = r.getClearAlpha();
    r.setRenderTarget(this.pickTarget);
    r.setClearColor(0x000000, 0);
    r.clear();
    r.render(this.pickScene, cam);
    r.readRenderTargetPixels(this.pickTarget, 0, 0, size, size, this.pickBuffer);
    r.setRenderTarget(prevTarget);
    r.setClearColor(clear, alpha);
    cam.clearViewOffset();
    // The ID pass is upside down relative to the cursor's square; findPick only measures distance, so it does not matter.
    const hit = findPick(this.pickBuffer, size, filter, this.touchPick);
    if (!hit) return null;
    const b = this.order[hit.body];
    if (!b) return null;
    return { body: b.body.id, kind: filter, index: filter === "body" ? 0 : hit.element };
  }

  /** The surface point and normal under a point, for the section tool. */
  surfaceAt(x: number, y: number): { body: string; point: V3; normal: V3 } | null {
    const ray = new Raycaster();
    ray.setFromCamera(new Vector2((x / this.width) * 2 - 1, -(y / this.height) * 2 + 1), this.activeCamera);
    const meshes = this.order.map((b) => (this.style === "shaded" ? b.shaded : b.flat));
    const hit = ray.intersectObjects(meshes, false)[0];
    if (!hit?.face) return null;
    const body = this.order.find((b) => b.shaded === hit.object || b.flat === hit.object)!;
    const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
    return { body: body.body.id, point: [hit.point.x, hit.point.y, hit.point.z], normal: [n.x, n.y, n.z] };
  }

  // ------------------------------------------------------------ sketching hooks

  /** Lights up a face, edge or body as if hovered (the sketch plane picker). */
  showHover(p: Pick | null): void {
    this.setHover(p);
  }

  /** Hands the pointer to a tool (or back to the view, with null). */
  setInput(input: EngineInput | null): void {
    this.input = input;
    if (input) this.setHover(null);
    this.canvas.style.cursor = input ? "crosshair" : "";
  }

  /** Adds an object drawn over the model (a sketch). Line materials in it get the canvas size. */
  addOverlay(o: Object3D): void {
    this.overlays.add(o);
    this.scene.add(o);
    o.traverse((c) => {
      const m = (c as { material?: unknown }).material;
      if (m instanceof LineMaterial) this.lineMat(m);
    });
    this.invalidate();
  }

  removeOverlay(o: Object3D): void {
    this.overlays.delete(o);
    this.scene.remove(o);
    this.invalidate();
  }

  /** Keeps a fat-line material's resolution in step with the canvas. */
  lineMat(m: LineMaterial): void {
    this.lineMats.add(m);
    m.resolution.set(this.width, this.height);
  }

  /** Where the pointer's ray meets a plane, or null when it runs along it. */
  rayPlane(x: number, y: number, origin: V3, normal: V3): V3 | null {
    const ray = new Raycaster();
    ray.setFromCamera(new Vector2((x / this.width) * 2 - 1, -(y / this.height) * 2 + 1), this.activeCamera);
    const plane = new Plane().setFromNormalAndCoplanarPoint(new Vector3(...normal).normalize(), new Vector3(...origin));
    const hit = ray.ray.intersectPlane(plane, new Vector3());
    return hit ? [hit.x, hit.y, hit.z] : null;
  }

  /** Millimetres per screen pixel at a world point, for tolerances and dash lengths. */
  pixelSize(at: V3): number {
    const cam = this.activeCamera;
    const { right } = cameraBasis(this.cam);
    const a = new Vector3(...at).project(cam);
    const b = new Vector3(...at).add(new Vector3(...right)).project(cam);
    const px = (Math.hypot(b.x - a.x, b.y - a.y) * this.width) / 2;
    return px > 1e-9 ? 1 / px : 1;
  }

  /** Turns to look straight at a plane, orthographic, keeping the zoom. The frame's X runs to the right when it can. */
  lookAt(origin: V3, normal: V3, animate = true): void {
    const n = new Vector3(...normal).normalize();
    const elevation = (Math.asin(Math.max(-1, Math.min(1, n.z))) * 180) / Math.PI;
    let azimuth = (Math.atan2(n.y, n.x) * 180) / Math.PI;
    // Looking straight down or up, keep +Y up the screen, as the Top view does.
    if (Math.abs(Math.abs(elevation) - 90) < 1e-6) azimuth = -90;
    const base = this.tween?.to ?? this.cam;
    this.setCamera({ ...base, target: origin, azimuth, elevation, ortho: true }, animate);
  }

  /** Shows the three origin planes to pick from, sized to the model (at least 40 mm), or hides them. */
  showPlanes(on: boolean): void {
    this.planesPicking = on;
    this.planeHover = null;
    this.layoutPlanes();
  }

  /** The origin planes to keep on show, as the browser's eyes set them, and the one chosen there. */
  setOriginPlanes(shown: WorldPlaneName[], chosen: WorldPlaneName | null = null, point = false): void {
    this.originShown = shown;
    this.planeChosen = chosen;
    this.originPointShown = point;
    this.layoutPlanes();
  }

  private layoutPlanes(): void {
    const s = this.bounds();
    const size = Math.max(40, s ? s.radius * 1.2 : 40);
    this.planes.scale.setScalar(size);
    const on = (n: WorldPlaneName) => this.planesPicking || this.originShown.includes(n) || this.planeChosen === n;
    for (const m of this.planes.children) m.visible = on(m.name as WorldPlaneName);
    this.planes.visible = this.planes.children.some((m) => m.visible);
    this.originPoint.visible = this.planesPicking || this.originPointShown;
    this.paintPlanes();
    this.invalidate();
  }

  /** The origin plane under a point, nearest first. */
  planeAt(x: number, y: number): WorldPlaneName | null {
    if (!this.planesPicking) return null;
    const ray = new Raycaster();
    ray.setFromCamera(new Vector2((x / this.width) * 2 - 1, -(y / this.height) * 2 + 1), this.activeCamera);
    this.planes.updateMatrixWorld(true);
    return (ray.intersectObjects(this.planes.children, false)[0]?.object.name as WorldPlaneName) ?? null;
  }

  hoverPlane(name: WorldPlaneName | null): void {
    if (name === this.planeHover) return;
    this.planeHover = name;
    this.paintPlanes();
    this.invalidate();
  }

  private paintPlanes(): void {
    for (const m of this.planes.children as Mesh[]) {
      const mat = m.material as MeshBasicMaterial;
      mat.color.copy(this.palette.snap);
      mat.opacity = m.name === this.planeHover || m.name === this.planeChosen ? 0.3 : 0.15;
    }
  }

  /**
   * A face's shape in world space, from its mesh: whether it is flat, its normal and centroid, and the direction of its
   * longest boundary edge (for the sketch frame's X), and the boundary itself (for projecting it into a sketch).
   */
  faceInfo(bodyId: string, face: number): { flat: boolean; normal: V3; centroid: V3; edge: V3; boundary: [V3, V3][] } | null {
    const o = this.bodies.get(bodyId);
    if (!o) return null;
    const mesh = o.body.mesh;
    const [t0, t1] = [mesh.faceTris[face], mesh.faceTris[face + 1]];
    if (t0 === undefined || t1 === undefined || t1 <= t0) return null;
    o.group.updateMatrixWorld(true);
    const m = o.group.matrixWorld;
    const P = (i: number) => new Vector3(mesh.positions[i * 3]!, mesh.positions[i * 3 + 1]!, mesh.positions[i * 3 + 2]!).applyMatrix4(m);
    const normals: Vector3[] = [];
    const centroid = new Vector3();
    let area = 0;
    const count = new Map<string, { a: number; b: number; n: number }>();
    for (let t = t0; t < t1; t++) {
      const ids = [mesh.indices[t * 3]!, mesh.indices[t * 3 + 1]!, mesh.indices[t * 3 + 2]!];
      const [a, b, c] = ids.map(P) as [Vector3, Vector3, Vector3];
      const n = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a));
      const ar = n.length() / 2;
      if (ar < 1e-12) continue;
      normals.push(n.normalize());
      centroid.addScaledVector(a.clone().add(b).add(c).divideScalar(3), ar);
      area += ar;
      for (let k = 0; k < 3; k++) {
        const [u, v] = [ids[k]!, ids[(k + 1) % 3]!];
        // Edges by position, so seams between vertex copies still pair up.
        const key = [P(u), P(v)]
          .map((q) =>
            q
              .toArray()
              .map((x) => x.toFixed(4))
              .join(),
          )
          .sort()
          .join("|");
        const e = count.get(key) ?? { a: u, b: v, n: 0 };
        e.n++;
        count.set(key, e);
      }
    }
    if (!normals.length) return null;
    const n0 = normals[0]!;
    const flat = normals.every((n) => n.dot(n0) > 1 - 1e-5);
    centroid.divideScalar(area);
    let best = new Vector3(1, 0, 0);
    let bestLen = -1;
    const boundary: [V3, V3][] = [];
    for (const e of count.values()) {
      if (e.n !== 1) continue;
      boundary.push([P(e.a).toArray() as V3, P(e.b).toArray() as V3]);
      const d = P(e.b).sub(P(e.a));
      if (d.length() > bestLen + 1e-6) {
        bestLen = d.length();
        best = d;
      }
    }
    return { flat, normal: [n0.x, n0.y, n0.z], centroid: [centroid.x, centroid.y, centroid.z], edge: [best.x, best.y, best.z], boundary };
  }

  /** An edge's points in world space, in order along it (#54: projecting it into a sketch). */
  edgePoints(bodyId: string, edge: number): V3[] | null {
    const o = this.bodies.get(bodyId);
    if (!o) return null;
    const m = o.body.mesh;
    const [s0, s1] = [m.edgeSegs[edge], m.edgeSegs[edge + 1]];
    if (s0 === undefined || s1 === undefined || s1 <= s0) return null;
    o.group.updateMatrixWorld(true);
    const at = (k: number) =>
      new Vector3(m.edgePositions[k]!, m.edgePositions[k + 1]!, m.edgePositions[k + 2]!).applyMatrix4(o.group.matrixWorld).toArray() as V3;
    const out: V3[] = [at(s0 * 6)];
    for (let s = s0; s < s1; s++) out.push(at(s * 6 + 3));
    return out;
  }

  /** A vertex's place in world space. */
  vertexPoint(bodyId: string, vertex: number): V3 | null {
    const o = this.bodies.get(bodyId);
    const v = o?.body.mesh.vertices;
    if (!o || !v || vertex * 3 + 2 >= v.length) return null;
    o.group.updateMatrixWorld(true);
    return new Vector3(v[vertex * 3]!, v[vertex * 3 + 1]!, v[vertex * 3 + 2]!).applyMatrix4(o.group.matrixWorld).toArray() as V3;
  }

  /**
   * The edges round a face, each as its points in world space, for projecting the face into a sketch as whole lines,
   * arcs and circles. Any piece of the outline no edge covers comes back as a two-point edge of its own (edge −1).
   */
  faceEdges(bodyId: string, face: number): { edge: number; points: V3[] }[] | null {
    const info = this.faceInfo(bodyId, face);
    const o = this.bodies.get(bodyId);
    if (!info || !o) return null;
    const all = Array.from({ length: o.body.mesh.edgeSegs.length - 1 }, (_, i) => this.edgePoints(bodyId, i) ?? []);
    const { edges, rest } = edgesOnOutline(all, info.boundary);
    return [...edges.map((i) => ({ edge: i, points: all[i]! })), ...rest.map(([a, b]) => ({ edge: -1, points: [a, b] }))];
  }

  /**
   * A picture of the bodies from the current camera, for a saved file's thumbnail (#79): no grid, no overlays,
   * transparent behind. A PNG data URL, or null where WebGL can't read back. Always Shaded in the Light theme's part
   * colours, with no selection, hover or check tints, so a thumbnail looks the same whatever the view was set to.
   */
  thumbnail(width = 320, height = 200): string | null {
    const look = { style: this.style, palette: this.palette, selected: this.selected, hover: this.hover, check: this.check };
    // The Light theme's colours; the background and grid are cleared or hidden anyway.
    const probe = document.body.appendChild(document.createElement("i"));
    probe.dataset.theme = "light";
    this.palette = readPalette(probe);
    probe.remove();
    Object.assign(this, { selected: [], hover: null, check: null });
    this.setStyle("shaded");
    this.recolourAll();
    try {
      return this.snapshot(width, height);
    } finally {
      Object.assign(this, look);
      this.setStyle(look.style);
      this.recolourAll();
    }
  }

  private snapshot(width: number, height: number): string | null {
    const r = this.renderer;
    const bodies = new Set<Object3D>(this.order.map((b) => b.group));
    const hidden: Object3D[] = [];
    for (const c of this.scene.children) {
      // The cameras carry the key light, so they stay.
      if (c.visible && !bodies.has(c) && !(c instanceof HemisphereLight) && !(c instanceof DirectionalLight) && !(c instanceof Camera)) {
        c.visible = false;
        hidden.push(c);
      }
    }
    const { width: w0, height: h0 } = this;
    this.width = width;
    this.height = height;
    this.applyCamera();
    const target = new WebGLRenderTarget(width, height);
    const clear = r.getClearColor(new Color());
    const alpha = r.getClearAlpha();
    try {
      r.setRenderTarget(target);
      r.setClearColor(0x000000, 0);
      r.clear();
      r.render(this.scene, this.activeCamera);
      const px = new Uint8Array(width * height * 4);
      r.readRenderTargetPixels(target, 0, 0, width, height, px);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      const img = ctx.createImageData(width, height);
      // WebGL rows run bottom up.
      for (let y = 0; y < height; y++) img.data.set(px.subarray((height - 1 - y) * width * 4, (height - y) * width * 4), y * width * 4);
      ctx.putImageData(img, 0, 0);
      return canvas.toDataURL("image/png");
    } catch {
      return null;
    } finally {
      r.setRenderTarget(null);
      r.setClearColor(clear, alpha);
      target.dispose();
      for (const c of hidden) c.visible = true;
      this.width = w0;
      this.height = h0;
      this.applyCamera();
      this.invalidate();
    }
  }

  /**
   * A thumbnail of the bodies turned by `turn` (row major, about the world origin), framed from the default view:
   * an orientation suggestion (#103) before it is applied. The scene is put back as it was.
   */
  posed(turn: number[][], width = 96, height = 64): string | null {
    // Row major in, so read as columns and transpose.
    const [r0, r1, r2] = turn as [number[], number[], number[]];
    const m = new Matrix4().fromArray([...r0, 0, ...r1, 0, ...r2, 0, 0, 0, 0, 1]).transpose();
    const saved = this.order.map((b) => b.group.matrix.clone());
    const cam = this.cam;
    const box = new Box3();
    try {
      for (const b of this.order) {
        b.group.matrix.premultiply(m);
        b.group.updateMatrixWorld(true);
        box.expandByObject(b.shaded);
      }
      if (box.isEmpty()) return null;
      const c = box.getCenter(new Vector3());
      const r = Math.max(box.getSize(new Vector3()).length() / 2, 5);
      this.cam = fitCamera({ ...DEFAULT_CAMERA, ortho: this.cam.ortho }, [c.x, c.y, c.z], r, width / height);
      return this.thumbnail(width, height);
    } finally {
      this.order.forEach((b, i) => {
        b.group.matrix.copy(saved[i]!);
        b.group.updateMatrixWorld(true);
      });
      this.cam = cam;
      this.applyCamera();
      this.invalidate();
    }
  }

  invalidate(): void {
    this.dirty = true;
    if (!this.frame && !this.disposed) this.frame = requestAnimationFrame(() => this.tick());
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    window.clearTimeout(this.holdTimer);
    cancelAnimationFrame(this.hoverFrame);
    this.unlisten();
    this.gizmo.dispose();
    for (const b of this.order) this.removeBody(b);
    this.clearPreviews();
    this.idTarget?.dispose();
    this.disposeDof();
    this.pickTarget.dispose();
    this.renderer.dispose();
  }

  // ------------------------------------------------------------ bodies

  private makeBody(b: EngineBody, index: number): BodyObjects {
    const m = b.mesh;
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(m.positions, 3));
    geometry.setAttribute("normal", new BufferAttribute(m.normals, 3));
    geometry.setAttribute("color", new BufferAttribute(new Float32Array(m.positions.length), 3));
    geometry.setIndex(new BufferAttribute(m.indices, 1));
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
    const faceOfVertex = facesOfVertices(m);

    const shadedMaterial = new MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.9,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    const shaded = new Mesh(geometry, shadedMaterial);
    const flatMaterial = new MeshBasicMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    const flat = new Mesh(geometry, flatMaterial);

    const edgeGeometry = new BufferGeometry();
    edgeGeometry.setAttribute("position", new BufferAttribute(m.edgePositions, 3));
    edgeGeometry.setAttribute("element", new BufferAttribute(edgeElements(m), 1));
    const edges = new LineSegments(edgeGeometry, new LineBasicMaterial({ transparent: true, opacity: 0.6 }));
    const creaseGeometry = new LineSegmentsGeometry();
    if (m.edgePositions.length) creaseGeometry.setPositions(m.edgePositions);
    const creaseMat = new LineMaterial({ linewidth: 1.25, worldUnits: false });
    creaseMat.resolution.set(this.width, this.height);
    const creases = new LineSegments2(creaseGeometry, creaseMat);

    const group = new Group();
    group.add(shaded, flat, edges, creases);

    // Section: back faces count up, front faces down; the cap fills where the count is not zero.
    const stencil = [BackSide, FrontSide].map((side) => {
      const mat = new MeshBasicMaterial({
        side,
        colorWrite: false,
        depthWrite: false,
        depthTest: false,
        stencilWrite: true,
        stencilFunc: AlwaysStencilFunc,
        stencilFail: side === BackSide ? IncrementWrapStencilOp : DecrementWrapStencilOp,
        stencilZFail: side === BackSide ? IncrementWrapStencilOp : DecrementWrapStencilOp,
        stencilZPass: side === BackSide ? IncrementWrapStencilOp : DecrementWrapStencilOp,
      });
      const s = new Mesh(geometry, mat);
      s.renderOrder = 2;
      s.visible = false;
      return s;
    });
    group.add(...stencil);
    this.scene.add(group);

    // Picking: faces (with their own element IDs, or FACE_ONLY), edges and points.
    const pickGeometry = new BufferGeometry();
    pickGeometry.setAttribute("position", geometry.getAttribute("position"));
    pickGeometry.setIndex(geometry.getIndex());
    const faceIds = new BufferAttribute(Float32Array.from(faceOfVertex), 1);
    const faceOnly = new BufferAttribute(new Float32Array(faceOfVertex.length).fill(FACE_ONLY), 1);
    pickGeometry.setAttribute("element", faceIds);
    const pickMaterials = [pickMaterial("face"), pickMaterial("line"), pickMaterial("point")];
    const pickFaces = new Mesh(pickGeometry, pickMaterials[0]);
    pickFaces.userData = { faceIds, faceOnly };
    const pickLines = new LineSegments(edgeGeometry, pickMaterials[1]);
    const pointGeometry = new BufferGeometry();
    pointGeometry.setAttribute("position", new BufferAttribute(m.vertices, 3));
    pointGeometry.setAttribute(
      "element",
      new BufferAttribute(
        Float32Array.from({ length: m.vertices.length / 3 }, (_, i) => i),
        1,
      ),
    );
    const pickPoints = new Points(pointGeometry, pickMaterials[2]);
    const pick = new Group();
    pick.add(pickFaces, pickLines, pickPoints);
    for (const o of [pickFaces, pickLines, pickPoints]) o.frustumCulled = false;
    this.pickScene.add(pick);

    const idMaterial = new MeshBasicMaterial();
    const idMesh = new Mesh(geometry, idMaterial);
    this.idScene.add(idMesh);

    const o: BodyObjects = {
      body: b,
      index,
      group,
      geometry,
      shaded,
      shadedMaterial,
      flat,
      flatMaterial,
      edges,
      edgeGeometry,
      creases,
      creaseGeometry,
      pick,
      pickMaterials,
      pointGeometry,
      idMesh,
      idMaterial,
      stencil,
      faceOfVertex,
    };
    if (this.section) this.setSection(this.section, this.arrow.visible);
    return o;
  }

  private removeBody(o: BodyObjects): void {
    this.scene.remove(o.group);
    this.pickScene.remove(o.pick);
    this.idScene.remove(o.idMesh);
    for (const g of [o.geometry, o.edgeGeometry, o.creaseGeometry, o.pointGeometry, (o.pick.children[0] as Mesh).geometry]) g.dispose();
    for (const m of [
      o.shadedMaterial,
      o.flatMaterial,
      o.edges.material as Material,
      o.creases.material as Material,
      o.idMaterial,
      ...o.pickMaterials,
      ...o.stencil.map((s) => s.material as Material),
    ])
      m.dispose();
  }

  private applyStyle(o: BodyObjects): void {
    const shaded = this.style === "shaded";
    o.shaded.visible = shaded;
    o.edges.visible = shaded;
    o.flat.visible = !shaded;
    o.creases.visible = !shaded;
    const preview = this.previews.includes(o) ? undefined : this.previewOf.get(o.body.id);
    // A body with a preview is drawn by it; its own pick geometry stays, so picks keep their numbers.
    if (preview?.mesh) {
      o.shaded.visible = o.edges.visible = o.flat.visible = o.creases.visible = false;
    }
    const ghost = !!o.body.ghost || !!preview?.dim;
    const seeThrough = ghost || !!o.body.reference;
    for (const m of [o.shadedMaterial, o.flatMaterial]) {
      m.transparent = seeThrough;
      m.opacity = ghost ? 0.3 : seeThrough ? 0.55 : 1;
      m.depthWrite = !seeThrough;
    }
    o.idMesh.visible = !ghost && !preview?.mesh;
  }

  private clearPreviews(): void {
    for (const o of this.previews) this.removeBody(o);
    this.previews = [];
  }

  private applyPalette(): void {
    const p = this.palette;
    this.renderer.setClearColor(p.viewport, 1);
    const g = this.gridMat.uniforms;
    g.minorColour!.value.copy(p.grid);
    g.majorColour!.value.copy(p["grid-major"]);
    g.xColour!.value.copy(p["axis-x"]);
    g.yColour!.value.copy(p["axis-y"]);
    const r = this.roomMat.uniforms;
    r.minorColour!.value.copy(p.grid);
    r.majorColour!.value.copy(p["grid-major"]);
    // The screen is cleared in sRGB while the grid shader writes its colours as they are, so match the clear.
    this.dofRoomMat.uniforms.bg!.value.copy(p.viewport).convertLinearToSRGB();
    this.hemi.color.set(1, 1, 1);
    this.hemi.groundColor.copy(p.stage);
    this.selectMat.color.copy(p.snap);
    this.hoverMat.color.copy(p.snap);
    this.markerMat.color.copy(p.snap);
    this.originMat.color.copy(p.snap);
    this.outline.uniforms.colour!.value.copy(p["part-line"]);
    this.capMat.uniforms.fill!.value.copy(p["part-fill"]);
    this.capMat.uniforms.line!.value.copy(p["part-line"]);
    this.arrow.setColor(p.snap);
    for (const a of this.jointArrows.children as ArrowHelper[]) a.setColor(p.snap);
    for (const c of this.centres.children as LineSegments[]) (c.material as LineBasicMaterial).color.set(p.snap);
    this.grid.visible = !this.roomOn && this.floorGrid;
    this.room.visible = this.roomOn;
    this.paintPlanes?.();
  }

  /** Paints each face: the fill, the highlight, the selection tint, the hover tint. */
  private recolourAll(): void {
    const p = this.palette;
    const selBodies = new Set(this.selected.filter((s) => s.kind === "body").map((s) => s.body));
    const selFaces = new Map<string, Set<number>>();
    for (const s of this.selected) if (s.kind === "face") (selFaces.get(s.body) ?? selFaces.set(s.body, new Set()).get(s.body)!).add(s.index);
    const c = new Color();
    const c2 = new Color();
    for (const o of [...this.order, ...this.previews]) {
      // A preview's faces are numbered afresh, so picks and checks on the body do not tint it.
      const own = !this.previews.includes(o);
      const base = o.body.highlight ? c2.copy(p["part-highlight"]) : o.body.colour ? c2.setStyle(o.body.colour) : c2.copy(p["part-fill"]);
      if (o.body.reference) base.lerp(p.accent, 0.5);
      if (o.body.warn) base.lerp(p.warn, 0.65);
      const attr = o.geometry.getAttribute("color") as BufferAttribute;
      const arr = attr.array as Float32Array;
      const faces = own ? selFaces.get(o.body.id) : undefined;
      const whole = selBodies.has(o.body.id);
      const hoverFace = own && this.hover?.kind === "face" && this.hover.body === o.body.id ? this.hover.index : -1;
      const check = own ? this.check?.get(o.body.id) : undefined;
      const checked = check && check.length === o.faceOfVertex.length ? check : undefined;
      for (let v = 0; v < o.faceOfVertex.length; v++) {
        const f = o.faceOfVertex[v]!;
        c.copy(base);
        if (whole) c.lerp(p.snap, 0.35);
        if (faces?.has(f)) c.lerp(p.snap, 0.6);
        else if (f === hoverFace) c.lerp(p.snap, 0.25);
        // A print check shows through the selection tint.
        if (checked && checked[v]! > 0) c.lerp(p.warn, 0.4 + 0.6 * checked[v]!);
        arr[v * 3] = c.r;
        arr[v * 3 + 1] = c.g;
        arr[v * 3 + 2] = c.b;
      }
      attr.needsUpdate = true;
      (o.edges.material as LineBasicMaterial).color.copy(p["part-line"]);
      (o.creases.material as LineMaterial).color.copy(p["part-line"]);
    }
    this.updateOverlays();
  }

  /** The fat lines and points for selected and hovered edges, bodies and vertices. */
  private updateOverlays(): void {
    const lines = (picks: Pick[]): number[] => {
      const out: number[] = [];
      const v = new Vector3();
      for (const s of picks) {
        const o = this.bodies.get(s.body);
        if (!o) continue;
        const m = o.body.mesh;
        const from = s.kind === "edge" ? m.edgeSegs[s.index]! : s.kind === "body" ? 0 : -1;
        const to = s.kind === "edge" ? m.edgeSegs[s.index + 1]! : s.kind === "body" ? m.edgeSegs[m.edgeSegs.length - 1]! : -1;
        for (let k = from * 6; k < to * 6; k += 3) {
          v.set(m.edgePositions[k]!, m.edgePositions[k + 1]!, m.edgePositions[k + 2]!).applyMatrix4(o.group.matrix);
          out.push(v.x, v.y, v.z);
        }
      }
      return out;
    };
    const setLines = (l: LineSegments2, pts: number[]) => {
      l.visible = pts.length > 0;
      if (pts.length) {
        l.geometry.dispose();
        l.geometry = new LineSegmentsGeometry().setPositions(pts);
      }
    };
    const sel = this.selected.filter((s) => s.kind === "edge" || (s.kind === "body" && this.style === "shaded"));
    setLines(this.selectLines, lines(sel));
    const hov = this.hover && (this.hover.kind === "edge" || this.hover.kind === "body") ? [this.hover] : [];
    setLines(this.hoverLines, lines(hov));
    const pts: number[] = [];
    const v = new Vector3();
    for (const s of [...this.selected, ...(this.hover ? [this.hover] : [])]) {
      if (s.kind !== "vertex") continue;
      const o = this.bodies.get(s.body);
      const a = o?.body.mesh.vertices;
      if (!o || !a) continue;
      v.set(a[s.index * 3]!, a[s.index * 3 + 1]!, a[s.index * 3 + 2]!).applyMatrix4(o.group.matrix);
      pts.push(v.x, v.y, v.z);
    }
    this.markers.geometry.dispose();
    this.markers.geometry = new BufferGeometry();
    this.markers.geometry.setAttribute("position", new BufferAttribute(new Float32Array(pts), 3));
    this.markers.visible = pts.length > 0;
  }

  private setHover(p: Pick | null): void {
    if (samePick(p, this.hover)) return;
    this.hover = p;
    this.canvas.style.cursor = p ? "pointer" : "";
    this.recolourAll();
    this.invalidate();
  }

  private bounds(ids?: string[]): Sphere | null {
    const list = ids ? this.order.filter((b) => ids.includes(b.body.id)) : this.order;
    if (!list.length) return null;
    let min = new Vector3(Infinity, Infinity, Infinity);
    let max = new Vector3(-Infinity, -Infinity, -Infinity);
    for (const b of list) {
      const box = b.geometry.boundingBox!.clone().applyMatrix4(b.group.matrix);
      min = min.min(box.min);
      max = max.max(box.max);
    }
    const s = new Sphere();
    s.center.copy(min).add(max).multiplyScalar(0.5);
    s.radius = Math.max(min.distanceTo(max) / 2, 1);
    return s;
  }

  // ------------------------------------------------------------ gizmo

  private syncGizmo(): void {
    const o = this.gizmoBody ? this.bodies.get(this.gizmoBody) : undefined;
    const helper = this.gizmo.getHelper();
    this.gizmo.enabled = !!o;
    helper.visible = !!o;
    if (!o) return;
    const r = o.body.rotation ?? { x: 0, y: 0, z: 0 };
    this.proxy.position.set(o.body.position.x, o.body.position.y, o.body.position.z);
    this.proxy.rotation.set(r.x * DEG, r.y * DEG, r.z * DEG, "ZYX");
    this.proxy.updateMatrixWorld();
  }

  private onGizmoMove(done: boolean): void {
    const id = this.gizmoBody;
    const o = id ? this.bodies.get(id) : undefined;
    if (!o || !id) return;
    if (!done && this.gizmo.mode === "translate") this.snapToOrigin();
    const e = new Euler().setFromQuaternion(this.proxy.quaternion, "ZYX");
    const round = (v: number) => Math.round(v * 1000) / 1000;
    const pos: V3 = [round(this.proxy.position.x), round(this.proxy.position.y), round(this.proxy.position.z)];
    const rot: V3 = [round(e.x / DEG), round(e.y / DEG), round(e.z / DEG)];
    const m = new Matrix4().compose(this.proxy.position, this.proxy.quaternion, new Vector3(1, 1, 1));
    // A mesh built in place moves by the change from where it was, not to the new place.
    if (o.body.world) m.multiply(bodyMatrix(o.body).invert());
    for (const g of [o.group, o.pick, o.idMesh]) {
      g.matrix.copy(m);
      g.matrixWorldNeedsUpdate = true;
    }
    this.updateOverlays();
    this.invalidate();
    if (done) this.events.transform?.(id, pos, rot);
    else this.events.transforming?.(id, pos, rot);
  }

  /**
   * The origin is a snap point for the move gizmo: an axis being dragged locks to 0 within 8 px of it, so a part's
   * placement point lands on the origin, or level with it, along that axis.
   */
  private snapToOrigin(): void {
    const axis = this.gizmo.axis ?? "";
    const p = this.proxy.position;
    const tol = 8 * this.pixelSize([p.x, p.y, p.z]);
    for (const k of ["x", "y", "z"] as const) {
      if (axis.includes(k.toUpperCase()) && Math.abs(p[k]) <= tol) p[k] = 0;
    }
    this.proxy.updateMatrixWorld();
  }

  // ------------------------------------------------------------ camera and drawing

  private applyCamera(): void {
    const c = this.cam;
    const { position, up } = cameraBasis(c);
    const aspect = this.width / this.height;
    const radius = this.bounds()?.radius ?? 100;
    const h = halfHeight(c);
    this.persp.aspect = aspect;
    this.persp.near = Math.max(0.05, c.distance / 500);
    this.persp.far = c.distance * 50 + radius * 8;
    this.persp.position.set(...position);
    this.persp.up.set(...up);
    this.persp.lookAt(...c.target);
    this.persp.updateProjectionMatrix();
    // The orthographic camera stands well back so nothing near the target is behind it.
    const back = c.distance + radius * 4 + 1000;
    const { back: dir } = cameraBasis(c);
    Object.assign(this.ortho, { left: -h * aspect, right: h * aspect, top: h, bottom: -h, near: 0.1, far: back * 2 });
    this.ortho.position.set(c.target[0] + dir[0] * back, c.target[1] + dir[1] * back, c.target[2] + dir[2] * back);
    this.ortho.up.set(...up);
    this.ortho.lookAt(...c.target);
    this.ortho.updateProjectionMatrix();
    // The cameras live in the main scene, but the ID, pick and room passes render other scenes first, and three.js only
    // refreshes a camera's world matrix when it renders the camera's own scene. Bring them up to date here, or those
    // passes draw from last frame's view and the line-art outline trails the model while it turns.
    this.persp.updateMatrixWorld();
    this.ortho.updateMatrixWorld();
    this.gizmo.camera = this.activeCamera;

    // The grid: steps adapt to the zoom, and fade before the horizon.
    const step = gridStep(2 * h);
    const fade = Math.max(c.distance * 3, 2 * h * 3, 100);
    for (const u of [this.gridMat.uniforms, this.roomMat.uniforms]) {
      u.step!.value = step;
      u.eye!.value.set(...position);
    }
    this.gridMat.uniforms.fade!.value = fade;
    this.grid.scale.set(fade * 2.4, fade * 2.4, 1);
    this.grid.position.set(Math.round(c.target[0] / (step * 10)) * step * 10, Math.round(c.target[1] / (step * 10)) * step * 10, 0);
    const R = Math.max(2000, Math.ceil((radius * 6) / 1000) * 1000);
    this.room.scale.set(R * 2, R * 2, R);
    this.dofRoom.scale.copy(this.room.scale);
    this.roomMat.uniforms.fade!.value = R * 3;
    this.roomMat.uniforms.step!.value = Math.max(step, 10);
    // Focus on the target; everything within the model's reach of it stays sharp.
    this.dofRoomMat.uniforms.focus!.value = Math.max(c.distance, 1);
    this.dofRoomMat.uniforms.range!.value = Math.max(radius, 20);
    this.invalidate();
  }

  private tick(): void {
    this.frame = 0;
    if (this.disposed) return;
    const now = performance.now();
    if (this.tween) {
      const t = Math.min(1, (now - this.tween.start) / this.tween.ms);
      this.cam = lerpCamera(this.tween.from, this.tween.to, t);
      if (t >= 1) {
        this.cam = this.tween.to;
        this.tween = null;
      }
      this.applyCamera();
    }
    if (!this.dirty && !this.tween) return;
    this.dirty = false;
    this.events.camera?.(this.cam);
    const t0 = performance.now();
    this.draw();
    const ms = performance.now() - t0;
    if (this.statsOn) {
      const since = now - this.lastFrame;
      this.lastFrame = now;
      if (since < 500) this.frameTimes.push(since);
      if (this.frameTimes.length > 30) this.frameTimes.shift();
      const avg = this.frameTimes.length ? this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length : 0;
      const info = this.renderer.info.render;
      this.events.stats?.({ ms, fps: avg ? 1000 / avg : 0, triangles: info.triangles, calls: info.calls, bodies: this.order.length });
    }
    if (this.tween) this.invalidate();
  }

  private draw(): void {
    const r = this.renderer;
    const cam = this.activeCamera;
    if (this.style === "shaded") {
      r.setRenderTarget(null);
      this.renderScene(cam);
      return;
    }
    // Line art, as Layers draws it: an ID pass, the flat fill with its fold lines, then the outline.
    const size = r.getDrawingBufferSize(new Vector2());
    if (!this.idTarget) this.idTarget = new WebGLRenderTarget(size.x, size.y, { minFilter: NearestFilter, magFilter: NearestFilter });
    const clear = r.getClearColor(new Color());
    r.setRenderTarget(this.idTarget);
    r.setClearColor(0x000000, 0);
    r.clear();
    for (const b of this.order) for (const m of [b.idMaterial]) m.clippingPlanes = this.section ? [this.clip] : [];
    r.render(this.idScene, cam);
    r.setRenderTarget(null);
    r.setClearColor(clear, 1);
    this.renderScene(cam);
    this.outline.uniforms.tId!.value = this.idTarget.texture;
    this.outline.uniforms.width!.value = 2 * r.getPixelRatio();
    const auto = r.autoClear;
    r.autoClear = false;
    r.render(this.quadScene, this.quadCamera);
    r.autoClear = auto;
  }

  /** Draws the scene to the screen; in the Holodeck the room goes down first, its far walls out of focus. */
  private renderScene(cam: Camera): void {
    const r = this.renderer;
    if (!this.roomOn) {
      r.render(this.scene, cam);
      return;
    }
    const size = r.getDrawingBufferSize(new Vector2());
    if (!this.dofTargets) {
      const half = (n: number) => Math.max(1, Math.round(n / 2));
      this.dofTargets = {
        sharp: new WebGLRenderTarget(size.x, size.y),
        a: new WebGLRenderTarget(half(size.x), half(size.y)),
        b: new WebGLRenderTarget(half(size.x), half(size.y)),
      };
    }
    const t = this.dofTargets;
    const auto = r.autoClear;
    // The sharp room, with each pixel's blur in alpha. The room surrounds the camera, so it covers every pixel.
    r.setRenderTarget(t.sharp);
    r.render(this.dofScene, cam);
    // Blur it across, then down, at half size.
    const reach = DOF_BLUR * size.y;
    const u = this.blur.uniforms;
    this.dofQuad.material = this.blur;
    for (const [from, to, dir] of [
      [t.sharp, t.a, [1, 0]],
      [t.a, t.b, [0, 1]],
    ] as const) {
      u.tColour!.value = from.texture;
      u.spread!.value.set((dir[0] * reach) / size.x, (dir[1] * reach) / size.y);
      r.setRenderTarget(to);
      r.render(this.dofQuadScene, this.quadCamera);
    }
    // Lay it down, then the rest of the scene over it.
    r.setRenderTarget(null);
    this.dofQuad.material = this.dof;
    this.dof.uniforms.tSharp!.value = t.sharp.texture;
    this.dof.uniforms.tBlur!.value = t.b.texture;
    r.render(this.dofQuadScene, this.quadCamera);
    r.autoClear = false;
    r.clearDepth();
    r.clearStencil();
    this.room.visible = false;
    r.render(this.scene, cam);
    this.room.visible = true;
    r.autoClear = auto;
  }

  private disposeDof(): void {
    if (!this.dofTargets) return;
    for (const t of Object.values(this.dofTargets)) t.dispose();
    this.dofTargets = null;
  }

  // ------------------------------------------------------------ input

  private handlers: [string, EventListener, AddEventListenerOptions?][] = [];

  private on<K extends keyof HTMLElementEventMap>(type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions) {
    this.canvas.addEventListener(type, fn as EventListener, opts);
    this.handlers.push([type, fn as EventListener, opts]);
  }

  private unlisten(): void {
    for (const [t, fn, o] of this.handlers) this.canvas.removeEventListener(t, fn, o);
    window.removeEventListener("keydown", this.onShift);
    window.removeEventListener("keyup", this.onShift);
  }

  private onShift = (e: KeyboardEvent) => {
    if (e.key === "Shift") this.setSnap(e.type === "keydown");
  };

  private local(e: { clientX: number; clientY: number }) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  /** A point on the canvas, back on the page. */
  private client(p: ScreenPoint) {
    const r = this.canvas.getBoundingClientRect();
    return { x: p.x + r.left, y: p.y + r.top };
  }

  /** Calls off the press in progress without a click: a tool that had it tidies up. */
  private cancelPress(): void {
    window.clearTimeout(this.holdTimer);
    if (this.press?.input) this.input?.cancel?.();
    this.press?.body?.cancel();
    this.press = null;
  }

  private listen(): void {
    window.addEventListener("keydown", this.onShift);
    window.addEventListener("keyup", this.onShift);
    this.on("pointerdown", (e) => {
      const p = this.local(e);
      this.pointers.set(e.pointerId, p);
      this.touchPick = e.pointerType === "touch";
      // The gizmo has the pointer when it is over a handle.
      if (this.gizmo.enabled && (this.gizmo.dragging || this.gizmo.axis !== null)) return;
      if (this.arrow.visible && this.onArrow(p)) {
        this.arrowDrag = { startOffset: this.section!.offset, ...p };
        this.canvas.setPointerCapture(e.pointerId);
        return;
      }
      if (this.pointers.size === 2) {
        // A second finger pinches: whatever the first one started is called off.
        const [a, b] = [...this.pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
        this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
        this.cancelPress();
        return;
      }
      if (this.pointers.size > 2) return;
      const touch = e.pointerType === "touch";
      const mods = { shift: e.shiftKey, mod: e.metaKey || e.ctrlKey, alt: e.altKey, touch };
      const taken = e.button === 0 && !!this.input?.down?.(p, mods);
      const press: NonNullable<Engine["press"]> = {
        ...p,
        button: e.button,
        shift: e.shiftKey,
        mod: mods.mod,
        dragged: false,
        input: taken,
        touch,
        id: e.pointerId,
      };
      this.press = press;
      this.canvas.setPointerCapture(e.pointerId);
      // A finger held still stands in for a right click.
      if (touch && !taken && this.events.menu) {
        this.holdTimer = window.setTimeout(() => {
          if (this.press !== press || press.dragged || this.pointers.size !== 1) return;
          press.held = true;
          this.setHover(null);
          this.events.menu?.(this.pick(press.x, press.y), this.client(press));
        }, LONG_PRESS_MS);
      }
    });
    this.on("pointermove", (e) => {
      const p = this.local(e);
      if (e.pointerType !== "touch" && !this.press) this.touchPick = false;
      const prev = this.pointers.get(e.pointerId);
      if (prev) this.pointers.set(e.pointerId, p);
      if (this.arrowDrag && this.section) {
        this.dragArrow(p);
        return;
      }
      if (this.pinch && this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        let c = pan(this.cam, mid.x - this.pinch.mid.x, mid.y - this.pinch.mid.y, this.height);
        c = zoom(c, this.pinch.d / Math.max(d, 1), (mid.x / this.width) * 2 - 1, 1 - (mid.y / this.height) * 2, this.width / this.height);
        this.pinch = { d, mid };
        this.setCamera(c);
        return;
      }
      const press = this.press;
      if (press?.held) return;
      const mods = { shift: e.shiftKey, mod: e.metaKey || e.ctrlKey, alt: e.altKey, touch: e.pointerType === "touch" };
      if (press?.input) {
        this.input?.move?.(p, mods, true);
        return;
      }
      if (this.input && !press) {
        this.input.move?.(p, mods, false);
        return;
      }
      if (press && prev) {
        const dx = p.x - prev.x;
        const dy = p.y - prev.y;
        if (press.body) {
          press.body.move(p, mods);
          return;
        }
        if (!press.dragged && Math.hypot(p.x - press.x, p.y - press.y) < (press.touch ? DRAG_TOUCH : DRAG_MOUSE)) return;
        if (!press.dragged) {
          window.clearTimeout(this.holdTimer);
          // A left drag that starts on a body can move it about its joint (#173) instead of orbiting.
          if (press.button === 0 && !press.shift && !press.mod && this.events.bodyDrag) {
            const hit = this.pick(press.x, press.y, "body");
            const drag = hit ? this.events.bodyDrag(hit, { x: press.x, y: press.y }) : null;
            if (drag) {
              press.dragged = true;
              press.body = drag;
              this.setHover(null);
              drag.move(p, mods);
              return;
            }
          }
        }
        press.dragged = true;
        this.setHover(null);
        if (press.button === 2 || press.button === 1 || (press.button === 0 && press.shift && e.altKey)) this.setCamera(pan(this.cam, dx, dy, this.height));
        else this.setCamera(orbit(this.cam, -dx * 0.4, dy * 0.4));
        return;
      }
      if (!this.hoverEnabled || this.gizmo.dragging || e.pointerType === "touch") return;
      this.hoverAt = p;
      if (!this.hoverFrame) {
        this.hoverFrame = requestAnimationFrame(() => {
          this.hoverFrame = 0;
          if (this.hoverAt && !this.press) this.setHover(this.pick(this.hoverAt.x, this.hoverAt.y));
        });
      }
    });
    const end = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinch = null;
      if (this.arrowDrag) {
        this.arrowDrag = null;
        return;
      }
      const press = this.press;
      // Only the finger or button that started the press ends it (a lifted pinch finger does not).
      if (!press || press.id !== e.pointerId) return;
      this.press = null;
      window.clearTimeout(this.holdTimer);
      const mods = { shift: e.shiftKey, mod: e.metaKey || e.ctrlKey, alt: e.altKey, touch: e.pointerType === "touch" };
      if (press.input) {
        if (e.type === "pointercancel") this.input?.cancel?.();
        else this.input?.up?.(this.local(e), mods);
        return;
      }
      if (press.body) {
        if (e.type === "pointercancel") press.body.cancel();
        else press.body.end();
        return;
      }
      if (press.dragged || press.held || e.type === "pointercancel") return;
      if (press.button === 2 && this.events.menu) {
        this.events.menu(this.pick(press.x, press.y), this.client(press));
        return;
      }
      if (press.button !== 0) return;
      if (this.gizmo.dragging) return;
      const p = this.local(e);
      this.events.click?.(this.pick(p.x, p.y), { shift: press.shift, mod: press.mod }, p);
    };
    this.on("pointerup", end);
    this.on("pointercancel", end);
    this.on("pointerleave", () => {
      this.input?.leave?.();
      this.hoverAt = null;
      if (!this.press) this.setHover(null);
    });
    this.on("contextmenu", (e) => e.preventDefault());
    this.on(
      "wheel",
      (e) => {
        e.preventDefault();
        const p = this.local(e);
        const ndcX = (p.x / this.width) * 2 - 1;
        const ndcY = 1 - (p.y / this.height) * 2;
        const lines = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.height : 1;
        // A pinch on a trackpad arrives as a wheel with Ctrl held.
        if (e.ctrlKey) {
          this.setCamera(zoom(this.cam, Math.exp(e.deltaY * lines * 0.01), ndcX, ndcY, this.width / this.height));
          return;
        }
        // A two-finger swipe on a trackpad scrolls in small, smooth steps (often sideways too): it orbits, Shift pans.
        const trackpad = e.deltaMode === 0 && (e.deltaX !== 0 || !Number.isInteger(e.deltaY)) && Math.abs(e.deltaY) < 50;
        if (trackpad) {
          if (e.shiftKey) this.setCamera(pan(this.cam, -e.deltaX, -e.deltaY, this.height));
          else this.setCamera(orbit(this.cam, e.deltaX * 0.3, -e.deltaY * 0.3));
          return;
        }
        this.setCamera(zoom(this.cam, Math.exp(e.deltaY * lines * 0.0015), ndcX, ndcY, this.width / this.height));
      },
      { passive: false },
    );
  }

  /** Keyboard navigation for the focused view: arrows orbit, Shift+arrows pan, + and − zoom. */
  key(e: KeyboardEvent): boolean {
    const step = 15;
    const k = e.key;
    let c: CameraState | null = null;
    if (e.shiftKey && k.startsWith("Arrow")) {
      const d = 40;
      c = pan(this.cam, k === "ArrowLeft" ? d : k === "ArrowRight" ? -d : 0, k === "ArrowUp" ? d : k === "ArrowDown" ? -d : 0, this.height);
    } else if (k === "ArrowLeft") c = orbit(this.cam, -step, 0);
    else if (k === "ArrowRight") c = orbit(this.cam, step, 0);
    else if (k === "ArrowUp") c = orbit(this.cam, 0, step);
    else if (k === "ArrowDown") c = orbit(this.cam, 0, -step);
    else if (k === "+" || k === "=") c = zoom(this.cam, 0.8);
    else if (k === "-" || k === "_") c = zoom(this.cam, 1.25);
    if (!c) return false;
    this.setCamera(c, true);
    return true;
  }

  private onArrow(p: { x: number; y: number }): boolean {
    const ray = new Raycaster();
    ray.params.Line = { threshold: 3 };
    ray.setFromCamera(new Vector2((p.x / this.width) * 2 - 1, -(p.y / this.height) * 2 + 1), this.activeCamera);
    return ray.intersectObject(this.arrow, true).length > 0;
  }

  private dragArrow(p: { x: number; y: number }): void {
    const s = this.section!;
    const d = this.arrowDrag!;
    // How far one mm along the normal moves on screen, so the arrow tip follows the pointer.
    const cam = this.activeCamera;
    const o = new Vector3(...s.origin).addScaledVector(new Vector3(...s.normal), s.offset);
    const a = o.clone().project(cam);
    const b = o
      .clone()
      .add(new Vector3(...s.normal))
      .project(cam);
    const sx = ((b.x - a.x) * this.width) / 2;
    const sy = (-(b.y - a.y) * this.height) / 2;
    const l2 = sx * sx + sy * sy;
    if (l2 < 1e-6) return;
    const mm = ((p.x - d.x) * sx + (p.y - d.y) * sy) / l2;
    const offset = Math.round((d.startOffset + mm) * 10) / 10;
    this.events.section?.(offset);
  }

  /** A world point's place on the canvas, CSS px from its top left (for tests and overlays). */
  /** The ray from the camera through a point on the canvas (CSS px). */
  ray(x: number, y: number): { origin: V3; dir: V3 } {
    const r = new Raycaster();
    r.setFromCamera(new Vector2((x / this.width) * 2 - 1, -(y / this.height) * 2 + 1), this.activeCamera);
    const o = r.ray.origin;
    const d = r.ray.direction;
    return { origin: [o.x, o.y, o.z], dir: [d.x, d.y, d.z] };
  }

  /** Which way is towards the viewer, as a unit vector. */
  towards(): V3 {
    const d = this.activeCamera.getWorldDirection(new Vector3()).negate();
    return [d.x, d.y, d.z];
  }

  project(p: V3): { x: number; y: number } {
    const v = new Vector3(...p).project(this.activeCamera);
    return { x: ((v.x + 1) / 2) * this.width, y: ((1 - v.y) / 2) * this.height };
  }

  /** Where the camera is as a preset name, if it is at one. */
  presetName(): Preset | null {
    return presetOf(this.cam);
  }

  /** For tests and the frame overlay: the camera object currently drawing. */
  get three(): Camera {
    return this.activeCamera;
  }
}

/** Whether this browser can draw WebGL 2 at all. */
export function canDraw3D(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!c.getContext("webgl2");
  } catch {
    return false;
  }
}

/** Builds the per-vertex quaternion helper three needs; kept for the gizmo's rotation readout. */
export const unitQuaternion = () => new Quaternion();
export { QUAD_VERT };
