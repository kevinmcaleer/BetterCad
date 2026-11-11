// Line icons on a 24-unit grid, 2px stroke, drawn in currentColor.
// Layers' icons.ts plus BetterCad's additions, from the design system bundle, plus a few shell icons.
//
// Each path is a named export, so `import { extrude } from "@bettercad/ui/icons"` with <Icon path={extrude} />
// ships only the icons a page uses. ICONS (and <Icon name="…" />) pulls in the whole set, about 10 kB.

export const undo = "M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11";
export const redo = "m15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13";
export const expand = "M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7";
export const shrink = "M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7";
export const close = "M18 6 6 18M6 6l12 12";
export const check = "M20 6 9 17l-5-5";
export const text = "M4 7V4h16v3M9 20h6M12 4v16";
export const shapes = "M8.3 10a.7.7 0 0 1-.6-1L11.4 3a.7.7 0 0 1 1.2 0L16.3 9a.7.7 0 0 1-.6 1zM3 14h7v7H3zM17.5 21a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z";
export const image =
  "M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM9 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM21 15l-3.1-3.1a2 2 0 0 0-2.8 0L6 21";
export const upload = "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12";
export const layers = "m12 2 10 5-10 5L2 7zM2 17l10 5 10-5M2 12l10 5 10-5";
export const paint = "M19 11V4a1 1 0 0 0-1-1H6a1 1 0 0 0-1 1v7zM5 11v2a2 2 0 0 0 2 2h3v4a2 2 0 0 0 4 0v-4h3a2 2 0 0 0 2-2v-2";
export const template = "M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z";
export const trash = "M3 6h18M8 6V4h8v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6";
export const copy = "M9 9h11v11H9zM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1";
export const lock = "M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4";
export const unlock = "M5 11h14v10H5zM8 11V7a4 4 0 0 1 7.9-1";
export const eye = "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z";
export const eyeOff =
  "M9.9 4.2A10 10 0 0 1 12 4c6.5 0 10 8 10 8a17 17 0 0 1-2.2 3.2M6.6 6.6C3.9 8.4 2 12 2 12s3.5 8 10 8a9.8 9.8 0 0 0 5.4-1.6M2 2l20 20M9.9 9.9a3 3 0 0 0 4.2 4.2";
export const bold = "M6 4h8a4 4 0 0 1 0 8H6zM6 12h9a4 4 0 0 1 0 8H6z";
export const italic = "M19 4h-9M14 20H5M15 4 9 20";
export const underline = "M6 4v6a6 6 0 0 0 12 0V4M4 20h16";
export const alignLeft = "M3 6h18M3 12h12M3 18h16";
export const alignCenter = "M3 6h18M6 12h12M4 18h16";
export const alignRight = "M3 6h18M9 12h12M5 18h16";
export const forward = "M12 3v12M7 8l5-5 5 5M5 21h14";
export const backward = "M12 21V9M7 16l5 5 5-5M5 3h14";
export const position = "M5 9 2 12l3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20";
export const plus = "M12 5v14M5 12h14";
export const minus = "M5 12h14";
export const flipH = "M12 3v18M8 7 3 12l5 5zM16 7l5 5-5 5z";
export const flipV = "M3 12h18M7 8l5-5 5 5zM7 16l5 5 5-5z";
export const section = "M4 4h16v16H4zM12 4v16M12 9l5-5M12 15l8-8M12 20l8-8";
export const group = "M3 3h8v8H3zM13 13h8v8h-8zM11 7h4a2 2 0 0 1 2 2v4";
export const ungroup = "M3 3h8v8H3zM13 13h8v8h-8z";
export const resize = "M21 9V3h-6M3 15v6h6M21 3l-7 7M3 21l7-7";
export const opacity = "M12 2.7c3 3.4 6 6.5 6 10.3a6 6 0 0 1-12 0c0-3.8 3-6.9 6-10.3zM6 13h12";
export const grip = "M9 5h.01M9 12h.01M9 19h.01M15 5h.01M15 12h.01M15 19h.01";
export const background = "M3 3h18v18H3zM3 15l6-6 5 5 3-3 4 4";
export const more = "M5 12h.01M12 12h.01M19 12h.01";
export const dash = "M3 12h3M10.5 12h3M18 12h3";
export const arrowEnd = "M3 12h17M14 6l6 6-6 6";
export const arrowStart = "M21 12H4M10 6l-6 6 6 6";
export const arrowSolid = "M3 12h10M13 6l8 6-8 6z";
export const textInShape = "M3 5h18v14H3zM8 9h8M12 9v6";
export const border = "M4 4h16v16H4z";
export const ticked = "M4 4h16v16H4zM8 12l3 3 5-6";
export const rounded = "M4 20V10a6 6 0 0 1 6-6h10";
export const crop = "M6 2v14a2 2 0 0 0 2 2h14M18 22V8a2 2 0 0 0-2-2H2";
export const highlight = "m9 11-6 6v3h9l3-3M22 12l-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4";
export const alignObjLeft = "M4 2v20M8 6h12v4H8zM8 14h7v4H8z";
export const alignObjCenter = "M12 2v20M6 6h12v4H6zM8.5 14h7v4h-7z";
export const alignObjRight = "M20 2v20M4 6h12v4H4zM9 14h7v4H9z";
export const alignObjTop = "M2 4h20M6 8h4v12H6zM14 8h4v7h-4z";
export const alignObjMiddle = "M2 12h20M6 6h4v12H6zM14 8.5h4v7h-4z";
export const alignObjBottom = "M2 20h20M6 4h4v12H6zM14 9h4v7h-4z";
export const distributeH = "M3 3v18M21 3v18M9.5 7h5v10h-5z";
export const distributeV = "M3 3h18M3 21h18M7 9.5h10v5H7z";
export const spinner = "M21 12a9 9 0 1 1-6.2-8.6";
export const cube = "m12 2 8 4.5v9L12 20l-8-4.5v-9zM12 11l8-4.5M12 11 4 6.5M12 11v9";
export const move = "M5 9 2 12l3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20";
export const rotate = "M21 12a9 9 0 1 1-3-6.7M21 3v6h-6";
export const frame = "M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5";
export const link = "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1";
/** A hinge (#172): two arms meeting at a pin. */
export const joint = "M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6M9.9 14.1L4 20M14.1 9.9L20 4M4 20h4M20 4v4";
export const unlink = "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1M4 4l16 16";
export const pencil = "M4 20h4l10-10-4-4L4 16zM13 7l4 4";
export const download = "M12 3v12M7 10l5 5 5-5M4 21h16";
export const star = "m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z";
export const list = "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01";
export const arrow = "M4 12h16M14 6l6 6-6 6";
export const screw = "M12 2v4M9 6h6M10 6v12l2 4 2-4V6M10 10h4M10 14h4";
export const home = "M3 11.5 12 4l9 7.5M5.5 9.5V20h5v-5.5h3V20h5V9.5";
export const chevronDown = "m6 9 6 6 6-6";
export const camera = "M4 8h3l2-3h6l2 3h3v11H4zM12 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6z";
export const track = "M7 8h10a4 4 0 0 1 0 8H7a4 4 0 0 1 0-8zM7 12h.01M17 12h.01M10 8v-2M14 8v-2M10 16v2M14 16v2";
export const sketch = "M4 20 14 10M14 10l2-6 4 4-6 2zM4 20h4";
export const extrude = "M4 15l8 4 8-4M4 9l8 4 8-4-8-4z M4 9v6M20 9v6M12 13v6";
export const pushpull = "M3 12h8M8 8l-5 4 5 4M13 4h8v16h-8z";
export const combine = "M9 15a6 6 0 1 1 6-6M15 9a6 6 0 1 1-6 6M9 9h6v6H9z";
export const fillet = "M4 20V10a6 6 0 0 1 6-6h10M4 4h4M4 4v4";
export const dimension = "M4 6v12M20 6v12M4 12h16M8 9l-4 3 4 3M16 9l4 3-4 3";
export const constraint = "M7 7h4v10H7zM13 7h4v10h-4zM4 12h3M17 12h3";
export const save = "M4 4h12l4 4v12H4zM8 4v5h7M8 20v-6h8v6";
export const folder = "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z";
export const user = "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0";
export const ghost = "M12 3a7 7 0 0 0-7 7v10l2.5-2 2.5 2 2-2 2 2 2.5-2 2.5 2V10a7 7 0 0 0-7-7zM10 11h.01M14 11h.01";
export const warning = "M12 3 2 20h20zM12 10v4M12 17h.01";
export const hole = "M12 12m-8 0a8 8 0 1 0 16 0a8 8 0 1 0-16 0M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0";
export const cylinder = "M4 6a8 3 0 1 0 16 0a8 3 0 1 0-16 0M4 6v12a8 3 0 0 0 16 0V6";
export const sphere = "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M3 12a9 3.5 0 0 0 18 0";
export const cone = "M12 3 4 18M12 3l8 15M4 18a8 3 0 0 0 16 0a8 3 0 0 0-16 0";
export const torus = "M2 12a10 5 0 1 0 20 0a10 5 0 1 0-20 0M8 11.5a4 1.6 0 0 0 8 0M9.2 12.6a3.2 1.2 0 0 1 5.6 0";
export const sliders = "M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1M15 4v4M9 10v4M17 16v4";
export const ruler = "M3 16 16 3l5 5L8 21zM7 12l2 2M10 9l2 2M13 6l2 2";
export const revolve = "M12 2v20M5 10a7 3 0 1 0 7-3M9 4.5 12 7l-2.8 2.4";
/** Loft (#399): a wide shape at the bottom running into a small one at the top. */
export const sweep = "M4 20v-8a8 8 0 0 1 8-8h8M2 20h4M20 2v4M8 20v-8a4 4 0 0 1 4-4h8";
/** Split body: a block in two pieces along a slanted cut. */
export const split = "M3 4h9L7 20H3zM16 4h5v16h-10z";
export const loft = "M3 18h18l-2 3H5zM9 3h6v3H9zM3 18 9 6M21 18 15 6";
export const chamfer = "M4 20V10l6-6h10v16zM4 10h6V4";
export const shell = "M3 7l9-4 9 4v10l-9 4-9-4zM6.5 8.5 12 6l5.5 2.5L12 11zM12 11v10";
export const wedge = "M3 20h12L3 8zM8 4v12h12M3 8l5-4M15 20l5-4M3 20l5-4";
export const settings = "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1";
export const gear =
  "M19.4 10.2 21.9 10.3 21.9 13.7 19.4 13.8 18.5 15.9 20.2 17.8 17.8 20.2 15.9 18.5 13.8 19.4 13.7 21.9 10.3 21.9 10.2 19.4 8.1 18.5 6.2 20.2 3.8 17.8 5.5 15.9 4.6 13.8 2.1 13.7 2.1 10.3 4.6 10.2 5.5 8.1 3.8 6.2 6.2 3.8 8.1 5.5 10.2 4.6 10.3 2.1 13.7 2.1 13.8 4.6 15.9 5.5 17.8 3.8 20.2 6.2 18.5 8.1zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z";
export const history = "M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 3";
export const search = "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-4.3-4.3";
export const keyboard = "M3 6h18v12H3zM7 10h.01M11 10h.01M15 10h.01M7 14h10";
export const sun = "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4";
export const moon = "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z";
export const grid = "M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18";
export const body = "M4 8l8-5 8 5v8l-8 5-8-5zM4 8l8 5 8-5M12 13v8";
export const info = "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01";
export const help = "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.2a2.6 2.6 0 0 1 5 .9c0 1.7-2.5 2.4-2.5 2.4M12 16.5h.01";
export const chevron = "m9 6 6 6-6 6";
// Timeline play controls.
export const skipStart = "M18 19 9 12l9-7zM6 5v14";
export const stepBack = "M16 18 8 12l8-6z";
export const stepForward = "m8 6 8 6-8 6z";
export const skipEnd = "m6 5 9 7-9 7zM18 5v14";

// Sketch tools (epic #5).
export const line = "M6 18 18 6M4 16h4v4H4zM16 4h4v4h-4z";
export const rect = "M4 6h16v12H4z";
export const circle = "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z";
export const arc = "M4 18a8 8 0 0 1 16 0";
export const polygon = "M7.5 4h9l4.5 8-4.5 8h-9L3 12z";
/** A slot (#403): two round ends joined by straight sides. */
export const slot = "M8 8h8a4 4 0 0 1 0 8H8a4 4 0 0 1 0-8z";
/** An ellipse (#401): wider than it is tall. */
export const ellipse = "M12 18c5 0 9-2.7 9-6s-4-6-9-6-9 2.7-9 6 4 6 9 6z";
/** A spline (#269): a smooth wave through two fit points. */
export const spline = "M3 18c3 0 4-12 9-12s6 12 9 12M10 6a2 2 0 1 0 4 0 2 2 0 1 0-4 0";
/** A construction plane (#265): a sheet seen at an angle. */
export const plane = "M7 4h14l-4 16H3z";
/** A construction axis (#265): a line running through, with a tick at each end. */
export const axis = "M4 20 20 4M2 18l4 4M18 2l4 4";
export const point = "M12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM12 3v4M12 17v4M3 12h4M17 12h4";
export const finish = "M20 6 9 17l-5-5";
export const cloud = "M17.5 19H8a6 6 0 1 1 5.7-7.9h.3a4.5 4.5 0 0 1 3.5 7.9z";
export const cloudOff = "M2 2l20 20M5.8 8.2A6 6 0 0 0 8 19h9M21 15.5a4.5 4.5 0 0 0-7-4.4M10 5.2A6 6 0 0 1 13.7 11";
// Print readiness (#11).
export const printer = "M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v7H6z";
export const share = "M18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8.6 13.5l6.8 4M15.4 6.5l-6.8 4";

// Components (#171): two parts joined into one; the active component's radio, on and off.
export const component = "M3 3h8v8H3zM13 13h8v8h-8zM7 11v6h6M17 13V7h-6";
export const radioOff = "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z";
export const radioOn = "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4z";
// Tips: a light bulb.
export const bulb = "M9 18h6M10 22h4M15 14c.2-1 .7-1.7 1.5-2.5A5.5 5.5 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.8.8 1.3 1.5 1.5 2.5";

export const ICONS = {
  component,
  bulb,
  radioOff,
  radioOn,
  undo,
  redo,
  expand,
  shrink,
  close,
  check,
  text,
  shapes,
  image,
  upload,
  layers,
  paint,
  template,
  trash,
  copy,
  lock,
  unlock,
  eye,
  eyeOff,
  bold,
  italic,
  underline,
  alignLeft,
  alignCenter,
  alignRight,
  forward,
  backward,
  position,
  plus,
  minus,
  flipH,
  flipV,
  section,
  group,
  ungroup,
  resize,
  opacity,
  grip,
  background,
  more,
  dash,
  arrowEnd,
  arrowStart,
  arrowSolid,
  textInShape,
  border,
  ticked,
  rounded,
  crop,
  highlight,
  alignObjLeft,
  alignObjCenter,
  alignObjRight,
  alignObjTop,
  alignObjMiddle,
  alignObjBottom,
  distributeH,
  distributeV,
  spinner,
  cube,
  move,
  rotate,
  frame,
  link,
  joint,
  unlink,
  pencil,
  download,
  star,
  list,
  arrow,
  screw,
  home,
  chevronDown,
  camera,
  track,
  sketch,
  extrude,
  pushpull,
  combine,
  fillet,
  dimension,
  constraint,
  save,
  folder,
  user,
  ghost,
  warning,
  hole,
  cylinder,
  sphere,
  cone,
  torus,
  wedge,
  chamfer,
  shell,
  revolve,
  loft,
  sweep,
  split,
  ruler,
  sliders,
  settings,
  gear,
  history,
  search,
  keyboard,
  sun,
  moon,
  grid,
  body,
  info,
  help,
  chevron,
  skipStart,
  stepBack,
  stepForward,
  skipEnd,
  line,
  rect,
  circle,
  arc,
  polygon,
  slot,
  ellipse,
  spline,
  point,
  plane,
  axis,
  finish,
  cloud,
  cloudOff,
  share,
  printer,
} as const;

export type IconName = keyof typeof ICONS;
