import type { IconName } from "@bettercad/ui";

export type ToolId =
  | "select"
  | "move"
  | "turn"
  | "section"
  | "sketch"
  | "construct"
  | "extrude"
  | "revolve"
  | "loft"
  | "sweep"
  | "pushpull"
  | "combine"
  | "split"
  | "fillet"
  | "shell"
  | "offsetFace"
  | "hole"
  | "mount"
  | "gear"
  | "decal"
  | "canvas"
  | "joint"
  | "pattern"
  | "measure";

export interface Tool {
  id: ToolId;
  label: string;
  icon: IconName;
  /** A shortcut, a letter or a combo ("shift+p"); the rarer tools have none and live in the palette. */
  key?: string;
  title: string;
  /** The help line under the viewport while the tool is armed. */
  help: string;
  /** Which epic brings it to life. */
  epic?: number;
}

export const TOOLS: Tool[] = [
  {
    id: "select",
    label: "Select",
    icon: "arrow",
    key: "v",
    title: "Pick parts and faces",
    help: "Click a part to select it. Drag to look around, right-drag to pan, scroll to zoom.",
  },
  {
    id: "move",
    label: "Move",
    icon: "move",
    key: "m",
    title: "Move the selected part",
    help: "Click a part, then drag an arrow to move it. Shift snaps to 5 mm steps.",
  },
  {
    id: "turn",
    label: "Turn",
    icon: "rotate",
    key: "r",
    title: "Turn the selected part",
    help: "Click a part, then drag a ring to turn it. Shift snaps to 15° steps.",
  },
  {
    id: "section",
    label: "Section",
    icon: "section",
    key: "x",
    title: "Cut the view open",
    help: "Click a face to cut through it, then drag the arrow or type how far.",
  },
  {
    id: "sketch",
    label: "Sketch",
    icon: "sketch",
    key: "k",
    title: "Start a sketch on a face or plane",
    help: "Click a face or a plane to sketch on it.",
  },
  {
    id: "construct",
    label: "Construct",
    icon: "plane",
    title: "Construction planes, axes and points",
    help: "Pick what to make from the Construct menu.",
  },
  {
    id: "extrude",
    label: "Extrude",
    icon: "extrude",
    key: "e",
    title: "Extrude a sketch into a solid",
    help: "Click inside a closed sketch shape to extrude it.",
  },
  {
    id: "revolve",
    label: "Revolve",
    icon: "revolve",
    title: "Turn a sketch round an axis into a solid",
    help: "Click inside a closed sketch shape to revolve it.",
  },
  {
    id: "loft",
    label: "Loft",
    icon: "loft",
    title: "Run a solid through sketch shapes on different planes",
    help: "Click a closed sketch shape, then shapes on other planes in order.",
  },
  {
    id: "sweep",
    label: "Sweep",
    icon: "sweep",
    title: "Push a sketch shape along a path",
    help: "Click a closed sketch shape, then the lines and arcs of a path in another sketch.",
  },
  { id: "pushpull", label: "Push/pull", icon: "pushpull", key: "p", title: "Push or pull a face", help: "Click a flat face and drag it in or out." },
  {
    id: "combine",
    label: "Combine",
    icon: "combine",
    key: "c",
    title: "Join, cut or intersect bodies",
    help: "Click the body to keep, then Shift-click the bodies to join, cut or intersect.",
  },
  {
    id: "split",
    label: "Split body",
    icon: "split",
    title: "Split a body in two along a plane or face",
    help: "Click the body to split.",
  },
  { id: "fillet", label: "Fillet", icon: "fillet", key: "g", title: "Fillet or chamfer edges", help: "Click the edges to fillet or chamfer." },
  { id: "shell", label: "Shell", icon: "shell", key: "s", title: "Hollow a body to a wall", help: "Click the face to leave open, usually the top." },
  {
    id: "offsetFace",
    label: "Offset face",
    icon: "offsetFace",
    key: "shift+p",
    title: "Move faces along their normals",
    help: "Click the faces to move: flat ones, or the wall of a hole.",
  },
  {
    id: "measure",
    label: "Measure",
    icon: "ruler",
    key: "i",
    title: "Measure distances, lengths and angles",
    help: "Pick something to measure, then something else for the distance.",
  },
  { id: "hole", label: "Hole", icon: "hole", key: "h", title: "Make a screw hole", help: "Click a flat face where the hole goes." },
  {
    id: "pattern",
    label: "Pattern",
    icon: "distributeH",
    title: "Copy bodies in rows or round an axis",
    help: "Click the bodies to copy. Shift-click picks more than one.",
  },
  { id: "mount", label: "Mount", icon: "screw", title: "Standoffs or a servo horn mount", help: "Click a flat face where the mount goes." },
  {
    id: "joint",
    label: "Joint",
    icon: "joint",
    title: "Hinge, wheel, slider or fixed joint between two components",
    help: "Click a face or a round edge on the part that moves, where it joins.",
  },
  { id: "decal", label: "Decal", icon: "image", title: "Put a picture on a face", help: "Click a flat face, then choose a picture to put on it." },
  {
    id: "canvas",
    label: "Canvas",
    icon: "canvas",
    title: "Put a picture on a plane to trace over",
    help: "Click a plane or a flat face, then choose a picture to trace over.",
  },
  { id: "gear", label: "Gear", icon: "gear", title: "Spur gears, racks and GT2 pulleys", help: "Click the ground or a flat face where the gear goes." },
];

const byId = (ids: ToolId[]) => ids.map((id) => TOOLS.find((t) => t.id === id)!);

/**
 * The tools on the top bar, in groups and ranked by how often you reach for them: arrange what is there, make
 * something new, change it, then check it. The Library sits at the head of "make", and Mirror just before Pattern (see TopBar).
 */
export const TOOL_GROUPS: { id: string; label: string; tools: Tool[] }[] = [
  { id: "arrange", label: "Arrange", tools: byId(["select", "move", "turn"]) },
  { id: "make", label: "Make", tools: byId(["sketch", "extrude", "pushpull", "revolve", "loft", "sweep", "gear", "construct", "canvas"]) },
  { id: "change", label: "Change", tools: byId(["combine", "split", "hole", "fillet", "shell", "offsetFace", "pattern", "mount", "decal", "joint"]) },
  { id: "check", label: "Check", tools: byId(["measure", "section"]) },
];

export type ViewId = "iso" | "front" | "side" | "top";
