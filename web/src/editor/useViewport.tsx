import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clickSelect, Dialog, type MenuEntry } from "@bettercad/ui";
import { formatCombo, type Command } from "../state/commands";
import {
  appliedSection,
  applySection,
  changeParts,
  newId,
  nextSectionName,
  removeSection,
  renameSection,
  saveSection,
  type SectionAnalysis,
  nextViewName,
  placePart,
  removeView,
  saveView,
  setHome,
  type ModelDoc,
  type NamedView,
  type Part,
  type Vec3,
} from "../state/document";
import { presetOf, type CameraState, type Preset } from "../viewport/camera";
import type { RenderSession } from "../render/session";
import type { RenderStyle, Section } from "../viewport/engine";
import type { Pick, SelectFilter } from "../viewport/ids";
import type { View3DHandle, ViewMode } from "../viewport/View3D";
import type { ToolId, ViewId } from "./tools";

/** What a named view row in the browser asks for. */
export type ViewAct = "look" | "save" | "update" | "rename" | "delete" | "setHome" | "resetHome" | "strip";

export const FILTERS: { id: SelectFilter; label: string; key: string }[] = [
  { id: "body", label: "Bodies", key: "shift+1" },
  { id: "face", label: "Faces", key: "shift+2" },
  { id: "edge", label: "Edges", key: "shift+3" },
  { id: "vertex", label: "Points", key: "shift+4" },
];

const STYLE_KEY = "bettercad.renderStyle";
type StyleSetting = RenderStyle | "auto";

function readStyle(): StyleSetting {
  try {
    const v = localStorage.getItem(STYLE_KEY);
    return v === "shaded" || v === "lineart" ? v : "auto";
  } catch {
    return "auto";
  }
}

const GRID_KEY = "bettercad.floorGrid";

function readGrid(): boolean {
  try {
    return localStorage.getItem(GRID_KEY) !== "off";
  } catch {
    return true;
  }
}

export interface ViewportDeps {
  doc: ModelDoc;
  parts: Part[];
  selection: string[];
  setSelection: (ids: string[]) => void;
  tool: ToolId;
  theme: string;
  record: (fn: (d: ModelDoc, at: number | undefined) => ModelDoc, label: string, coalesceKey?: string) => void;
  editDoc: (fn: (d: ModelDoc) => ModelDoc, label: string, coalesceKey?: string) => void;
  /** A view-only model or an old version: section analyses then change for this look only. */
  locked: () => boolean;
  say: (text: string, error?: boolean) => void;
  /** Bodies locked to one by rigid groups, itself included; empty when it is in none. */
  matesOf?: (id: string) => string[];
  /** The Render view, while it is open: named views then look from, and save, the render's camera. */
  render?: RenderSession | null;
}

const ELEMENT_NAME: Record<SelectFilter, string> = { body: "Body", face: "Face", edge: "Edge", vertex: "Point" };

/**
 * Everything the editor needs from the 3D view: its state (pick filter, style, projection, section, named views),
 * its commands, and the props for View3D. Kept here so Editor.tsx only wires it in.
 */
export function useViewport(d: ViewportDeps) {
  const view3d = useRef<View3DHandle>(null);
  const [filter, setFilterState] = useState<SelectFilter>("body");
  const [elements, setElements] = useState<Pick[]>([]);
  const [styleSetting, setStyleSetting] = useState<StyleSetting>(readStyle);
  const [grid, setGrid] = useState(readGrid);
  const [colourCycle, setColourCycle] = useState(false);
  const [ortho, setOrtho] = useState(false);
  // Section analyses live in the model; on a model you can't change they change here, for this look only.
  const [scratch, setScratch] = useState<{ sections?: ModelDoc["sections"]; section?: string } | null>(null);
  useEffect(() => setScratch(null), [d.doc]);
  const sdoc = scratch ? { ...d.doc, ...scratch } : d.doc;
  const section: Section | null = appliedSection(sdoc);
  /** The analysis the Section tool is placing; none makes a new one on the next face clicked. */
  const [editing, setEditing] = useState<string | null>(null);
  useEffect(() => {
    if (d.tool !== "section") setEditing(null);
  }, [d.tool]);
  // `?perf` in the address turns the performance overlay on from the start (#42).
  const [stats, setStats] = useState(() => typeof location !== "undefined" && new URLSearchParams(location.search).has("perf"));
  const [view, setView] = useState<ViewId | null>("iso");
  const [naming, setNaming] = useState<{ id: string | null; name: string } | null>(null);
  const anchor = useRef<string | null>(null);
  const live = useRef(d);
  live.current = d;

  const style: RenderStyle = styleSetting === "auto" ? (d.theme === "holoroom" ? "lineart" : "shaded") : styleSetting;

  // Element picks go when their part does, or when the filter changes.
  useEffect(() => {
    setElements((es) => {
      const kept = es.filter((p) => d.parts.some((x) => x.id === p.body && !x.hidden));
      return kept.length === es.length ? es : kept;
    });
  }, [d.parts]);

  const setFilter = useCallback((f: SelectFilter) => {
    setFilterState(f);
    setElements([]);
    live.current.say(`A click picks ${FILTERS.find((x) => x.id === f)!.label.toLowerCase()}`);
  }, []);

  const picks = useMemo<Pick[]>(() => [...d.selection.map((id) => ({ body: id, kind: "body" as const, index: 0 })), ...elements], [d.selection, elements]);

  const mode: ViewMode = d.tool === "select" || d.tool === "move" || d.tool === "turn" || d.tool === "section" ? d.tool : "none";

  const onPick = useCallback((pick: Pick | null, mods: { shift: boolean; mod: boolean }) => {
    const add = mods.shift || mods.mod;
    if (!pick) {
      if (!add) {
        live.current.setSelection([]);
        setElements([]);
      }
      return;
    }
    if (pick.kind === "body") {
      const order = live.current.parts.map((p) => p.id);
      const r = clickSelect(order, live.current.selection, anchor.current, pick.body, { toggle: add });
      anchor.current = r.anchor;
      live.current.setSelection(r.selection);
      setElements([]);
      return;
    }
    live.current.setSelection([]);
    setElements((es) => {
      const has = es.some((e) => e.body === pick.body && e.kind === pick.kind && e.index === pick.index);
      if (!add) return has && es.length === 1 ? [] : [pick];
      return has ? es.filter((e) => !(e.body === pick.body && e.kind === pick.kind && e.index === pick.index)) : [...es, pick];
    });
  }, []);

  const onTransform = useCallback((id: string, position: [number, number, number], rotation: [number, number, number]) => {
    const p = live.current.parts.find((x) => x.id === id);
    if (!p) return;
    const pos: Vec3 = { x: position[0], y: position[1], z: position[2] };
    const rot: Vec3 = { x: rotation[0], y: rotation[1], z: rotation[2] };
    const verb = live.current.tool === "turn" ? "Turn" : "Move";
    const mates = live.current.matesOf?.(id) ?? [];
    if (mates.length < 2) return live.current.record((doc, at) => placePart(doc, id, pos, rot, at), `${verb} ${p.name}`);
    // A rigid group moves as one (its edits load on first use).
    void import("@bettercad/kernel/rigid").then(({ placeRigid }) =>
      live.current.record((doc, at) => placeRigid(doc, id, pos, rot, mates, at), `${verb} ${p.name} and the parts locked to it`),
    );
  }, []);

  const onTransforming = useCallback((_id: string, position: [number, number, number], rotation: [number, number, number]) => {
    const t = live.current.tool;
    const f = (n: number) => `${Math.round(n * 100) / 100}`;
    live.current.say(
      t === "turn"
        ? `Turn X ${f(rotation[0])}°, Y ${f(rotation[1])}°, Z ${f(rotation[2])}°`
        : `X ${f(position[0])} mm, Y ${f(position[1])} mm, Z ${f(position[2])} mm`,
    );
  }, []);

  const onCamera = useCallback((c: CameraState) => {
    const p = presetOf(c);
    const v: ViewId | null = p === "iso" || p === "front" || p === "side" || p === "top" ? p : null;
    setView((old) => (old === v ? old : v));
    // The menu and the O key follow the camera, which a sketch's Look at turns orthographic.
    setOrtho(c.ortho);
  }, []);

  const preset = useCallback((p: Preset) => view3d.current?.preset(p), []);
  const fit = useCallback(() => {
    const sel = live.current.selection;
    view3d.current?.fit(sel.length ? sel : undefined);
  }, []);

  // ---- home (the view cube's house and menu)
  /** The camera named views save: the render's while it is open, else the modelling view's. */
  const camNow = useCallback(() => live.current.render?.camera?.() ?? view3d.current?.camera(), []);
  const goHome = useCallback(() => {
    const r = live.current.render;
    if (r) r.standard?.("home");
    else view3d.current?.home(live.current.doc.home ?? null);
  }, []);
  /** Makes `camera` home: the modelling view's own camera, or the render's. */
  const setHomeTo = useCallback((camera: CameraState) => {
    live.current.editDoc((doc) => setHome(doc, camera), "Set the home view");
    live.current.say("Home is now this view");
  }, []);
  const setHomeHere = useCallback(() => {
    const camera = camNow();
    if (camera) setHomeTo(camera);
  }, [setHomeTo, camNow]);
  const resetHome = useCallback(() => {
    if (!live.current.doc.home) return;
    live.current.editDoc((doc) => setHome(doc, null), "Reset the home view");
    live.current.say("Home is the corner view again");
  }, []);
  const switchOrtho = useCallback((on: boolean) => {
    setOrtho(on);
    live.current.say(on ? "Orthographic: parallel lines stay parallel" : "Perspective: far things look smaller");
  }, []);

  // ---- named views: Home, Front, Side and Top, then the saved ones, in the browser's Named views folder
  const lookFrom = useCallback((v: NamedView) => {
    const r = live.current.render;
    if (r) r.look?.({ ...v.camera, ortho: false });
    else {
      view3d.current?.setCamera(v.camera, true);
      setOrtho(v.camera.ortho);
    }
    live.current.say(`Looking from ${v.name}`);
  }, []);
  const startSaveView = useCallback(() => setNaming({ id: null, name: nextViewName(live.current.doc) }), []);
  const finishNaming = useCallback(() => {
    if (!naming) return;
    const name = naming.name.trim() || nextViewName(live.current.doc);
    const existing = (live.current.doc.views ?? []).find((v) => v.id === naming.id);
    if (existing) {
      live.current.editDoc((doc) => saveView(doc, { ...existing, name }), `Rename view ${existing.name}`);
    } else {
      const camera = camNow();
      if (camera) {
        const id = newId("v");
        live.current.editDoc((doc) => saveView(doc, { id, name, camera }), `Save view ${name}`);
        live.current.say(`Saved the view as ${name}`);
      }
    }
    setNaming(null);
  }, [naming, camNow]);
  const updateView = useCallback(
    (v: NamedView) => {
      const camera = camNow();
      if (!camera) return;
      live.current.editDoc((doc) => saveView(doc, { ...v, camera }), `Update view ${v.name}`);
      live.current.say(`${v.name} now looks from here`);
    },
    [camNow],
  );
  const deleteView = useCallback((v: NamedView) => {
    live.current.editDoc((doc) => removeView(doc, v.id), `Delete view ${v.name}`);
  }, []);

  const views = d.doc.views ?? [];
  /** What the browser's Named views rows do: `id` is a saved view's id, or "home", "front", "side" or "top". */
  const viewAct = useCallback(
    (act: ViewAct, id?: string, name?: string) => {
      if (act === "save") return startSaveView();
      if (act === "setHome") return setHomeHere();
      if (act === "resetHome") return resetHome();
      if (act === "look" && id === "home") return goHome();
      if (act === "look" && (id === "front" || id === "side" || id === "top"))
        return live.current.render ? live.current.render.standard?.(id) : view3d.current?.preset(id);
      const v = (live.current.doc.views ?? []).find((x) => x.id === id);
      if (!v) return;
      if (act === "look") return lookFrom(v);
      if (act === "update") return updateView(v);
      if (act === "delete") return deleteView(v);
      const n = name?.trim();
      if (act === "rename" && n && n !== v.name) live.current.editDoc((doc) => saveView(doc, { ...v, name: n }), `Rename view ${v.name}`);
    },
    [startSaveView, setHomeHere, resetHome, goHome, lookFrom, updateView, deleteView],
  );
  const namedViews = {
    list: views.map((v) => ({ id: v.id, name: v.name })),
    /** The standard view the camera is in now, if it is one. */
    at: d.render ? null : view,
    homeSet: !!d.doc.home,
    act: viewAct,
  };

  const filterEntries: MenuEntry[] = FILTERS.map((f) => ({ id: f.id, label: f.label, checked: filter === f.id, onSelect: () => setFilter(f.id) }));

  /** Shaded or line art, or the other one of the two when `to` is left out. */
  const setStyle = useCallback((to?: RenderStyle) => {
    setStyleSetting((s) => {
      const now: RenderStyle = s === "auto" ? (live.current.theme === "holoroom" ? "lineart" : "shaded") : s;
      const next: RenderStyle = to ?? (now === "shaded" ? "lineart" : "shaded");
      try {
        localStorage.setItem(STYLE_KEY, next);
      } catch {
        // The choice lasts for this visit.
      }
      live.current.say(next === "lineart" ? "Line art: white parts with bold outlines" : "Shaded: lit parts for modelling");
      return next;
    });
  }, []);
  const toggleStyle = useCallback(() => setStyle(), [setStyle]);

  /** Shows or hides the floor grid, remembered on this browser. */
  const toggleGrid = useCallback(() => {
    setGrid((g) => {
      try {
        localStorage.setItem(GRID_KEY, g ? "off" : "on");
      } catch {
        // The choice lasts for this visit.
      }
      live.current.say(g ? "Floor grid hidden" : "Floor grid shown");
      return !g;
    });
  }, []);

  /** Colour cycling: each part in a colour of its own, for this visit. It never changes the colours the model saves. */
  const toggleColourCycle = useCallback(() => {
    setColourCycle((on) => {
      live.current.say(on ? "Colour cycle off: parts in their own colours" : "Colour cycle on: each part in its own colour");
      return !on;
    });
  }, []);

  /**
   * The view menu: under the view cube's arrow, and on a right-click in empty space. With the view bar gone it holds
   * the camera, how the view draws the model, and what a click picks.
   */
  const cubeMenu: MenuEntry[] = [
    { id: "home", label: "Go home", icon: "home", keys: formatCombo("home"), onSelect: goHome },
    { id: "fit", label: "Fit", icon: "frame", keys: "F", onSelect: fit },
    { id: "save-view", label: "Save this view…", icon: "camera", onSelect: startSaveView },
    { kind: "separator", id: "s1" },
    { id: "persp", label: "Perspective", checked: !ortho, onSelect: () => switchOrtho(false) },
    { id: "ortho", label: "Orthographic", checked: ortho, onSelect: () => switchOrtho(true) },
    { kind: "separator", id: "s-pick" },
    { kind: "title", id: "t-pick", label: "Pick" },
    ...FILTERS.map<MenuEntry>((f) => ({
      id: `pick-${f.id}`,
      label: f.label,
      keys: formatCombo(f.key),
      checked: filter === f.id,
      onSelect: () => setFilter(f.id),
    })),
    { kind: "separator", id: "s-style" },
    { kind: "title", id: "t-style", label: "Display" },
    { id: "shaded", label: "Shaded", checked: style === "shaded", onSelect: () => setStyle("shaded") },
    { id: "lineart", label: "Line art", keys: "L", checked: style === "lineart", onSelect: () => setStyle("lineart") },
    { id: "grid", label: "Floor grid", checked: grid, multiple: true, onSelect: toggleGrid },
    { id: "cycle", label: "Colour cycle", keys: formatCombo("shift+n"), checked: colourCycle, multiple: true, onSelect: toggleColourCycle },
    { kind: "separator", id: "s2" },
    { id: "set-home", label: "Set this view as home", onSelect: setHomeHere },
    { id: "reset-home", label: "Reset home", disabled: !d.doc.home, onSelect: resetHome },
  ];

  const sectionRef = useRef(section);
  sectionRef.current = section;
  const sdocRef = useRef(sdoc);
  sdocRef.current = sdoc;
  const editSections = useCallback((fn: (d: ModelDoc) => ModelDoc, label: string, key?: string) => {
    if (!live.current.locked()) return live.current.editDoc(fn, label, key);
    setScratch(() => {
      const n = fn(sdocRef.current);
      return { sections: n.sections, section: n.section };
    });
  }, []);
  const sections = useMemo(
    () => ({
      apply: (id: string | null) => {
        const x = sdocRef.current.sections?.find((s) => s.id === id);
        editSections((doc) => applySection(doc, id), x ? `Show ${x.name}` : "Turn off the section");
      },
      rename: (id: string, name: string) => editSections((doc) => renameSection(doc, id, name), "Rename section"),
      remove: (id: string) => {
        const x = sdocRef.current.sections?.find((s) => s.id === id);
        if (x) editSections((doc) => removeSection(doc, id), `Delete ${x.name}`);
      },
      /** Applies one and puts the Section tool on it; the editor arms the tool. */
      edit: (id: string) => {
        editSections((doc) => applySection(doc, id), "Edit section");
        setEditing(id);
      },
      save: (x: SectionAnalysis) => editSections((doc) => saveSection(doc, x), `Change ${x.name}`, `section:${x.id}`),
    }),
    [editSections],
  );
  const editingSection = (editing && sdoc.sections?.find((s) => s.id === editing)) || null;

  const commands = useMemo<Command[]>(() => {
    const presets: { id: ViewId; label: string; key: string }[] = [
      { id: "iso", label: "Iso", key: "1" },
      { id: "front", label: "Front", key: "2" },
      { id: "side", label: "Side", key: "3" },
      { id: "top", label: "Top", key: "4" },
    ];
    const list: Command[] = [
      { id: "view.home", label: "Go home", group: "View", icon: "home", keys: ["home"], run: goHome, keywords: "view cube reset camera" },
      ...presets.map<Command>((v) => ({ id: `view.${v.id}`, label: `${v.label} view`, group: "View", icon: "camera", keys: [v.key], run: () => preset(v.id) })),
      {
        id: "view.rollCw",
        label: "Turn the view clockwise 90°",
        group: "View",
        icon: "rotate",
        run: () => view3d.current?.engine()?.roll(1),
        keywords: "view cube roll rotate",
      },
      {
        id: "view.rollCcw",
        label: "Turn the view anticlockwise 90°",
        group: "View",
        icon: "rotate",
        run: () => view3d.current?.engine()?.roll(-1),
        keywords: "view cube roll rotate counterclockwise",
      },
      { id: "view.fit", scope: "model", label: "Fit the parts in the view", group: "View", icon: "frame", keys: ["f"], run: fit },
      {
        id: "view.ortho",
        scope: "model",
        label: "Switch perspective and orthographic",
        group: "View",
        icon: "cube",
        keys: ["o"],
        run: () => setOrtho((o) => !o),
        keywords: "projection parallel",
      },
      {
        id: "view.style",
        scope: "model",
        label: "Switch shaded and line art",
        group: "View",
        icon: "paint",
        keys: ["l"],
        run: toggleStyle,
        keywords: "render style outline",
      },
      { id: "view.grid", scope: "model", label: "Show or hide the floor grid", group: "View", icon: "grid", run: toggleGrid, keywords: "floor grid lines" },
      {
        id: "view.colourCycle",
        scope: "model",
        label: "Colour cycle",
        group: "View",
        icon: "paint",
        keys: ["shift+n"],
        run: toggleColourCycle,
        keywords: "color colour each part component distinct unique",
      },
      { id: "view.setHome", label: "Set this view as home", group: "View", icon: "home", run: setHomeHere, keywords: "view cube camera" },
      {
        id: "view.resetHome",
        label: "Reset home",
        group: "View",
        icon: "home",
        run: resetHome,
        when: () => !!live.current.doc.home,
        keywords: "view cube camera corner",
      },
      { id: "view.save", label: "Save this view…", group: "View", icon: "camera", run: startSaveView, keywords: "named view camera" },
      {
        id: "view.clearSection",
        label: "Turn off the section",
        group: "View",
        icon: "section",
        run: () => sections.apply(null),
        when: () => sectionRef.current !== null,
      },
      ...FILTERS.map<Command>((f) => ({
        id: `pick.${f.id}`,
        label: `Pick ${f.label.toLowerCase()}`,
        group: "Edit",
        icon: "arrow",
        keys: [f.key],
        run: () => setFilter(f.id),
        keywords: "selection filter",
      })),
    ];
    if (import.meta.env.DEV || import.meta.env.VITE_GALLERY) {
      list.push({ id: "dev.stats", label: "Show frame times", group: "Help", icon: "info", run: () => setStats((s) => !s), keywords: "performance fps" });
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // A face clicked makes a new section analysis, or moves the one being edited; the arrow pushes the one on show.
  const editingRef = useRef(editingSection);
  editingRef.current = editingSection;
  const onSection = useCallback(
    (s: Section) => {
      const shown = appliedSection(sdocRef.current);
      const cur = editingRef.current ?? (shown && shown.origin === s.origin ? shown : null);
      if (cur) {
        setEditing(cur.id);
        if (cur.origin !== s.origin) live.current.say(`${cur.name} cuts through the face. Drag the arrow or type how far.`);
        return sections.save({ ...cur, origin: s.origin, normal: s.normal, offset: s.offset });
      }
      const id = newId("sec");
      const name = nextSectionName(sdocRef.current);
      editSections((doc) => saveSection(doc, { id, name, origin: s.origin, normal: s.normal, offset: s.offset }), `Add ${name}`, `section:${id}`);
      setEditing(id);
      live.current.say(`${name} cuts through the face. Find it under Analysis in the browser.`);
    },
    [sections, editSections],
  );

  const elementText = elements.length
    ? elements.length === 1
      ? `${ELEMENT_NAME[elements[0]!.kind]} ${elements[0]!.index + 1} of ${d.parts.find((p) => p.id === elements[0]!.body)?.name ?? "a part"} picked.`
      : `${elements.length} ${FILTERS.find((f) => f.id === elements[0]!.kind)!.label.toLowerCase()} picked.`
    : "";

  const namingDialog = (
    <Dialog
      open={!!naming}
      title={naming?.id ? "Rename view" : "Save this view"}
      icon="camera"
      modal
      onCancel={() => setNaming(null)}
      onDone={finishNaming}
      doneLabel={naming?.id ? "Rename" : "Save"}
    >
      <label className="bc-dialog-field">
        <span>Name</span>
        <input
          className="bc-text"
          autoFocus
          value={naming?.name ?? ""}
          onChange={(e) => setNaming((n) => (n ? { ...n, name: e.target.value } : n))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              finishNaming();
            }
          }}
        />
      </label>
    </Dialog>
  );

  /** The Rotation fields in the props panel. */
  const onRotate = useCallback((ids: string[], axis: keyof Vec3, value: number, name: string) => {
    live.current.record((doc, at) => changeParts(doc, ids, "rotation", { [axis]: value }, at), `Turn ${name}`, `props:${ids.join(",")}:rotation.${axis}`);
  }, []);

  return {
    ref: view3d,
    filter,
    setFilter,
    filterEntries,
    elements,
    clearElements: () => setElements([]),
    elementText,
    picks,
    mode,
    style,
    grid,
    toggleGrid,
    colourCycle,
    toggleColourCycle,
    ortho,
    setOrtho,
    section,
    /** Section analyses: the saved ones, the one on show, and the one the Section tool is editing. */
    sectionList: sdoc.sections ?? [],
    appliedSection: sdoc.section ?? null,
    editingSection,
    sections,
    stats,
    view,
    preset,
    fit,
    namedViews,
    goHome,
    setHomeTo,
    resetHome,
    cubeMenu,
    namingOpen: !!naming,
    namingDialog,
    commands,
    onPick,
    onTransform,
    onTransforming,
    onSection,
    onCamera,
    onRotate,
    toggleStyle,
    setStyle,
  };
}

export type Viewport = ReturnType<typeof useViewport>;
