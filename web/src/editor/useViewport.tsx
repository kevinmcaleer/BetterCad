import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clickSelect, Dialog, type MenuEntry } from "@bettercad/ui";
import { formatCombo, type Command } from "../state/commands";
import {
  changeParts,
  newId,
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
import type { RenderStyle, Section } from "../viewport/engine";
import type { Pick, SelectFilter } from "../viewport/ids";
import type { View3DHandle, ViewMode } from "../viewport/View3D";
import type { ToolId, ViewId } from "./tools";

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

export interface ViewportDeps {
  doc: ModelDoc;
  parts: Part[];
  selection: string[];
  setSelection: (ids: string[]) => void;
  tool: ToolId;
  theme: string;
  record: (fn: (d: ModelDoc, at: number | undefined) => ModelDoc, label: string, coalesceKey?: string) => void;
  editDoc: (fn: (d: ModelDoc) => ModelDoc, label: string) => void;
  say: (text: string, error?: boolean) => void;
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
  const [ortho, setOrtho] = useState(false);
  const [section, setSection] = useState<Section | null>(null);
  const [stats, setStats] = useState(false);
  const [view, setView] = useState<ViewId | null>("iso");
  const [naming, setNaming] = useState<{ id: string | null; name: string } | null>(null);
  const [lastView, setLastView] = useState<string | null>(null);
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
    live.current.record((doc, at) => placePart(doc, id, pos, rot, at), `${live.current.tool === "turn" ? "Turn" : "Move"} ${p.name}`);
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
  const goHome = useCallback(() => {
    view3d.current?.home(live.current.doc.home ?? null);
  }, []);
  /** Makes `camera` home: the modelling view's own camera, or the render's. */
  const setHomeTo = useCallback((camera: CameraState) => {
    live.current.editDoc((doc) => setHome(doc, camera), "Set the home view");
    live.current.say("Home is now this view");
  }, []);
  const setHomeHere = useCallback(() => {
    const camera = view3d.current?.camera();
    if (camera) setHomeTo(camera);
  }, [setHomeTo]);
  const resetHome = useCallback(() => {
    if (!live.current.doc.home) return;
    live.current.editDoc((doc) => setHome(doc, null), "Reset the home view");
    live.current.say("Home is the corner view again");
  }, []);
  const switchOrtho = useCallback((on: boolean) => {
    setOrtho(on);
    live.current.say(on ? "Orthographic: parallel lines stay parallel" : "Perspective: far things look smaller");
  }, []);

  const cubeMenu: MenuEntry[] = [
    { id: "home", label: "Go home", icon: "home", keys: formatCombo("home"), onSelect: goHome },
    { kind: "separator", id: "s1" },
    { id: "persp", label: "Perspective", checked: !ortho, onSelect: () => switchOrtho(false) },
    { id: "ortho", label: "Orthographic", checked: ortho, onSelect: () => switchOrtho(true) },
    { kind: "separator", id: "s2" },
    { id: "set-home", label: "Set this view as home", onSelect: setHomeHere },
    { id: "reset-home", label: "Reset home", disabled: !d.doc.home, onSelect: resetHome },
  ];

  // ---- named views
  const lookFrom = useCallback((v: NamedView) => {
    view3d.current?.setCamera(v.camera, true);
    setLastView(v.id);
    setOrtho(v.camera.ortho);
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
      const camera = view3d.current?.camera();
      if (camera) {
        const id = newId("v");
        live.current.editDoc((doc) => saveView(doc, { id, name, camera }), `Save view ${name}`);
        setLastView(id);
        live.current.say(`Saved the view as ${name}`);
      }
    }
    setNaming(null);
  }, [naming]);
  const updateView = useCallback((v: NamedView) => {
    const camera = view3d.current?.camera();
    if (!camera) return;
    live.current.editDoc((doc) => saveView(doc, { ...v, camera }), `Update view ${v.name}`);
    live.current.say(`${v.name} now looks from here`);
  }, []);
  const deleteView = useCallback((v: NamedView) => {
    live.current.editDoc((doc) => removeView(doc, v.id), `Delete view ${v.name}`);
    setLastView((l) => (l === v.id ? null : l));
  }, []);

  const views = d.doc.views ?? [];
  const current = views.find((v) => v.id === lastView);
  const viewEntries: MenuEntry[] = [
    { id: "save", label: "Save this view…", icon: "camera", onSelect: startSaveView },
    ...(views.length
      ? [
          { kind: "separator" as const, id: "s1" },
          { kind: "title" as const, id: "t1", label: "Your views" },
        ]
      : []),
    ...views.map<MenuEntry>((v) => ({ id: `use-${v.id}`, label: v.name, icon: "eye", checked: v.id === lastView, onSelect: () => lookFrom(v) })),
    ...(current
      ? [
          { kind: "separator" as const, id: "s2" },
          { id: "update", label: `Update ${current.name} to this view`, icon: "redo" as const, onSelect: () => updateView(current) },
          { id: "rename", label: `Rename ${current.name}…`, icon: "pencil" as const, onSelect: () => setNaming({ id: current.id, name: current.name }) },
          { id: "delete", label: `Delete ${current.name}`, icon: "trash" as const, danger: true, onSelect: () => deleteView(current) },
        ]
      : []),
  ];

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

  const sectionRef = useRef(section);
  sectionRef.current = section;

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
        label: "Clear the section",
        group: "View",
        icon: "section",
        run: () => setSection(null),
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
  const onSection = useCallback((s: Section) => {
    setSection((old) => {
      if (!old || old.origin !== s.origin) live.current.say("Cut through the face. Drag the arrow or type how far.");
      return s;
    });
  }, []);

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
    ortho,
    setOrtho,
    section,
    setSection,
    stats,
    view,
    preset,
    fit,
    viewEntries,
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
