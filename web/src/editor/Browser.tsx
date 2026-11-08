import { useEffect, useRef, useState } from "react";
import { ContextMenu, PartsTree, type ContextMenuState, type MenuEntry, type RowToggle, type TreeItem } from "@bettercad/ui";
import { JOINT_KINDS, type BuiltLink, type ConstructWhat, type JointFeature, type Part, type PartKind } from "../state/document";
import type { WorldPlaneName } from "../viewport/engine";
import { constructIcon, partIcon } from "./Timeline";

/**
 * The browser (Fusion's): the model at the top, then its origin planes, construction, bodies and sketches in folders,
 * then its components (#171), each with folders of its own and the components inside it, then joints. Eyes show and
 * hide, clicks select, a component's radio makes it the one you work in. Bodies keep the parts tree's ghost and
 * highlight, drag and rename.
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
  poses: "browser:poses",
  home: "browser:pose-home",
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
  /** The component it was made in (#171). */
  component?: string;
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
  /** Components (#171), empty ones too: rigid groups of bodies, nested by `parent`. Bodies in none are the model's. */
  links?: BuiltLink[];
  /** The component you're working in; none for the model. */
  active?: string | null;
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

const bodies = (n: number) => (n === 1 ? "1 body" : n ? `${n} bodies` : "Empty");

/** A folder's row id in a component (#171); the model's own folders keep the plain ids. */
const inComp = (folder: string, c?: string) => (c ? `${folder}:${c}` : folder);
/** The folder kind and component a folder row id names, if it is one. */
function folderOf(id: string): { folder: string; c?: string } | null {
  for (const folder of [ROW.bodies, ROW.sketches, ROW.construct])
    if (id === folder || id.startsWith(`${folder}:`)) return { folder, c: id.slice(folder.length + 1) || undefined };
  return null;
}

/** Who owns what (#171): each body, sketch and construction step's component, if it's still there. */
function owners(m: BrowserModel) {
  const comps = m.links ?? [];
  const known = new Set(comps.map((c) => c.id));
  const own = (c?: string) => (c && known.has(c) ? c : undefined);
  // A component's parent, if it's there and not inside the component itself.
  const parentOf = (c: BuiltLink) => {
    for (let up = own(c.parent), n = 0; up && n <= comps.length; up = own(comps.find((x) => x.id === up)?.parent), n++) if (up === c.id) return undefined;
    return own(c.parent);
  };
  const inside = (c: string): string[] => comps.filter((x) => parentOf(x) === c).flatMap((x) => [x.id, ...inside(x.id)]);
  return {
    comps,
    parentOf,
    inside,
    parts: (c?: string) => m.parts.filter((p) => own(p.link) === c),
    sketches: (c?: string) => m.sketches.filter((s) => own(s.component) === c),
    construct: (c?: string) => (m.construct ?? []).filter((s) => own(s.component) === c),
  };
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
  // The model's name heads the tree, as the file name heads Fusion's browser: double-click or F2 renames it.
  // Rows can be dragged into a component, or back to the model, unless the model is view-only (#334).
  const move = !m.readOnly;
  const items: TreeItem[] = [{ id: ROW.root, name: m.name, icon: "layers", kind: "component", drag: false, rename: !m.readOnly, toggles: [], into: move }];
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
  // Then the model's own folders and components, and each component's, inside out (#171).
  const o = owners(m);
  const joints = m.joints ?? [];
  const jointOf = new Map(joints.map((j) => [j.child, j]));
  const contents = (c: string | undefined, row: string) => {
    // Construction geometry (#265), as in Fusion; Bodies and Sketches show once they have something in them.
    const cons = o.construct(c);
    if (cons.length)
      items.push(
        folder(inComp(ROW.construct, c), "Construction", {
          parentId: row,
          icon: "plane",
          note: count(cons.length),
          hidden: cons.every((x) => x.hidden),
          into: move,
        }),
      );
    for (const x of cons) {
      items.push({
        id: x.id,
        name: x.name,
        icon: constructIcon(x.what),
        kind: x.what,
        parentId: inComp(ROW.construct, c),
        drag: false,
        move,
        toggles: ["hidden"],
        hidden: x.hidden,
        warning: x.warning,
      });
    }
    const ps = o.parts(c);
    if (ps.length)
      items.push(folder(inComp(ROW.bodies, c), "Bodies", { parentId: row, note: count(ps.length), hidden: ps.every((p) => p.hidden), into: move }));
    for (const part of ps) {
      items.push({
        id: part.id,
        name: part.name,
        icon: partIcon(part.kind as PartKind),
        kind: "body",
        parentId: inComp(ROW.bodies, c),
        move,
        hidden: part.hidden,
        ghost: part.ghost,
        highlight: part.highlight,
      });
    }
    const sks = o.sketches(c);
    if (sks.length)
      items.push(folder(inComp(ROW.sketches, c), "Sketches", { parentId: row, note: count(sks.length), hidden: sks.every((x) => x.hidden), into: move }));
    for (const x of sks) {
      items.push({
        id: x.id,
        name: x.name,
        icon: "sketch",
        kind: "sketch",
        parentId: inComp(ROW.sketches, c),
        drag: false,
        move,
        toggles: ["hidden"],
        hidden: x.hidden,
        warning: x.warning,
      });
    }
    // Its components, each with its joint (#172) named.
    for (const k of o.comps.filter((x) => o.parentOf(x) === c)) {
      const j = jointOf.get(k.id);
      const note = j ? `${bodies(k.parts.length)}, ${kindLabel(j.kind).toLowerCase()} on ${j.name}` : bodies(k.parts.length);
      items.push({
        id: k.id,
        name: k.name,
        icon: "component",
        kind: "component",
        parentId: row,
        drag: false,
        move,
        into: move,
        toggles: m.readOnly ? [] : ["active"],
        active: m.active === k.id,
        note,
      });
      contents(k.id, k.id);
    }
  };
  if (o.comps.length && !m.readOnly) Object.assign(items[0]!, { toggles: ["active"], active: !m.active });
  contents(undefined, ROW.root);
  // Joints (#172): each hangs a component from another.
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
  const whole = ids.includes(ROW.root);
  // A component row picks its bodies and those of the components inside it (#171); a Bodies folder, its own.
  const o = owners(m);
  const linked = ids.flatMap((id) => {
    const f = folderOf(id);
    if (f?.folder === ROW.bodies) return o.parts(f.c).map((p) => p.id);
    return o.comps.some((c) => c.id === id) ? [id, ...o.inside(id)].flatMap((c) => o.parts(c).map((p) => p.id)) : [];
  });
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
  onToggle: (id: string, what: Exclude<RowToggle, "active">) => void;
  /** Makes a component (#171) the one you work in, or the model (null). */
  onActivate?: (id: string | null) => void;
  /** Moves bodies, sketches, construction or components into a component, or the model (null) (#334). */
  onMoveInto?: (ids: string[], to: string | null) => void;
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
    // Picking a component makes it the one you work in, as its radio does; picking the model, the model. It stays
    // active until you pick another, so new planes, sketches and bodies go into it.
    if (!model.readOnly && p.onActivate) {
      if (last === ROW.root && model.active) p.onActivate(null);
      else if (last && last !== model.active && (model.links ?? []).some((c) => c.id === last)) p.onActivate(last);
    }
    if (last === ROW.home) return p.onPose?.(null);
    if (last && model.poses?.some((x) => x.id === last)) return p.onPose?.(last);
    if (last && (model.joints?.some((j) => j.id === last) || model.construct?.some((c) => c.id === last))) p.onSelectSketch(last);
    else if (r.other && model.sketches.some((s) => s.id === r.other) && last === r.other) p.onSelectSketch(r.other);
    else p.onSelect(r.parts);
  };

  const toggle = (id: string, what: RowToggle) => {
    if (what === "active") return p.onActivate?.(id === ROW.root ? null : id);
    const item = originItemOf(id);
    if (item) return p.onOrigin(model.origin.includes(item) ? model.origin.filter((x) => x !== item) : [...model.origin, item]);
    if (id === ROW.origin) return p.onOrigin(model.origin.length ? [] : ORIGIN);
    // A folder's eye: everything in it, in the model or in one component.
    const f = folderOf(id);
    if (f) {
      const o = owners(model);
      if (f.folder === ROW.bodies) {
        const ps = o.parts(f.c);
        return p.onBodiesHidden(
          ps.map((x) => x.id),
          ps.some((x) => !x.hidden),
        );
      }
      const xs = f.folder === ROW.sketches ? o.sketches(f.c) : o.construct(f.c);
      return p.onSketchesHidden(
        xs.map((x) => x.id),
        xs.some((x) => !x.hidden),
      );
    }
    const cons = model.construct ?? [];
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
          ...(model.readOnly || model.active === id
            ? []
            : [{ id: "activate", label: "Activate", icon: "radioOn" as const, onSelect: () => p.onActivate?.(id) }]),
          { id: "select", label: "Select its bodies", icon: "component", onSelect: () => select([id]) },
          { id: "rename", label: "Rename", icon: "pencil", keys: "F2", onSelect: () => p.onRenameIdChange(id) },
        ],
      };
    if (id === ROW.root && model.active && !model.readOnly)
      return { title: model.name, entries: [{ id: "activate", label: "Activate the model", icon: "radioOn", onSelect: () => p.onActivate?.(null) }] };
    if (model.parts.some((x) => x.id === id)) {
      const chosen = model.parts.filter((x) => p.selection.includes(x.id));
      return { title: chosen.length > 1 ? `${chosen.length} parts` : chosen[0]?.name, entries: p.partMenu(p.selection) };
    }
    return { entries: [] };
  };
  // Move into a component (#334): what a drag does, from the menu, for touch and the keyboard.
  const o = owners(model);
  const ownerOf = (id: string): string | undefined => {
    const c = o.comps.find((x) => x.id === id);
    if (c) return o.parentOf(c);
    const part = model.parts.find((x) => x.id === id);
    const known = (k?: string) => (k && o.comps.some((x) => x.id === k) ? k : undefined);
    if (part) return known(part.link);
    return known([...model.sketches, ...(model.construct ?? [])].find((x) => x.id === id)?.component);
  };
  const movable = (id: string) => items.some((i) => i.id === id && i.move);
  /** What a drag of `id` moves: the selection's bodies with it, when it's one of them. */
  const moving = (id: string) => (p.selection.includes(id) ? [...new Set([id, ...p.selection.filter(movable)])] : [id]);
  const moveTo = (ids: string[], to: string | null) =>
    p.onMoveInto?.(
      ids.filter((x) => (ownerOf(x) ?? null) !== to && x !== to),
      to,
    );
  const dropInto = (id: string, row: string) => {
    const f = folderOf(row);
    moveTo(moving(id), row === ROW.root ? null : f ? (f.c ?? null) : row);
  };
  const moveEntries = (id: string): MenuEntry[] => {
    if (!movable(id) || !p.onMoveInto) return [];
    const now = ownerOf(id);
    const inside = new Set([id, ...o.inside(id)]);
    return [
      ...(now ? [{ id: "move-model", label: `Move to ${model.name}`, icon: "layers" as const, onSelect: () => moveTo(moving(id), null) }] : []),
      ...o.comps
        .filter((c) => c.id !== now && !inside.has(c.id))
        .map((c) => ({ id: `move-${c.id}`, label: `Move into ${c.name}`, icon: "component" as const, onSelect: () => moveTo(moving(id), c.id) })),
    ];
  };
  const shown = menu ? menuFor(menu.id) : null;
  const extra = menu ? moveEntries(menu.id) : [];
  const open = shown && extra.length ? { ...shown, entries: [...shown.entries, { kind: "separator" as const, id: "move-sep" }, ...extra] } : shown;

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
        onDropInto={p.onMoveInto && !model.readOnly ? dropInto : undefined}
        toggles={["hidden", "ghost", "highlight"]}
        renameId={p.renameId}
        onRenameIdChange={p.onRenameIdChange}
        onContextMenu={(id, at) => setMenu({ id, at })}
      />
      {/* The how-to tips live in the tips card (Help → Tips); only the empty model keeps a first step here. */}
      {model.parts.length === 0 && <p className="bc-note">Double-click the name to rename your model. Add a shape from the Library, or start a sketch (K).</p>}
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
