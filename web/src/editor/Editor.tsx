import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ContextMenu, ESC, Rail, TooltipLayer, useEscape, type ContextMenuState, type MenuEntry, type RailItem, type RowToggle } from "@bettercad/ui";
import { createStore } from "../state/store";
import {
  addCombine,
  addPart,
  build,
  groupOf,
  groupParams,
  PRIMITIVES,
  changeParts,
  duplicateParts,
  featureParts,
  featureSummary,
  newDoc,
  newId,
  removeFeature,
  removeParts,
  reorderFeature,
  reorderPart,
  setLook,
  updateFeature,
  KIND_LABEL,
  type Feature,
  type ModelDoc,
  type PartKind,
  type Vec3,
} from "../state/document";
import type { ThemeSetting } from "../state/theme";
import { useTheme } from "../state/useTheme";
import { createRegistry, formatCombo, type Command, type CommandContext } from "../state/commands";
import { TOOLS, type ToolId } from "./tools";
import { AppShell } from "./AppShell";
import { TopBar } from "./TopBar";
import { LeftPanel, PANEL_TITLES, type PanelId } from "./LeftPanel";
import { StageBars } from "./Stage";
import { useViewport } from "./useViewport";
import { View3D } from "../viewport/View3D";
import { Properties } from "./Properties";
import { CommandPalette } from "./CommandPalette";
import { ShortcutsDialog } from "./ShortcutsDialog";
import { useStatus } from "./useStatus";
import { useKernel } from "../kernel/useKernel";
import { openFromDisk, saveToDisk } from "./files";
import { Timeline, partIcon } from "./Timeline";
import { useSketch } from "../sketch/useSketch";
import { SketchBars, SketchLabels, SketchPanel, SketchPickBar } from "../sketch/SketchUI";
import { useExtrude } from "../extrude/useExtrude";
import { ExtrudeBar } from "../extrude/ExtrudeUI";
import { CombineBar, type CombineOp } from "./CombineBar";
import { useFinish } from "../finish/useFinish";
import { FinishBar } from "../finish/FinishBar";
import { usePushPull } from "../finish/usePushPull";
import { PushPullBar } from "../finish/PushPullBar";
import { useHole } from "../hole/useHole";
import { HoleBar } from "../hole/HoleBar";

const PANELS: RailItem<PanelId>[] = [
  { id: "parts", icon: "layers", label: "Parts" },
  { id: "sketch", icon: "sketch", label: "Sketch" },
  { id: "bodies", icon: "body", label: "Bodies" },
  { id: "library", icon: "shapes", label: "Library" },
  { id: "history", icon: "history", label: "History" },
  { id: "settings", icon: "settings", label: "Settings" },
];

const THEME_LABEL: Record<ThemeSetting, string> = { system: "Match the system", light: "Light", dark: "Dark", holodeck: "Holodeck" };

const NO_PICK = () => {};
const NARROW = "(max-width: 899px)";
const TIMELINE_KEY = "bettercad.timeline";

function readTimelineShown() {
  try {
    return localStorage.getItem(TIMELINE_KEY) !== "off";
  } catch {
    return true;
  }
}

function useMedia(query: string) {
  const get = () => typeof window !== "undefined" && !!window.matchMedia?.(query).matches;
  const [on, setOn] = useState(get);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const change = () => setOn(mq.matches);
    mq.addEventListener?.("change", change);
    return () => mq.removeEventListener?.("change", change);
  }, [query]);
  return on;
}

/** The editor: composes the shell's slots and owns the document, the selection, the armed tool and the commands. */
export function Editor() {
  const [store] = useState(() => createStore<ModelDoc>(newDoc()));
  const history = useSyncExternalStore(store.subscribe, store.history);
  const doc = history.present;

  // The timeline marker is view state: how many features are built. null means at the end, following new features.
  const [marker, setMarker] = useState<number | null>(null);
  const featureCount = doc.features.length;
  const at = marker === null ? featureCount : Math.min(marker, featureCount);
  const built = useMemo(() => build(doc, at), [doc, at]);
  const parts = built.parts;
  const kernel = useKernel(doc, at, parts);
  const failed = useMemo(() => new Map([...built.failed, ...kernel.failed]), [built.failed, kernel.failed]);
  const [activeFeature, setActiveFeature] = useState<string | null>(null);
  const [featureMenuAt, setFeatureMenuAt] = useState<{ id: string; at: ContextMenuState } | null>(null);
  const [featureRenameId, setFeatureRenameId] = useState<string | null>(null);
  const [timelineShown, setTimelineShownState] = useState(readTimelineShown);
  const setTimelineShown = useCallback((on: boolean) => {
    setTimelineShownState(on);
    try {
      localStorage.setItem(TIMELINE_KEY, on ? "on" : "off");
    } catch {
      // Private windows can refuse storage; the setting then lasts for this visit.
    }
  }, []);

  const narrow = useMedia(NARROW);
  const [selection, setSelection] = useState<string[]>([]);
  const [panel, setPanel] = useState<PanelId | null>(() => (window.matchMedia?.(NARROW).matches ? null : "parts"));
  const [propsOpen, setPropsOpen] = useState(false);
  const [tool, setTool] = useState<ToolId>("select");
  const [combineOp, setCombineOp] = useState<CombineOp>("join");
  const [keepTools, setKeepTools] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [renameId, setRenameId] = useState<string | null>(null);
  const { theme, setTheme, resolved } = useTheme();
  const [status, say] = useStatus();

  // The registry reads the latest state through a ref, so commands are registered once.
  const live = useRef({ doc, parts, marker, at, selection, tool, dialogOpen: false, sketching: false });
  live.current = { doc, parts, marker, at, selection, tool, dialogOpen: paletteOpen || shortcutsOpen, sketching: live.current.sketching };
  const [registry] = useState(() =>
    createRegistry((): CommandContext => ({
      hasSelection: live.current.selection.length > 0,
      inSketch: live.current.sketching,
      toolActive: live.current.tool !== "select",
      canUndo: store.canUndo(),
      canRedo: store.canRedo(),
      dialogOpen: live.current.dialogOpen,
    })),
  );
  // Re-render when commands are added or run, so enabled states stay fresh.
  useSyncExternalStore(registry.subscribe, registry.version);

  // Drop selected ids that no longer exist (after undo, delete, open).
  useEffect(() => {
    setSelection((s) => {
      const kept = s.filter((id) => parts.some((p) => p.id === id));
      return kept.length === s.length ? s : kept;
    });
  }, [parts]);

  // After an undo the marker can sit past the end; it then follows the end again.
  useEffect(() => {
    if (marker !== null && marker >= featureCount) setMarker(null);
  }, [marker, featureCount]);

  /**
   * Records a modelling change. New features go in at the marker when the model is rolled back, and the marker moves
   * past them, the way Fusion inserts into the timeline.
   */
  const record = useCallback(
    (fn: (d: ModelDoc, at: number | undefined) => ModelDoc, label: string, coalesceKey?: string) => {
      const before = store.get().features.length;
      const m = live.current.marker;
      store.edit((d) => fn(d, m ?? undefined), label, coalesceKey);
      const grew = store.get().features.length - before;
      if (grew > 0 && m !== null) setMarker(Math.min(m, before) + grew);
    },
    [store],
  );

  const moveMarker = useCallback(
    (to: number) => {
      const n = store.get().features.length;
      const clamped = Math.max(0, Math.min(n, to));
      setMarker(clamped >= n ? null : clamped);
    },
    [store],
  );

  const vp = useViewport({
    doc,
    parts,
    selection,
    setSelection,
    tool,
    theme: resolved,
    record,
    editDoc: store.edit,
    say,
  });
  live.current.dialogOpen ||= vp.namingOpen;
  useEffect(() => registry.register(vp.commands), [registry, vp.commands]);

  const sketch = useSketch({
    store,
    record,
    doc,
    built: built.sketches,
    view: vp.ref,
    picking: tool === "sketch",
    onStarted: () => setTool("select"),
    say,
    theme: resolved,
  });
  live.current.sketching = sketch.editing;
  useEffect(() => registry.register(sketch.commands), [registry, sketch.commands]);

  const extrude = useExtrude({
    kind: "extrude",
    store,
    record,
    doc,
    sketches: built.sketches,
    parts,
    selection,
    view: vp.ref,
    active: tool === "extrude" && !sketch.editing,
    onClose: () => setTool("select"),
    say,
    theme: resolved,
  });
  useEffect(() => registry.register(extrude.commands), [registry, extrude.commands]);

  const revolve = useExtrude({
    kind: "revolve",
    store,
    record,
    doc,
    sketches: built.sketches,
    parts,
    selection,
    view: vp.ref,
    active: tool === "revolve" && !sketch.editing,
    onClose: () => setTool("select"),
    say,
    theme: resolved,
  });
  useEffect(() => registry.register(revolve.commands), [registry, revolve.commands]);

  const pushpull = usePushPull({
    store,
    record,
    doc,
    parts,
    view: vp.ref,
    active: tool === "pushpull" && !sketch.editing,
    onClose: () => setTool("select"),
    say,
  });

  const hole = useHole({
    store,
    record,
    doc,
    parts,
    view: vp.ref,
    active: tool === "hole" && !sketch.editing,
    onClose: () => setTool("select"),
    say,
  });

  const finish = useFinish({
    record,
    parts,
    view: vp.ref,
    tool: sketch.editing ? null : tool === "fillet" || tool === "shell" ? tool : null,
    onClose: () => setTool("select"),
    say,
  });
  // While sketching the model goes faint, so the sketch reads on top of it. Project needs the faces solid to pick them.
  const ghostParts = sketch.editing && sketch.stool !== "project";
  const viewParts = useMemo(() => parts.map((p) => (ghostParts || p.hole ? { ...p, ghost: true } : p)), [parts, ghostParts]);
  const onCamera = vp.onCamera;
  const sketchCamera = sketch.onCamera;
  const composedCamera = useCallback(
    (c: Parameters<typeof onCamera>[0]) => {
      onCamera(c);
      sketchCamera();
    },
    [onCamera, sketchCamera],
  );

  const showPanel = useCallback((id: PanelId | null) => {
    setPanel(id);
    if (id && window.matchMedia?.(NARROW).matches) setPropsOpen(false);
  }, []);

  const doUndo = useCallback(() => {
    if (!store.canUndo()) return;
    say(`Undid ${store.undoLabel().toLowerCase()}`);
    store.undo();
  }, [store, say]);
  const doRedo = useCallback(() => {
    if (!store.canRedo()) return;
    say(`Redid ${store.redoLabel().toLowerCase()}`);
    store.redo();
  }, [store, say]);

  const add = useCallback(
    (kind: PartKind) => {
      const id = newId();
      record((d, at) => addPart(d, kind, id, at), `Add ${KIND_LABEL[kind].toLowerCase()}`);
      setSelection([id]);
      if (!window.matchMedia?.(NARROW).matches) setPanel("parts");
      say(`Added a ${KIND_LABEL[kind].toLowerCase()}`);
    },
    [record, say],
  );

  const remove = useCallback(
    (ids: string[]) => {
      const gone = live.current.parts.filter((p) => ids.includes(p.id));
      if (!gone.length) return;
      const what = gone.length === 1 ? gone[0]!.name : `${gone.length} parts`;
      record((d, at) => removeParts(d, ids, at), `Delete ${what}`);
      setSelection((s) => s.filter((id) => !ids.includes(id)));
      say(`Deleted ${what}. ${formatCombo("mod+z")} brings it back.`);
    },
    [record, say],
  );

  const duplicate = useCallback(
    (ids: string[]) => {
      if (!ids.length) return;
      const copies = ids.map(() => newId());
      record((d, at) => duplicateParts(d, ids, copies, at), ids.length === 1 ? "Duplicate" : `Duplicate ${ids.length} parts`);
      setSelection(copies);
    },
    [record],
  );

  const toggle = useCallback(
    (ids: string[], what: RowToggle) => {
      const chosen = live.current.parts.filter((p) => ids.includes(p.id));
      if (!chosen.length) return;
      const on = !chosen.every((p) => !!p[what]);
      const verb = { hidden: on ? "Hide" : "Show", ghost: on ? "Ghost" : "Unghost", highlight: on ? "Highlight" : "Clear highlight on" }[what];
      store.edit((d) => setLook(d, ids, () => ({ [what]: on })), `${verb} ${chosen.length === 1 ? chosen[0]!.name : `${chosen.length} parts`}`);
    },
    [store],
  );

  const rename = useCallback(
    (id: string, name: string) => {
      const p = live.current.parts.find((x) => x.id === id);
      const clean = name.trim();
      if (!p || !clean || clean === p.name) return;
      store.edit((d) => setLook(d, [id], () => ({ name: clean })), `Rename ${p.name}`);
    },
    [store],
  );

  /** Group (Tinkercad): the selected solids joined and the holes cut, as one step. */
  const group = useCallback(
    (ids: string[]) => {
      const params = groupParams(live.current.parts, ids);
      if (typeof params === "string") return say(params, true);
      const id = newId("f");
      record((d, at) => addCombine(d, params, id, at), "Group");
      setSelection([params.target]);
      say(`Grouped ${ids.length} bodies. ${formatCombo("shift+mod+g")} ungroups them.`);
    },
    [record, say],
  );

  const ungroup = useCallback(
    (ids: string[]) => {
      const d = store.get();
      const f = ids.map((id) => groupOf(d, id, live.current.at)).find(Boolean);
      if (!f) return say("Select a group to ungroup it", true);
      const i = d.features.indexOf(f);
      store.edit((x) => removeFeature(x, f.id), `Ungroup ${f.name}`);
      const m = live.current.marker;
      if (m !== null && i < m) setMarker(m - 1);
      setSelection([f.target, ...f.tools.map((t) => t.id)]);
      say(`Ungrouped ${f.name}`);
    },
    [store, say],
  );

  /** Combine (Fusion): the first picked body keeps, the others join, cut or intersect it. */
  const combine = useCallback(
    (ids: string[], op: CombineOp, keep: boolean) => {
      const [target, ...tools] = ids;
      if (!target || !tools.length) return say("Select the body to keep, then the bodies to combine with it", true);
      record((d, at) => addCombine(d, { mode: "combine", target, tools: tools.map((t) => ({ id: t, op })), keepTools: keep }, newId("f"), at), "Combine");
      setSelection([target]);
      setTool("select");
      say(`Combined ${tools.length === 1 ? "1 body" : `${tools.length} bodies`}`);
    },
    [record, say],
  );

  const toggleHole = useCallback(
    (ids: string[]) => {
      const chosen = live.current.parts.filter((p) => ids.includes(p.id));
      if (!chosen.length) return;
      const on = !chosen.every((p) => p.hole);
      store.edit((d) => setLook(d, ids, () => ({ hole: on })), on ? "Make a hole" : "Make solid");
      say(on ? `${chosen.length === 1 ? chosen[0]!.name : `${chosen.length} parts`} will cut when grouped` : "Made solid");
    },
    [store, say],
  );

  const armTool = useCallback((id: ToolId) => setTool((t) => (t === id && id !== "select" ? "select" : id)), []);

  const save = useCallback(() => {
    const d = store.get();
    saveToDisk(d);
    say(`Saved ${d.name} to your downloads`);
  }, [store, say]);
  const open = useCallback(async () => {
    try {
      const d = await openFromDisk();
      if (!d) return;
      store.edit(() => d, `Open ${d.name}`);
      setMarker(null);
      setSelection([]);
      say(`Opened ${d.name}`);
    } catch (e) {
      say((e as Error).message, true);
    }
  }, [store, say]);
  const newModel = useCallback(() => {
    store.edit(() => newDoc(), "New model");
    setMarker(null);
    setSelection([]);
  }, [store]);

  // ---- timeline
  const selectFeature = useCallback((f: Feature) => {
    setActiveFeature(f.id);
    const here = new Set(live.current.parts.map((p) => p.id));
    setSelection(featureParts(f).filter((id) => here.has(id)));
  }, []);
  const renameFeature = useCallback(
    (id: string, name: string) => {
      const f = store.get().features.find((x) => x.id === id);
      const clean = name.trim();
      if (!f || !clean || clean === f.name) return;
      store.edit((d) => updateFeature(d, id, { name: clean }), `Rename ${f.name}`);
    },
    [store],
  );
  const suppressFeature = useCallback(
    (id: string) => {
      const f = store.get().features.find((x) => x.id === id);
      if (!f) return;
      store.edit((d) => updateFeature(d, id, { suppressed: !f.suppressed }), `${f.suppressed ? "Unsuppress" : "Suppress"} ${f.name}`);
      say(f.suppressed ? `${f.name} is built again` : `${f.name} is suppressed: it stays on the timeline but is not built`);
    },
    [store, say],
  );
  const deleteFeature = useCallback(
    (id: string) => {
      const i = store.get().features.findIndex((x) => x.id === id);
      const f = store.get().features[i];
      if (!f) return;
      store.edit((d) => removeFeature(d, id), `Delete ${f.name}`);
      const m = live.current.marker;
      if (m !== null && i < m) setMarker(m - 1);
      say(`Deleted ${f.name}. ${formatCombo("mod+z")} brings it back.`);
    },
    [store, say],
  );
  const moveFeature = useCallback(
    (id: string, beforeId: string | null) => {
      const f = store.get().features.find((x) => x.id === id);
      if (f) store.edit((d) => reorderFeature(d, id, beforeId), `Move ${f.name} on the timeline`);
    },
    [store],
  );

  // Esc backs out one layer at a time: the narrow sheets, then the tool, then the selection. Menus and dialogs sit above.
  useEscape(tool !== "select", () => setTool("select"), ESC.tool);
  useEscape(narrow && (panel !== null || propsOpen), () => (propsOpen ? setPropsOpen(false) : setPanel(null)), ESC.panel);
  useEscape(
    selection.length > 0 || vp.elements.length > 0,
    () => {
      setSelection([]);
      vp.clearElements();
    },
    ESC.selection,
  );

  const handlers = useRef({
    newModel,
    open,
    save,
    doUndo,
    doRedo,
    duplicate,
    toggle,
    remove,
    armTool,
    add,
    showPanel,
    setTheme,
    say,
    moveMarker,
    setTimelineShown,
    timelineShown,
    group,
    ungroup,
    toggleHole,
    confirm: () => {},
  });
  handlers.current = {
    newModel,
    open,
    save,
    doUndo,
    doRedo,
    duplicate,
    toggle,
    remove,
    armTool,
    add,
    showPanel,
    setTheme,
    say,
    moveMarker,
    setTimelineShown,
    timelineShown,
    group,
    ungroup,
    toggleHole,
    confirm: () =>
      extrude.session
        ? extrude.done()
        : revolve.session
          ? revolve.done()
          : pushpull.session
            ? pushpull.done()
            : hole.session
              ? hole.done()
              : tool === "combine"
                ? combine(selection, combineOp, keepTools)
                : finish.tool
                  ? finish.done()
                  : undefined,
  };

  useEffect(() => {
    const h = () => handlers.current;
    const sel = () => live.current.selection;
    const hasSel = (c: CommandContext) => c.hasSelection;
    const list: Command[] = [
      { id: "file.new", label: "New model", group: "File", icon: "plus", run: () => h().newModel() },
      { id: "file.open", label: "Open from disk…", group: "File", icon: "folder", keys: ["mod+o"], run: () => void h().open() },
      { id: "file.save", label: "Save to disk", group: "File", icon: "save", keys: ["mod+s"], run: () => h().save(), keywords: "download export" },
      { id: "edit.undo", label: "Undo", group: "Edit", icon: "undo", keys: ["mod+z"], run: () => h().doUndo(), when: (c) => c.canUndo },
      { id: "edit.redo", label: "Redo", group: "Edit", icon: "redo", keys: ["shift+mod+z", "mod+y"], run: () => h().doRedo(), when: (c) => c.canRedo },
      {
        id: "edit.selectAll",
        scope: "model",
        label: "Select all parts",
        group: "Edit",
        icon: "arrow",
        keys: ["mod+a"],
        run: () => setSelection(live.current.parts.map((p) => p.id)),
        when: () => live.current.parts.length > 0,
      },
      {
        id: "edit.rename",
        scope: "model",
        label: "Rename part",
        group: "Edit",
        icon: "pencil",
        keys: ["f2"],
        run: () => {
          h().showPanel("parts");
          setRenameId(sel()[0] ?? null);
        },
        when: (c) => c.hasSelection && sel().length === 1,
      },
      { id: "edit.duplicate", scope: "model", label: "Duplicate", group: "Edit", icon: "copy", keys: ["mod+d"], run: () => h().duplicate(sel()), when: hasSel },
      {
        id: "edit.hide",
        scope: "model",
        label: "Hide or show",
        group: "Edit",
        icon: "eye",
        keys: ["shift+h"],
        run: () => h().toggle(sel(), "hidden"),
        when: hasSel,
      },
      {
        id: "edit.delete",
        scope: "model",
        label: "Delete",
        group: "Edit",
        icon: "trash",
        keys: ["delete", "backspace"],
        run: () => h().remove(sel()),
        when: hasSel,
      },
      ...TOOLS.map<Command>((t) => ({
        id: `tool.${t.id}`,
        scope: "model",
        label: t.label,
        group: "Tools",
        icon: t.icon,
        keys: t.key ? [t.key] : undefined,
        run: () => h().armTool(t.id),
        keywords: t.title,
      })),
      {
        id: "edit.group",
        scope: "model",
        label: "Group",
        group: "Edit",
        icon: "combine",
        keys: ["mod+g"],
        run: () => h().group(sel()),
        when: () => sel().length > 1,
        keywords: "join holes combine union",
      },
      {
        id: "edit.ungroup",
        scope: "model",
        label: "Ungroup",
        group: "Edit",
        icon: "unlink",
        keys: ["shift+mod+g"],
        run: () => h().ungroup(sel()),
        when: hasSel,
      },
      {
        id: "edit.hole",
        scope: "model",
        label: "Hole or solid",
        group: "Edit",
        icon: "hole",
        run: () => h().toggleHole(sel()),
        when: hasSel,
        keywords: "cut subtract tinkercad",
      },
      {
        id: "tool.confirm",
        scope: "model",
        label: "Finish the tool",
        group: "Tools",
        icon: "check",
        keys: ["enter"],
        run: () => h().confirm(),
        when: () => ["extrude", "revolve", "pushpull", "hole", "combine", "fillet", "shell"].includes(live.current.tool),
      },
      ...([...PRIMITIVES] as PartKind[]).map<Command>((k) => ({
        id: `add.${k}`,
        label: `Add a ${KIND_LABEL[k].toLowerCase()}`,
        group: "Tools",
        icon: partIcon(k),
        run: () => h().add(k),
        keywords: "part primitive shape",
      })),
      {
        id: "timeline.start",
        label: "Roll back to the start",
        group: "Timeline",
        icon: "skipStart",
        keys: ["alt+home"],
        run: () => h().moveMarker(0),
        when: () => live.current.at > 0,
      },
      {
        id: "timeline.back",
        label: "Step back on the timeline",
        group: "Timeline",
        icon: "stepBack",
        keys: ["alt+arrowleft"],
        run: () => h().moveMarker(live.current.at - 1),
        when: () => live.current.at > 0,
        keywords: "roll back history",
      },
      {
        id: "timeline.forward",
        label: "Step forward on the timeline",
        group: "Timeline",
        icon: "stepForward",
        keys: ["alt+arrowright"],
        run: () => h().moveMarker(live.current.at + 1),
        when: () => live.current.at < live.current.doc.features.length,
      },
      {
        id: "timeline.end",
        label: "Go to the end of the timeline",
        group: "Timeline",
        icon: "skipEnd",
        keys: ["alt+end"],
        run: () => h().moveMarker(Infinity),
        when: () => live.current.at < live.current.doc.features.length,
      },
      {
        id: "timeline.toggle",
        label: "Show or hide the timeline",
        group: "View",
        icon: "history",
        run: () => h().setTimelineShown(!h().timelineShown),
        keywords: "steps features history",
      },
      ...PANELS.map<Command>((p) => ({ id: `panel.${p.id}`, label: `Show ${p.label}`, group: "Panels", icon: p.icon, run: () => h().showPanel(p.id) })),
      ...(Object.keys(THEME_LABEL) as ThemeSetting[]).map<Command>((t) => ({
        id: `theme.${t}`,
        label: `Theme: ${THEME_LABEL[t]}`,
        group: "Theme",
        icon: t === "light" ? "sun" : t === "system" ? "settings" : "moon",
        run: () => h().setTheme(t),
      })),
      { id: "help.palette", label: "Find a command", group: "Help", icon: "search", keys: ["mod+k"], run: () => setPaletteOpen(true) },
      { id: "help.shortcuts", label: "Keyboard shortcuts", group: "Help", icon: "keyboard", keys: ["?"], run: () => setShortcutsOpen(true) },
    ];
    if (import.meta.env.DEV || import.meta.env.VITE_GALLERY) {
      list.push({ id: "help.gallery", label: "Component gallery", group: "Help", icon: "template", run: () => (window.location.hash = "#/gallery") });
    }
    return registry.register(list);
  }, [registry]);

  // One keyboard handler for the whole editor. Escape goes through the layered stack instead.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.key === "Escape" || live.current.dialogOpen) return;
      registry.dispatch(e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [registry]);

  const commands = registry.list();
  const isEnabled = useCallback((id: string) => registry.enabled(id), [registry]);
  const activeTool = TOOLS.find((t) => t.id === tool)!;
  const selectedParts = useMemo(() => parts.filter((p) => selection.includes(p.id)), [parts, selection]);

  // The active tile: the one last clicked while its parts stay selected, else the last built step that touches them.
  const activeFeatureId = useMemo(() => {
    if (!selection.length) return null;
    const touches = (f: Feature) => featureParts(f).some((id) => selection.includes(id));
    const clicked = doc.features.find((f) => f.id === activeFeature);
    if (clicked && touches(clicked)) return clicked.id;
    return [...doc.features.slice(0, at)].reverse().find(touches)?.id ?? null;
  }, [selection, activeFeature, doc.features, at]);

  const summary = useCallback((f: Feature) => featureSummary(doc, f), [doc]);
  const volumes = useMemo(() => new Map([...kernel.bodies].map(([id, b]) => [id, b.measure.volume])), [kernel.bodies]);

  const featureMenu = (id: string): MenuEntry[] => {
    const i = doc.features.findIndex((f) => f.id === id);
    const f = doc.features[i];
    if (!f) return [];
    return [
      ...(f.type === "sketch" ? [{ id: "edit", label: "Edit sketch", icon: "sketch" as const, onSelect: () => sketch.edit(id) }] : []),
      ...(f.type === "extrude"
        ? [
            {
              id: "edit",
              label: "Edit extrude",
              icon: "extrude" as const,
              disabled: i >= at,
              onSelect: () => {
                setTool("extrude");
                extrude.edit(id);
              },
            },
          ]
        : []),
      ...(f.type === "hole"
        ? [
            {
              id: "edit",
              label: "Edit hole",
              icon: "hole" as const,
              disabled: i >= at,
              onSelect: () => {
                setTool("hole");
                hole.edit(id);
              },
            },
          ]
        : []),
      ...(f.type === "revolve"
        ? [
            {
              id: "edit",
              label: "Edit revolve",
              icon: "revolve" as const,
              disabled: i >= at,
              onSelect: () => {
                setTool("revolve");
                revolve.edit(id);
              },
            },
          ]
        : []),
      { id: "roll", label: "Roll to here", icon: "history", disabled: i + 1 === at, onSelect: () => moveMarker(i + 1) },
      {
        id: "rename",
        label: "Rename",
        icon: "pencil",
        onSelect: () => {
          showPanel("history");
          setFeatureRenameId(id);
        },
      },
      { id: "suppress", label: f.suppressed ? "Unsuppress" : "Suppress", icon: f.suppressed ? "eye" : "eyeOff", onSelect: () => suppressFeature(id) },
      { kind: "separator", id: "s1" },
      { id: "delete", label: "Delete", icon: "trash", danger: true, onSelect: () => deleteFeature(id) },
    ];
  };

  const partMenu = (ids: string[]): MenuEntry[] => {
    const chosen = parts.filter((p) => ids.includes(p.id));
    const allHidden = chosen.length > 0 && chosen.every((p) => p.hidden);
    return [
      { id: "rename", label: "Rename", icon: "pencil", keys: "F2", disabled: ids.length !== 1, onSelect: () => setRenameId(ids[0] ?? null) },
      { id: "duplicate", label: "Duplicate", icon: "copy", keys: formatCombo("mod+d"), onSelect: () => duplicate(ids) },
      ...(ids.length > 1
        ? [
            { id: "group", label: "Group", icon: "combine" as const, keys: formatCombo("mod+g"), onSelect: () => group(ids) },
            {
              id: "combine",
              label: "Combine…",
              icon: "combine" as const,
              onSelect: () => {
                setSelection(ids);
                setTool("combine");
              },
            },
          ]
        : []),
      ...(ids.some((id) => groupOf(doc, id, at))
        ? [{ id: "ungroup", label: "Ungroup", icon: "unlink" as const, keys: formatCombo("shift+mod+g"), onSelect: () => ungroup(ids) }]
        : []),
      {
        id: "hole",
        label: chosen.length && chosen.every((p) => p.hole) ? "Make solid" : "Make a hole",
        icon: "hole",
        onSelect: () => toggleHole(ids),
      },
      {
        id: "hide",
        label: allHidden ? "Show" : "Hide",
        icon: allHidden ? "eye" : "eyeOff",
        keys: formatCombo("shift+h"),
        onSelect: () => toggle(ids, "hidden"),
      },
      { kind: "separator", id: "s1" },
      { id: "delete", label: "Delete", icon: "trash", keys: "Del", danger: true, onSelect: () => remove(ids) },
    ];
  };

  const saveEntries: MenuEntry[] = [
    { id: "save", label: "Save to disk", icon: "save", keys: formatCombo("mod+s"), onSelect: save },
    { id: "open", label: "Open from disk…", icon: "folder", keys: formatCombo("mod+o"), onSelect: () => void open() },
    { id: "new", label: "New model", icon: "plus", onSelect: newModel },
    { kind: "separator", id: "s1" },
    { id: "cloud", label: "Save to your account (coming with accounts)", icon: "user", disabled: true, onSelect: () => {} },
  ];

  const selectionText =
    selectedParts.length === 0
      ? "Nothing selected."
      : selectedParts.length === 1
        ? `${selectedParts[0]!.name} selected.`
        : `${selectedParts.length} parts selected.`;
  const helpText = sketch.help
    ? sketch.help
    : extrude.help || revolve.help || pushpull.help || hole.help
      ? extrude.help || revolve.help || pushpull.help || hole.help
      : finish.help
        ? finish.help
        : vp.elementText
          ? `${vp.elementText} Esc clears it.`
          : tool === "select" && selectedParts.length
            ? `${selectionText} Esc clears the selection.`
            : activeTool.help;

  const onPropChange = (key: "position" | "size" | "rotation", axis: keyof Vec3, value: number) => {
    const ids = selection;
    const verb = key === "size" ? "Resize" : key === "rotation" ? "Turn" : "Move";
    record(
      (d, at) => changeParts(d, ids, key, { [axis]: value }, at),
      `${verb} ${selectedParts.length === 1 ? selectedParts[0]!.name : `${ids.length} parts`}`,
      `props:${ids.join(",")}:${key}.${axis}`,
    );
  };

  return (
    <>
      <AppShell
        topBar={
          <TopBar
            name={doc.name}
            onRename={(name) => store.edit((d) => ({ ...d, name }), "Rename model", "doc-name")}
            onRenameDone={store.seal}
            canUndo={store.canUndo()}
            canRedo={store.canRedo()}
            undoLabel={store.undoLabel()}
            redoLabel={store.redoLabel()}
            onUndo={doUndo}
            onRedo={doRedo}
            status={status}
            saveEntries={saveEntries}
            onPalette={() => setPaletteOpen(true)}
            theme={theme}
            onTheme={setTheme}
            onProps={() => {
              setPropsOpen((o) => !o);
              if (narrow) setPanel(null);
            }}
            propsOpen={propsOpen}
          />
        }
        rail={<Rail items={PANELS} value={panel} onChange={showPanel} controls="bc-left-panel" />}
        leftLabel={panel ? PANEL_TITLES[panel] : undefined}
        leftPanel={
          panel && (
            <LeftPanel
              panel={panel}
              doc={doc}
              parts={parts}
              selection={selection}
              onSelect={setSelection}
              onAdd={add}
              onToggle={(id, what) => toggle(selection.includes(id) ? selection : [id], what)}
              onRename={rename}
              onReorder={(id, before) => store.edit((d) => reorderPart(d, id, before), "Reorder parts")}
              partMenu={partMenu}
              renameId={renameId}
              onRenameIdChange={setRenameId}
              features={doc.features}
              at={at}
              failed={failed}
              summary={summary}
              activeFeatureId={activeFeatureId}
              onSelectFeature={selectFeature}
              onRenameFeature={renameFeature}
              onReorderFeature={moveFeature}
              featureMenu={featureMenu}
              featureRenameId={featureRenameId}
              onFeatureRenameIdChange={setFeatureRenameId}
              timelineShown={timelineShown}
              onTimelineShown={setTimelineShown}
              theme={theme}
              onTheme={setTheme}
              commands={commands}
              onArmTool={armTool}
              tool={tool}
            />
          )
        }
        stageToolbar={
          sketch.editing ? (
            <SketchBars s={sketch} />
          ) : (
            <>
              <StageBars tool={activeTool} onArmTool={armTool} vp={vp} onePart={selection.length === 1} />
              {tool === "sketch" && <SketchPickBar onCancel={() => setTool("select")} />}
              {tool === "extrude" && <ExtrudeBar x={extrude} parts={parts} error={extrude.feature ? failed.get(extrude.feature.id) : undefined} />}
              {tool === "revolve" && <ExtrudeBar x={revolve} parts={parts} error={revolve.feature ? failed.get(revolve.feature.id) : undefined} />}
              {tool === "hole" && <HoleBar x={hole} error={hole.session ? failed.get(hole.session.id) : undefined} onCancel={() => setTool("select")} />}
              {tool === "pushpull" && (
                <PushPullBar x={pushpull} error={pushpull.session ? failed.get(pushpull.session.id) : undefined} onCancel={() => setTool("select")} />
              )}
              {(tool === "fillet" || tool === "shell") && <FinishBar f={finish} onCancel={() => setTool("select")} />}
              {tool === "combine" && (
                <CombineBar
                  picked={selection.map((id) => parts.find((p) => p.id === id)).filter((p): p is (typeof parts)[number] => !!p)}
                  op={combineOp}
                  onOp={setCombineOp}
                  keepTools={keepTools}
                  onKeepTools={setKeepTools}
                  onApply={() => combine(selection, combineOp, keepTools)}
                  onCancel={() => setTool("select")}
                />
              )}
            </>
          )
        }
        stage={
          <View3D
            ref={vp.ref}
            parts={viewParts}
            meshes={kernel.bodies}
            engine={kernel.state}
            picks={finish.tool ? finish.picks : vp.picks}
            filter={vp.filter}
            mode={vp.mode}
            style={vp.style}
            ortho={vp.ortho}
            section={vp.section}
            stats={vp.stats}
            description={`${parts.length} parts. ${vp.elementText || selectionText}`}
            onPick={sketch.editing ? NO_PICK : vp.onPick}
            onTransform={vp.onTransform}
            onTransforming={vp.onTransforming}
            onSection={vp.onSection}
            onCamera={composedCamera}
            emptyHint={!sketch.editing && tool !== "sketch" && built.sketches.length === 0}
          >
            <SketchLabels s={sketch} />
          </View3D>
        }
        timeline={
          timelineShown && (
            <Timeline
              features={doc.features}
              at={at}
              onMarker={moveMarker}
              failed={failed}
              activeId={activeFeatureId}
              summary={summary}
              onSelect={selectFeature}
              onMenu={(f, p) => setFeatureMenuAt({ id: f.id, at: p })}
            />
          )
        }
        helpLine={helpText}
        rightPanel={
          sketch.editing ? (
            <SketchPanel s={sketch} />
          ) : (
            <Properties
              parts={selectedParts}
              totalParts={parts.length}
              onChange={onPropChange}
              onCommit={store.seal}
              volumes={volumes}
              onHole={() => toggleHole(selection)}
            />
          )
        }
        rightOpen={propsOpen}
      />
      <span className="bc-sr-only" role="status" aria-live="polite">
        {selectionText} {tool === "select" ? "" : `${activeTool.label} tool armed.`}
      </span>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} commands={commands} isEnabled={isEnabled} run={(id) => registry.run(id)} />
      <ContextMenu
        at={featureMenuAt?.at ?? null}
        onClose={() => setFeatureMenuAt(null)}
        label="Step actions"
        title={doc.features.find((f) => f.id === featureMenuAt?.id)?.name}
        entries={featureMenuAt ? featureMenu(featureMenuAt.id) : []}
      />
      {vp.namingDialog}
      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} commands={commands} />
      <TooltipLayer />
    </>
  );
}
