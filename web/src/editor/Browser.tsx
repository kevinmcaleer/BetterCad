import { useEffect, useRef, useState } from "react";
import { Banner, ContextMenu, PartsTree, WideButton, type ContextMenuState, type MenuEntry, type RowToggle, type TreeItem } from "@bettercad/ui";
import type { Part, PartKind } from "../state/document";
import type { WorldPlaneName } from "../viewport/engine";
import { formatCombo } from "../state/commands";
import { partIcon } from "./Timeline";

/**
 * The browser (Fusion's): the model at the top, then its origin planes, bodies, sketches and joints in folders. Eyes
 * show and hide, clicks select. Bodies keep the parts tree's ghost and highlight, drag and rename.
 */

export const PLANES: WorldPlaneName[] = ["XY", "XZ", "YZ"];
/** What the Origin folder holds: the origin point, then the three planes. */
export type OriginItem = WorldPlaneName | "point";
export const ORIGIN: OriginItem[] = ["point", ...PLANES];

/** Row ids for the browser's own rows, kept apart from part and feature ids. */
export const ROW = {
  root: "browser:model",
  origin: "browser:origin",
  bodies: "browser:bodies",
  sketches: "browser:sketches",
  joints: "browser:joints",
  plane: (p: WorldPlaneName) => `browser:plane:${p}`,
  point: "browser:origin-point",
} as const;

const PLANE_ROWS = new Map(PLANES.map((p) => [ROW.plane(p), p]));
/** The origin plane a row id names, if it is one. */
export function planeOf(id: string): WorldPlaneName | null {
  return PLANE_ROWS.get(id) ?? null;
}
/** The origin item a row id names: the origin point or a plane. */
export function originItemOf(id: string): OriginItem | null {
  return id === ROW.point ? "point" : planeOf(id);
}

export interface BrowserSketch {
  id: string;
  name: string;
  hidden: boolean;
  /** Why it failed to build, if it did. */
  warning?: string;
}

export interface BrowserModel {
  name: string;
  parts: Part[];
  sketches: BrowserSketch[];
  /** The origin point and planes on show. */
  origin: OriginItem[];
}

const count = (n: number) => (n ? `${n}` : "");

/** The browser's rows, in display order, children after their parent. */
export function browserItems(m: BrowserModel): TreeItem[] {
  const folder = (id: string, name: string, extra: Partial<TreeItem>): TreeItem => ({
    id,
    name,
    icon: "folder",
    kind: "folder",
    parentId: ROW.root,
    drag: false,
    rename: false,
    toggles: ["hidden"],
    ...extra,
  });
  const items: TreeItem[] = [{ id: ROW.root, name: m.name, icon: "layers", kind: "component", drag: false, rename: false, toggles: [] }];
  items.push(folder(ROW.origin, "Origin", { folded: true, hidden: m.origin.length === 0 }));
  items.push({
    id: ROW.point,
    name: "Origin point",
    icon: "position",
    kind: "point",
    parentId: ROW.origin,
    drag: false,
    rename: false,
    toggles: ["hidden"],
    hidden: !m.origin.includes("point"),
  });
  for (const p of PLANES) {
    items.push({
      id: ROW.plane(p),
      name: `${p} plane`,
      icon: "grid",
      kind: "plane",
      parentId: ROW.origin,
      drag: false,
      rename: false,
      toggles: ["hidden"],
      hidden: !m.origin.includes(p),
    });
  }
  // Bodies and Sketches show once they have something in them, as Fusion's do.
  if (m.parts.length) items.push(folder(ROW.bodies, "Bodies", { note: count(m.parts.length), hidden: m.parts.length > 0 && m.parts.every((p) => p.hidden) }));
  for (const part of m.parts) {
    items.push({
      id: part.id,
      name: part.name,
      icon: partIcon(part.kind as PartKind),
      kind: "body",
      parentId: ROW.bodies,
      hidden: part.hidden,
      ghost: part.ghost,
      highlight: part.highlight,
    });
  }
  if (m.sketches.length)
    items.push(folder(ROW.sketches, "Sketches", { note: count(m.sketches.length), hidden: m.sketches.length > 0 && m.sketches.every((s) => s.hidden) }));
  for (const s of m.sketches) {
    items.push({
      id: s.id,
      name: s.name,
      icon: "sketch",
      kind: "sketch",
      parentId: ROW.sketches,
      drag: false,
      toggles: ["hidden"],
      hidden: s.hidden,
      warning: s.warning,
    });
  }
  // Joints (#172) fill this in. Until then it stays, empty, so the tree has the shape it will keep.
  items.push(folder(ROW.joints, "Joints", { note: "None yet", toggles: [] }));
  return items;
}

/**
 * What a click in the browser selects. Bodies are the editor's selection: the Bodies folder or the model picks every
 * body. A sketch or a plane is the browser's own pick; the last one clicked wins.
 */
export function browserPick(ids: string[], m: BrowserModel): { parts: string[]; other: string | null } {
  const partIds = new Set(m.parts.map((p) => p.id));
  const whole = ids.includes(ROW.root) || ids.includes(ROW.bodies);
  const parts = whole ? m.parts.map((p) => p.id) : ids.filter((id) => partIds.has(id));
  const sketchIds = new Set(m.sketches.map((s) => s.id));
  const other = [...ids].reverse().find((id) => sketchIds.has(id) || originItemOf(id) !== null) ?? null;
  return { parts, other };
}

export interface BrowserPanelProps {
  model: BrowserModel;
  selection: string[];
  onSelect: (ids: string[]) => void;
  onAdd: (kind: PartKind) => void;
  /** A body's eye, ghost or highlight. */
  onToggle: (id: string, what: RowToggle) => void;
  /** Hide (true) or show bodies, all at once. */
  onBodiesHidden: (ids: string[], hidden: boolean) => void;
  /** Hide (true) or show sketches. */
  onSketchesHidden: (ids: string[], hidden: boolean) => void;
  onOrigin: (shown: OriginItem[]) => void;
  /** The sketch, plane or origin point picked in the browser, for the view to mark. */
  onPicked: (id: string | null) => void;
  onSelectSketch: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onRenameSketch: (id: string, name: string) => void;
  onReorder: (id: string, beforeId: string | null) => void;
  onSketchOn: (plane: WorldPlaneName) => void;
  partMenu: (ids: string[]) => MenuEntry[];
  sketchMenu: (id: string) => MenuEntry[];
  renameId: string | null;
  onRenameIdChange: (id: string | null) => void;
}

export function BrowserPanel(p: BrowserPanelProps) {
  const { model } = p;
  const items = browserItems(model);
  const [other, setOther] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ id: string; at: ContextMenuState } | null>(null);
  // A pick in the view (or anywhere else) clears the browser's own sketch or plane pick; one made here keeps it.
  const ours = useRef(false);
  useEffect(() => {
    if (!ours.current) setOther(null);
    ours.current = false;
  }, [p.selection]);
  const { onPicked } = p;
  useEffect(() => onPicked(other), [other, onPicked]);
  useEffect(() => () => onPicked(null), [onPicked]);

  const select = (ids: string[]) => {
    const r = browserPick(ids, model);
    setOther(r.other);
    ours.current = true;
    if (r.other && model.sketches.some((s) => s.id === r.other) && ids[ids.length - 1] === r.other) p.onSelectSketch(r.other);
    else p.onSelect(r.parts);
  };

  const toggle = (id: string, what: RowToggle) => {
    const item = originItemOf(id);
    if (item) return p.onOrigin(model.origin.includes(item) ? model.origin.filter((x) => x !== item) : [...model.origin, item]);
    if (id === ROW.origin) return p.onOrigin(model.origin.length ? [] : ORIGIN);
    if (id === ROW.bodies) {
      return p.onBodiesHidden(
        model.parts.map((x) => x.id),
        model.parts.some((x) => !x.hidden),
      );
    }
    if (id === ROW.sketches) {
      const anyShown = model.sketches.some((s) => !s.hidden);
      return p.onSketchesHidden(
        model.sketches.map((s) => s.id),
        anyShown,
      );
    }
    const sk = model.sketches.find((s) => s.id === id);
    if (sk) return p.onSketchesHidden([id], !sk.hidden);
    p.onToggle(id, what);
  };

  const rename = (id: string, name: string) => (model.sketches.some((s) => s.id === id) ? p.onRenameSketch(id, name) : p.onRename(id, name));

  const menuFor = (id: string): { title?: string; entries: MenuEntry[] } => {
    const plane = planeOf(id);
    if (plane) {
      const shown = model.origin.includes(plane);
      return {
        title: `${plane} plane`,
        entries: [
          { id: "sketch", label: `Sketch on the ${plane} plane`, icon: "sketch", onSelect: () => p.onSketchOn(plane) },
          { id: "show", label: shown ? "Hide" : "Show", icon: shown ? "eyeOff" : "eye", onSelect: () => toggle(id, "hidden") },
        ],
      };
    }
    if (id === ROW.point) {
      const shown = model.origin.includes("point");
      return {
        title: "Origin point",
        entries: [{ id: "show", label: shown ? "Hide" : "Show", icon: shown ? "eyeOff" : "eye", onSelect: () => toggle(id, "hidden") }],
      };
    }
    const sk = model.sketches.find((s) => s.id === id);
    // Rename here, in the browser row, rather than in History.
    if (sk)
      return {
        title: sk.name,
        entries: p.sketchMenu(id).map((e) => (e.kind !== "separator" && e.id === "rename" ? { ...e, onSelect: () => p.onRenameIdChange(id) } : e)),
      };
    if (model.parts.some((x) => x.id === id)) {
      const chosen = model.parts.filter((x) => p.selection.includes(x.id));
      return { title: chosen.length > 1 ? `${chosen.length} parts` : chosen[0]?.name, entries: p.partMenu(p.selection) };
    }
    return { entries: [] };
  };
  const open = menu ? menuFor(menu.id) : null;

  return (
    <>
      <WideButton icon="plus" label="Add a box" variant="outline" onClick={() => p.onAdd("box")} />
      <h2 className="bc-panel-title">Browser</h2>
      <PartsTree
        label="Browser"
        items={items}
        selection={other ? [...p.selection, other] : p.selection}
        onSelect={select}
        onRename={rename}
        onToggle={toggle}
        onReorder={(id, before) => model.parts.some((x) => x.id === id) && p.onReorder(id, before)}
        toggles={["hidden", "ghost", "highlight"]}
        renameId={p.renameId}
        onRenameIdChange={p.onRenameIdChange}
        onContextMenu={(id, at) => setMenu({ id, at })}
      />
      <p className="bc-note">
        {model.parts.length > 0
          ? `Shift-click selects a range, ${formatCombo("mod")}-click adds one. Drag bodies to reorder, F2 to rename. Right-click a plane to sketch on it.`
          : "Nothing here yet. Add a shape from the Library, or start a sketch (K)."}
      </p>
      <p className="bc-note">
        Joints arrive with hinges, wheels and sliders (<a href="https://github.com/kevinmcaleer/BetterCad/issues/172">#172</a>).
      </p>
      <div className="bc-section-gap" />
      <Banner tone="info">Press K to sketch on a plane or a flat face, then E to extrude a closed shape into a solid.</Banner>
      <ContextMenu
        at={open && open.entries.length ? menu!.at : null}
        onClose={() => setMenu(null)}
        label="Browser actions"
        title={open?.title}
        entries={open?.entries ?? []}
      />
    </>
  );
}
