import { useEffect, useRef, useState } from "react";
import { Banner, ContextMenu, PartsTree, type ContextMenuState, type MenuEntry, type RowToggle, type TreeItem } from "@bettercad/ui";
import { JOINT_KINDS, type BuiltLink, type ConstructWhat, type JointFeature, type Part, type PartKind } from "../state/document";
import type { WorldPlaneName } from "../viewport/engine";
import { formatCombo } from "../state/commands";
import { constructIcon, partIcon } from "./Timeline";

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
  construct: "browser:construct",
  joints: "browser:joints",
  robot: "browser:robot",
  poses: "browser:poses",
  home: "browser:pose-home",
  base: "browser:base",
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

/** A construction plane, axis or point (#265) in the browser. */
export interface BrowserConstruct extends BrowserSketch {
  what: ConstructWhat;
}

export interface BrowserModel {
  name: string;
  parts: Part[];
  sketches: BrowserSketch[];
  /** The origin point and planes on show. */
  origin: OriginItem[];
  /** A shared, view-only model: its name can't be changed. */
  readOnly?: boolean;
  /** Links (#171): rigid groups of bodies. Bodies in none are in the base link. */
  links?: BuiltLink[];
  /** Joints (#172): each hangs a child link from a parent link, or from Base. */
  joints?: Pick<JointFeature, "id" | "name" | "kind" | "child" | "parent">[];
  /** Construction planes, axes and points (#265). */
  construct?: BrowserConstruct[];
  /** Named poses (#177), under Joints once there are joints; Home is always first. */
  poses?: { id: string; name: string }[];
  /** The named pose the joints are in now, or "home"; none when they've moved since. */
  atPose?: string | null;
}

const kindLabel = (k: JointFeature["kind"]) => JOINT_KINDS.find((x) => x.id === k)!.label;

const bodies = (n: number) => (n === 1 ? "1 body" : `${n} bodies`);

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
  // The model's name heads the tree, as the file name heads Fusion's browser: double-click or F2 renames it.
  const items: TreeItem[] = [{ id: ROW.root, name: m.name, icon: "layers", kind: "component", drag: false, rename: !m.readOnly, toggles: [] }];
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
  // Construction geometry (#265) sits under Origin, as in Fusion, once there is some.
  const cons = m.construct ?? [];
  if (cons.length) items.push(folder(ROW.construct, "Construction", { icon: "plane", note: count(cons.length), hidden: cons.every((c) => c.hidden) }));
  for (const c of cons) {
    items.push({
      id: c.id,
      name: c.name,
      icon: constructIcon(c.what),
      kind: c.what,
      parentId: ROW.construct,
      drag: false,
      toggles: ["hidden"],
      hidden: c.hidden,
      warning: c.warning,
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
  // The robot (#171): Base, then each link under the link it hangs from (#172), with its joint named.
  const links = m.links ?? [];
  const joints = m.joints ?? [];
  if (links.length) {
    const inLink = new Set(links.flatMap((l) => l.parts));
    items.push(folder(ROW.robot, "Robot", { icon: "link", note: count(links.length), toggles: [] }));
    items.push({
      id: ROW.base,
      name: "Base",
      icon: "link",
      kind: "link",
      parentId: ROW.robot,
      drag: false,
      rename: false,
      toggles: [],
      note: bodies(m.parts.filter((p) => !inLink.has(p.id)).length),
    });
    const jointOf = new Map(joints.map((j) => [j.child, j]));
    const known = new Set(links.map((l) => l.id));
    const under = (row: string, parent: string | null | undefined) => {
      for (const l of links) {
        const j = jointOf.get(l.id);
        // A link hangs under its joint's parent; one with no joint (or whose parent is gone) sits loose under Robot.
        const from = j && (j.parent === null || known.has(j.parent)) ? j.parent : undefined;
        if (parent === undefined ? from !== undefined : from !== parent) continue;
        const note = j && from !== undefined ? `${bodies(l.parts.length)}, ${kindLabel(j.kind).toLowerCase()} on ${j.name}` : bodies(l.parts.length);
        items.push({ id: l.id, name: l.name, icon: "link", kind: "link", parentId: row, drag: false, toggles: [], note });
        under(l.id, l.id);
      }
    };
    under(ROW.base, null);
    under(ROW.robot, undefined);
  }
  // Joints (#172): each hangs a link from another.
  items.push(folder(ROW.joints, "Joints", { note: joints.length ? count(joints.length) : "None yet", toggles: [] }));
  for (const j of joints) {
    items.push({ id: j.id, name: j.name, icon: "joint", kind: "joint", parentId: ROW.joints, drag: false, toggles: [], note: kindLabel(j.kind) });
  }
  // Named poses (#177): Home, then each saved one. Click one to go to it.
  if (joints.length) {
    const poses = m.poses ?? [];
    items.push(folder(ROW.poses, "Poses", { icon: "joint", note: count(poses.length + 1), toggles: [] }));
    const here = (id: string) => (m.atPose === id ? "Now" : undefined);
    items.push({ id: ROW.home, name: "Home", icon: "home", kind: "pose", parentId: ROW.poses, drag: false, rename: false, toggles: [], note: here("home") });
    for (const p of poses)
      items.push({ id: p.id, name: p.name, icon: "joint", kind: "pose", parentId: ROW.poses, drag: false, rename: !m.readOnly, toggles: [], note: here(p.id) });
  }
  return items;
}

/**
 * What a click in the browser selects. Bodies are the editor's selection: the Bodies folder or the model picks every
 * body. A sketch or a plane is the browser's own pick; the last one clicked wins.
 */
export function browserPick(ids: string[], m: BrowserModel): { parts: string[]; other: string | null } {
  const partIds = new Set(m.parts.map((p) => p.id));
  const whole = ids.includes(ROW.root) || ids.includes(ROW.bodies);
  // A link row picks its bodies; Base picks the bodies in no link.
  const links = m.links ?? [];
  const inLink = new Set(links.flatMap((l) => l.parts));
  const linked = ids.flatMap((id) =>
    id === ROW.base ? m.parts.filter((p) => !inLink.has(p.id)).map((p) => p.id) : (links.find((l) => l.id === id)?.parts ?? []),
  );
  const parts = whole ? m.parts.map((p) => p.id) : [...new Set([...ids.filter((id) => partIds.has(id)), ...linked])];
  const sketchIds = new Set([...m.sketches, ...(m.construct ?? [])].map((s) => s.id));
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
  /** The model's own name, from the top row. */
  onRenameModel: (name: string) => void;
  onRenameSketch: (id: string, name: string) => void;
  onReorder: (id: string, beforeId: string | null) => void;
  onSketchOn: (plane: WorldPlaneName) => void;
  /** Starts a sketch on a construction plane (#265). */
  onSketchOnStep?: (id: string) => void;
  partMenu: (ids: string[]) => MenuEntry[];
  sketchMenu: (id: string) => MenuEntry[];
  renameId: string | null;
  onRenameIdChange: (id: string | null) => void;
  /** Named poses (#177): go to one (null: Home), save the joints as a new one, update, rename or delete one. */
  onPose?: (id: string | null) => void;
  onSavePose?: () => void;
  onUpdatePose?: (id: string) => void;
  onRenamePose?: (id: string, name: string) => void;
  onDeletePose?: (id: string) => void;
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
    const last = ids[ids.length - 1];
    if (last === ROW.home) return p.onPose?.(null);
    if (last && model.poses?.some((x) => x.id === last)) return p.onPose?.(last);
    if (last && (model.joints?.some((j) => j.id === last) || model.construct?.some((c) => c.id === last))) p.onSelectSketch(last);
    else if (r.other && model.sketches.some((s) => s.id === r.other) && last === r.other) p.onSelectSketch(r.other);
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
    const cons = model.construct ?? [];
    if (id === ROW.construct)
      return p.onSketchesHidden(
        cons.map((c) => c.id),
        cons.some((c) => !c.hidden),
      );
    const sk = model.sketches.find((s) => s.id === id) ?? cons.find((c) => c.id === id);
    if (sk) return p.onSketchesHidden([id], !sk.hidden);
    p.onToggle(id, what);
  };

  const rename = (id: string, name: string) => {
    if (id === ROW.root) return p.onRenameModel(name);
    if (model.poses?.some((x) => x.id === id)) return p.onRenamePose?.(id, name);
    if (
      model.sketches.some((s) => s.id === id) ||
      model.links?.some((l) => l.id === id) ||
      model.joints?.some((j) => j.id === id) ||
      model.construct?.some((c) => c.id === id)
    )
      return p.onRenameSketch(id, name);
    p.onRename(id, name);
  };

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
    const con = model.construct?.find((c) => c.id === id);
    if (con)
      return {
        title: con.name,
        entries: [
          ...(con.what === "plane" && p.onSketchOnStep && !con.warning
            ? [{ id: "sketch", label: `Sketch on ${con.name}`, icon: "sketch" as const, onSelect: () => p.onSketchOnStep!(id) }]
            : []),
          { id: "show", label: con.hidden ? "Show" : "Hide", icon: con.hidden ? ("eye" as const) : ("eyeOff" as const), onSelect: () => toggle(id, "hidden") },
          ...p.sketchMenu(id).map((e) => (e.kind !== "separator" && e.id === "rename" ? { ...e, onSelect: () => p.onRenameIdChange(id) } : e)),
        ],
      };
    const joint = model.joints?.find((j) => j.id === id);
    if (joint)
      return {
        title: joint.name,
        entries: p.sketchMenu(id).map((e) => (e.kind !== "separator" && e.id === "rename" ? { ...e, onSelect: () => p.onRenameIdChange(id) } : e)),
      };
    if (id === ROW.poses || id === ROW.home)
      return {
        title: id === ROW.home ? "Home" : "Poses",
        entries: [
          ...(id === ROW.home ? [{ id: "go", label: "Go to Home", icon: "home" as const, onSelect: () => p.onPose?.(null) }] : []),
          ...(model.readOnly ? [] : [{ id: "save", label: "Save pose", icon: "plus" as const, onSelect: () => p.onSavePose?.() }]),
        ],
      };
    const pose = model.poses?.find((x) => x.id === id);
    if (pose)
      return {
        title: pose.name,
        entries: [
          { id: "go", label: `Go to ${pose.name}`, icon: "joint", onSelect: () => p.onPose?.(id) },
          ...(model.readOnly
            ? []
            : [
                { id: "update", label: "Update to the joints now", icon: "save" as const, onSelect: () => p.onUpdatePose?.(id) },
                { id: "rename", label: "Rename", icon: "pencil" as const, keys: "F2", onSelect: () => p.onRenameIdChange(id) },
                { id: "delete", label: "Delete", icon: "trash" as const, onSelect: () => p.onDeletePose?.(id) },
              ]),
        ],
      };
    const link = model.links?.find((l) => l.id === id);
    if (link)
      return {
        title: link.name,
        entries: [
          { id: "select", label: "Select its bodies", icon: "link", onSelect: () => select([id]) },
          { id: "rename", label: "Rename", icon: "pencil", keys: "F2", onSelect: () => p.onRenameIdChange(id) },
        ],
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
      <h2 className="bc-sr-only">Browser</h2>
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
          : "Double-click the name to rename your model. Add a shape from the Library, or start a sketch (K)."}
      </p>
      <p className="bc-note">Make links from bodies, then use the Joint tool to hang each from another.</p>
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
