import type { IconName } from "@bettercad/ui";

export type ToolId =
  "select" | "move" | "turn" | "section" | "sketch" | "extrude" | "revolve" | "pushpull" | "combine" | "fillet" | "shell" | "hole" | "mount" | "measure";

export interface Tool {
  id: ToolId;
  label: string;
  icon: IconName;
  /** A single-letter shortcut; the rarer tools have none and live in the palette. */
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
  { id: "pushpull", label: "Push/pull", icon: "pushpull", key: "p", title: "Push or pull a face", help: "Click a flat face and drag it in or out." },
  {
    id: "combine",
    label: "Combine",
    icon: "combine",
    key: "c",
    title: "Join, cut or intersect bodies",
    help: "Click the body to keep, then Shift-click the bodies to join, cut or intersect.",
  },
  { id: "fillet", label: "Fillet", icon: "fillet", key: "g", title: "Round or bevel edges", help: "Click the edges to round." },
  { id: "shell", label: "Shell", icon: "shell", key: "s", title: "Hollow a body to a wall", help: "Click the face to leave open, usually the top." },
  {
    id: "measure",
    label: "Measure",
    icon: "ruler",
    key: "i",
    title: "Measure distances, lengths and angles",
    help: "Pick something to measure, then something else for the distance.",
  },
  { id: "hole", label: "Hole", icon: "hole", key: "h", title: "Make a screw hole", help: "Click a flat face where the hole goes." },
  { id: "mount", label: "Mount", icon: "screw", title: "Standoffs or a servo horn mount", help: "Click a flat face where the mount goes." },
];

export const VIEW_TOOLS = TOOLS.filter((t) => t.id === "select" || t.id === "move" || t.id === "turn" || t.id === "section");
export const MODEL_TOOLS = TOOLS.filter((t) => !VIEW_TOOLS.includes(t));

export type ViewId = "iso" | "front" | "side" | "top";
export const VIEWS: { id: ViewId; label: string; key: string }[] = [
  { id: "iso", label: "Iso", key: "1" },
  { id: "front", label: "Front", key: "2" },
  { id: "side", label: "Side", key: "3" },
  { id: "top", label: "Top", key: "4" },
];
