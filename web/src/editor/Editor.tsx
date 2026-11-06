import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ESC, Rail, TooltipLayer, useEscape, type MenuEntry, type RailItem, type RowToggle } from "@bettercad/ui";
import { createStore } from "../state/store";
import {
  addPart,
  duplicatePart,
  newDoc,
  newId,
  removeParts,
  reorderPart,
  updatePart,
  updateParts,
  KIND_LABEL,
  type ModelDoc,
  type PartKind,
  type Vec3,
} from "../state/document";
import type { ThemeSetting } from "../state/theme";
import { useTheme } from "../state/useTheme";
import { createRegistry, formatCombo, type Command, type CommandContext } from "../state/commands";
import { TOOLS, VIEWS, type ToolId, type ViewId } from "./tools";
import { AppShell } from "./AppShell";
import { TopBar } from "./TopBar";
import { LeftPanel, PANEL_TITLES, type PanelId } from "./LeftPanel";
import { StageBars, Viewport } from "./Stage";
import { Properties } from "./Properties";
import { CommandPalette } from "./CommandPalette";
import { ShortcutsDialog } from "./ShortcutsDialog";
import { useStatus } from "./useStatus";
import { openFromDisk, saveToDisk } from "./files";

const PANELS: RailItem<PanelId>[] = [
  { id: "parts", icon: "layers", label: "Parts" },
  { id: "sketch", icon: "sketch", label: "Sketch" },
  { id: "bodies", icon: "body", label: "Bodies" },
  { id: "library", icon: "shapes", label: "Library" },
  { id: "history", icon: "history", label: "History" },
  { id: "settings", icon: "settings", label: "Settings" },
];

const THEME_LABEL: Record<ThemeSetting, string> = { system: "Match the system", light: "Light", dark: "Dark", holodeck: "Holodeck" };

const NARROW = "(max-width: 899px)";

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

  const narrow = useMedia(NARROW);
  const [selection, setSelection] = useState<string[]>([]);
  const [panel, setPanel] = useState<PanelId | null>(() => (window.matchMedia?.(NARROW).matches ? null : "parts"));
  const [propsOpen, setPropsOpen] = useState(false);
  const [tool, setTool] = useState<ToolId>("select");
  const [view, setView] = useState<ViewId>("iso");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [renameId, setRenameId] = useState<string | null>(null);
  const { theme, setTheme } = useTheme();
  const [status, say] = useStatus();

  // The registry reads the latest state through a ref, so commands are registered once.
  const live = useRef({ doc, selection, tool, dialogOpen: false });
  live.current = { doc, selection, tool, dialogOpen: paletteOpen || shortcutsOpen };
  const [registry] = useState(() =>
    createRegistry((): CommandContext => ({
      hasSelection: live.current.selection.length > 0,
      inSketch: live.current.tool === "sketch",
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
      const kept = s.filter((id) => doc.parts.some((p) => p.id === id));
      return kept.length === s.length ? s : kept;
    });
  }, [doc.parts]);

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
      store.edit((d) => addPart(d, kind, id), `Add ${KIND_LABEL[kind].toLowerCase()}`);
      setSelection([id]);
      if (!window.matchMedia?.(NARROW).matches) setPanel("parts");
      say(`Added a ${KIND_LABEL[kind].toLowerCase()}`);
    },
    [store, say],
  );

  const remove = useCallback(
    (ids: string[]) => {
      const gone = store.get().parts.filter((p) => ids.includes(p.id));
      if (!gone.length) return;
      const what = gone.length === 1 ? gone[0]!.name : `${gone.length} parts`;
      store.edit((d) => removeParts(d, ids), `Delete ${what}`);
      setSelection((s) => s.filter((id) => !ids.includes(id)));
      say(`Deleted ${what}. ${formatCombo("mod+z")} brings it back.`);
    },
    [store, say],
  );

  const duplicate = useCallback(
    (ids: string[]) => {
      if (!ids.length) return;
      const copies: string[] = [];
      store.edit(
        (d) =>
          ids.reduce((acc, id) => {
            const copy = newId();
            copies.push(copy);
            return duplicatePart(acc, id, copy);
          }, d),
        ids.length === 1 ? "Duplicate" : `Duplicate ${ids.length} parts`,
      );
      setSelection(copies);
    },
    [store],
  );

  const toggle = useCallback(
    (ids: string[], what: RowToggle) => {
      const parts = store.get().parts.filter((p) => ids.includes(p.id));
      if (!parts.length) return;
      const on = !parts.every((p) => !!p[what]);
      const verb = { hidden: on ? "Hide" : "Show", ghost: on ? "Ghost" : "Unghost", highlight: on ? "Highlight" : "Clear highlight on" }[what];
      store.edit((d) => updateParts(d, ids, () => ({ [what]: on })), `${verb} ${parts.length === 1 ? parts[0]!.name : `${parts.length} parts`}`);
    },
    [store],
  );

  const rename = useCallback(
    (id: string, name: string) => {
      const p = store.get().parts.find((x) => x.id === id);
      const clean = name.trim();
      if (!p || !clean || clean === p.name) return;
      store.edit((d) => updatePart(d, id, { name: clean }), `Rename ${p.name}`);
    },
    [store],
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
      setSelection([]);
      say(`Opened ${d.name}`);
    } catch (e) {
      say((e as Error).message, true);
    }
  }, [store, say]);
  const newModel = useCallback(() => {
    store.edit(() => newDoc(), "New model");
    setSelection([]);
  }, [store]);

  // Esc backs out one layer at a time: the narrow sheets, then the tool, then the selection. Menus and dialogs sit above.
  useEscape(tool !== "select", () => setTool("select"), ESC.tool);
  useEscape(narrow && (panel !== null || propsOpen), () => (propsOpen ? setPropsOpen(false) : setPanel(null)), ESC.panel);
  useEscape(selection.length > 0, () => setSelection([]), ESC.selection);

  const handlers = useRef({ newModel, open, save, doUndo, doRedo, duplicate, toggle, remove, armTool, add, showPanel, setTheme, say });
  handlers.current = { newModel, open, save, doUndo, doRedo, duplicate, toggle, remove, armTool, add, showPanel, setTheme, say };

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
        label: "Select all parts",
        group: "Edit",
        icon: "arrow",
        keys: ["mod+a"],
        run: () => setSelection(live.current.doc.parts.map((p) => p.id)),
        when: () => live.current.doc.parts.length > 0,
      },
      {
        id: "edit.rename",
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
      { id: "edit.duplicate", label: "Duplicate", group: "Edit", icon: "copy", keys: ["mod+d"], run: () => h().duplicate(sel()), when: hasSel },
      { id: "edit.hide", label: "Hide or show", group: "Edit", icon: "eye", keys: ["shift+h"], run: () => h().toggle(sel(), "hidden"), when: hasSel },
      { id: "edit.delete", label: "Delete", group: "Edit", icon: "trash", keys: ["delete", "backspace"], run: () => h().remove(sel()), when: hasSel },
      ...TOOLS.map<Command>((t) => ({
        id: `tool.${t.id}`,
        label: t.label,
        group: "Tools",
        icon: t.icon,
        keys: [t.key],
        run: () => h().armTool(t.id),
        keywords: t.title,
      })),
      ...(["box", "cylinder", "sphere"] as PartKind[]).map<Command>((k) => ({
        id: `add.${k}`,
        label: `Add a ${KIND_LABEL[k].toLowerCase()}`,
        group: "Tools",
        icon: k === "box" ? "cube" : k,
        run: () => h().add(k),
        keywords: "part primitive shape",
      })),
      ...VIEWS.map<Command>((v) => ({ id: `view.${v.id}`, label: `${v.label} view`, group: "View", icon: "camera", keys: [v.key], run: () => setView(v.id) })),
      { id: "view.fit", label: "Fit the parts in the view", group: "View", icon: "frame", keys: ["f"], run: () => h().say("Fit arrives with the 3D view") },
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
  const selectedParts = useMemo(() => doc.parts.filter((p) => selection.includes(p.id)), [doc.parts, selection]);

  const partMenu = (ids: string[]): MenuEntry[] => {
    const parts = doc.parts.filter((p) => ids.includes(p.id));
    const allHidden = parts.length > 0 && parts.every((p) => p.hidden);
    return [
      { id: "rename", label: "Rename", icon: "pencil", keys: "F2", disabled: ids.length !== 1, onSelect: () => setRenameId(ids[0] ?? null) },
      { id: "duplicate", label: "Duplicate", icon: "copy", keys: formatCombo("mod+d"), onSelect: () => duplicate(ids) },
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
  const helpText = tool === "select" && selectedParts.length ? `${selectionText} Esc clears the selection.` : activeTool.help;

  const onPropChange = (key: "position" | "size", axis: keyof Vec3, value: number) => {
    const ids = selection;
    store.edit(
      (d) => updateParts(d, ids, (p) => ({ [key]: { ...p[key], [axis]: value } })),
      `Change ${key === "size" ? "size" : "position"}`,
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
              selection={selection}
              onSelect={setSelection}
              onAdd={add}
              onToggle={(id, what) => toggle(selection.includes(id) ? selection : [id], what)}
              onRename={rename}
              onReorder={(id, before) => store.edit((d) => reorderPart(d, id, before), "Reorder parts")}
              partMenu={partMenu}
              renameId={renameId}
              onRenameIdChange={setRenameId}
              history={history}
              theme={theme}
              onTheme={setTheme}
              commands={commands}
              onArmTool={armTool}
              tool={tool}
            />
          )
        }
        stageToolbar={<StageBars tool={activeTool} onArmTool={armTool} view={view} onView={setView} onFit={() => say("Fit arrives with the 3D view")} />}
        stage={<Viewport view={view} onView={setView} description={`${doc.parts.length} parts. ${selectionText}`} />}
        helpLine={helpText}
        rightPanel={<Properties parts={selectedParts} totalParts={doc.parts.length} onChange={onPropChange} onCommit={store.seal} />}
        rightOpen={propsOpen}
      />
      <span className="bc-sr-only" role="status" aria-live="polite">
        {selectionText} {tool === "select" ? "" : `${activeTool.label} tool armed.`}
      </span>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} commands={commands} isEnabled={isEnabled} run={(id) => registry.run(id)} />
      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} commands={commands} />
      <TooltipLayer />
    </>
  );
}
