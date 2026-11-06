import { useCallback, useEffect, useMemo, useState } from "react";
import { Rail, type RailItem } from "@bettercad/ui";
import { createHistory, push, undo, redo, seal, canUndo, canRedo, type History } from "../state/history";
import { addPart, duplicatePart, newDoc, newId, removePart, updatePart, KIND_LABEL, type ModelDoc, type Part, type PartKind } from "../state/document";
import { applyTheme, loadThemeSetting, resolveTheme, saveThemeSetting, systemPrefersDark, type ThemeSetting } from "../state/theme";
import { match, type Command } from "../state/commands";
import { TOOLS, VIEWS, type ToolId, type ViewId } from "./tools";
import { TopBar } from "./TopBar";
import { LeftPanel, type PanelId } from "./LeftPanel";
import { Stage } from "./Stage";
import { PropsPanel } from "./PropsPanel";
import { CommandPalette } from "./CommandPalette";
import { ShortcutsDialog } from "./ShortcutsDialog";
import { RenameDialog } from "./RenameDialog";
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

export function Editor() {
  const [history, setHistory] = useState<History<ModelDoc>>(() => createHistory(newDoc()));
  const doc = history.present;
  const [selected, setSelected] = useState<string | null>(null);
  const [panel, setPanel] = useState<PanelId>("parts");
  const [tool, setTool] = useState<ToolId>("select");
  const [view, setView] = useState<ViewId>("iso");
  const [themeSetting, setThemeSetting] = useState<ThemeSetting>(loadThemeSetting);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [renaming, setRenaming] = useState<Part | null>(null);
  const [status, say] = useStatus();

  // Theme: apply, save, and follow the system while set to "system".
  useEffect(() => {
    applyTheme(resolveTheme(themeSetting));
    saveThemeSetting(themeSetting);
    if (themeSetting !== "system") return;
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    const on = () => applyTheme(resolveTheme("system", systemPrefersDark()));
    mq?.addEventListener?.("change", on);
    return () => mq?.removeEventListener?.("change", on);
  }, [themeSetting]);

  const edit = useCallback((fn: (d: ModelDoc) => ModelDoc, label: string, coalesceKey?: string) => {
    setHistory((h) => push(h, fn(h.present), label, coalesceKey));
  }, []);
  const sealHistory = useCallback(() => setHistory((h) => seal(h)), []);

  const doUndo = useCallback(() => {
    if (!canUndo(history)) return;
    say(`Undid ${history.label.toLowerCase()}`);
    setHistory(undo);
  }, [history, say]);
  const doRedo = useCallback(() => {
    if (!canRedo(history)) return;
    say(`Redid ${history.future[0]!.label.toLowerCase()}`);
    setHistory(redo);
  }, [history, say]);

  const selectedPart = doc.parts.find((p) => p.id === selected) ?? null;

  const add = useCallback((kind: PartKind) => {
    const id = newId();
    setHistory((h) => push(h, addPart(h.present, kind, id), `Add ${KIND_LABEL[kind].toLowerCase()}`));
    setSelected(id);
    setPanel("parts");
  }, []);
  const remove = useCallback(
    (id: string) => {
      const p = doc.parts.find((x) => x.id === id);
      if (!p) return;
      edit((d) => removePart(d, id), `Delete ${p.name}`);
      setSelected((s) => (s === id ? null : s));
      say(`Deleted ${p.name}. Ctrl+Z brings it back.`);
    },
    [doc.parts, edit, say],
  );
  const duplicate = useCallback((id: string) => {
    const copyId = newId();
    setHistory((h) => push(h, duplicatePart(h.present, id, copyId), "Duplicate"));
    setSelected(copyId);
  }, []);
  const toggleHidden = useCallback(
    (id: string) => {
      const p = doc.parts.find((x) => x.id === id);
      if (p) edit((d) => updatePart(d, id, { hidden: !p.hidden }), p.hidden ? `Show ${p.name}` : `Hide ${p.name}`);
    },
    [doc.parts, edit],
  );

  const armTool = useCallback((id: ToolId) => {
    setTool((t) => (t === id && id !== "select" ? "select" : id));
  }, []);

  const save = useCallback(() => {
    saveToDisk(doc);
    say(`Saved ${doc.name} to your downloads`);
  }, [doc, say]);
  const open = useCallback(async () => {
    try {
      const d = await openFromDisk();
      if (!d) return;
      setHistory((h) => push(h, d, `Open ${d.name}`));
      setSelected(null);
      say(`Opened ${d.name}`);
    } catch (e) {
      say((e as Error).message, true);
    }
  }, [say]);
  const newModel = useCallback(() => {
    edit(() => newDoc(), "New model");
    setSelected(null);
  }, [edit]);

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [
      { id: "file.new", label: "New model", group: "File", icon: "plus", run: newModel },
      { id: "file.open", label: "Open from disk…", group: "File", icon: "folder", keys: ["mod+o"], run: open },
      { id: "file.save", label: "Save to disk", group: "File", icon: "save", keys: ["mod+s"], run: save, keywords: "download export" },
      { id: "edit.undo", label: "Undo", group: "Edit", icon: "undo", keys: ["mod+z"], run: doUndo, enabled: canUndo(history) },
      { id: "edit.redo", label: "Redo", group: "Edit", icon: "redo", keys: ["shift+mod+z", "mod+y"], run: doRedo, enabled: canRedo(history) },
      {
        id: "edit.rename",
        label: "Rename part…",
        group: "Edit",
        icon: "pencil",
        keys: ["f2"],
        run: () => selectedPart && setRenaming(selectedPart),
        enabled: !!selectedPart,
      },
      {
        id: "edit.duplicate",
        label: "Duplicate part",
        group: "Edit",
        icon: "copy",
        keys: ["mod+d"],
        run: () => selected && duplicate(selected),
        enabled: !!selected,
      },
      { id: "edit.hide", label: "Hide or show part", group: "Edit", icon: "eye", run: () => selected && toggleHidden(selected), enabled: !!selected },
      {
        id: "edit.delete",
        label: "Delete part",
        group: "Edit",
        icon: "trash",
        keys: ["delete", "backspace"],
        run: () => selected && remove(selected),
        enabled: !!selected,
      },
      {
        id: "edit.deselect",
        label: "Back out",
        group: "Edit",
        keys: ["escape"],
        run: () => (tool !== "select" ? setTool("select") : setSelected(null)),
        keywords: "escape deselect cancel",
      },
      ...TOOLS.map<Command>((t) => ({
        id: `tool.${t.id}`,
        label: t.label,
        group: "Tools",
        icon: t.icon,
        keys: [t.key],
        run: () => armTool(t.id),
        keywords: t.title,
      })),
      ...(["box", "cylinder", "sphere"] as PartKind[]).map<Command>((k) => ({
        id: `add.${k}`,
        label: `Add a ${KIND_LABEL[k].toLowerCase()}`,
        group: "Tools",
        icon: k === "box" ? "cube" : k,
        run: () => add(k),
        keywords: "part primitive shape",
      })),
      ...VIEWS.map<Command>((v) => ({ id: `view.${v.id}`, label: `${v.label} view`, group: "View", icon: "camera", keys: [v.key], run: () => setView(v.id) })),
      { id: "view.fit", label: "Fit the parts in the view", group: "View", icon: "frame", keys: ["f"], run: () => say("Fit arrives with the 3D view") },
      ...PANELS.map<Command>((p) => ({ id: `panel.${p.id}`, label: `Show ${p.label}`, group: "Panels", icon: p.icon, run: () => setPanel(p.id) })),
      ...(Object.keys(THEME_LABEL) as ThemeSetting[]).map<Command>((t) => ({
        id: `theme.${t}`,
        label: `Theme: ${THEME_LABEL[t]}`,
        group: "Theme",
        icon: t === "light" ? "sun" : t === "system" ? "settings" : "moon",
        run: () => setThemeSetting(t),
      })),
      { id: "help.palette", label: "Find a command…", group: "Help", icon: "search", keys: ["mod+k"], run: () => setPaletteOpen(true) },
      { id: "help.shortcuts", label: "Keyboard shortcuts", group: "Help", icon: "keyboard", keys: ["?"], run: () => setShortcutsOpen(true) },
      { id: "help.gallery", label: "Component gallery", group: "Help", icon: "template", run: () => (window.location.hash = "#/gallery") },
    ];
    return list;
  }, [history, selected, selectedPart, tool, newModel, open, save, doUndo, doRedo, duplicate, toggleHidden, remove, armTool, add, say]);

  // One keyboard handler for the whole editor. Dialogs and menus stop Escape before it gets here.
  useEffect(() => {
    if (paletteOpen || shortcutsOpen || renaming) return;
    const onKey = (e: KeyboardEvent) => {
      const c = match(commands, e);
      if (!c) return;
      e.preventDefault();
      c.run();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [commands, paletteOpen, shortcutsOpen, renaming]);

  const activeTool = TOOLS.find((t) => t.id === tool)!;

  return (
    <div className="bc bc-app">
      <TopBar
        name={doc.name}
        onRename={(name) => edit((d) => ({ ...d, name }), "Rename model", "doc-name")}
        onRenameDone={sealHistory}
        canUndo={canUndo(history)}
        canRedo={canRedo(history)}
        onUndo={doUndo}
        onRedo={doRedo}
        status={status}
        onSave={save}
        onOpen={open}
        onNew={newModel}
        onPalette={() => setPaletteOpen(true)}
        themeSetting={themeSetting}
        onTheme={setThemeSetting}
        themeLabels={THEME_LABEL}
      />
      <div className="bc-body">
        <Rail items={PANELS} value={panel} onChange={setPanel} />
        <LeftPanel
          panel={panel}
          doc={doc}
          selected={selected}
          onSelect={setSelected}
          onAdd={add}
          onToggleHidden={toggleHidden}
          onRename={(p) => setRenaming(p)}
          onDuplicate={duplicate}
          onDelete={remove}
          history={history}
          themeSetting={themeSetting}
          onTheme={setThemeSetting}
          themeLabels={THEME_LABEL}
          onShortcuts={() => setShortcutsOpen(true)}
          onArmTool={armTool}
          tool={tool}
        />
        <Stage
          tool={activeTool}
          onArmTool={armTool}
          view={view}
          onView={setView}
          onFit={() => say("Fit arrives with the 3D view")}
          partCount={doc.parts.length}
        />
        <PropsPanel
          part={selectedPart}
          doc={doc}
          onChange={(change, label, key) => selectedPart && edit((d) => updatePart(d, selectedPart.id, change), label, key)}
          onCommit={sealHistory}
        />
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} commands={commands} />
      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} commands={commands} />
      <RenameDialog
        part={renaming}
        onClose={() => setRenaming(null)}
        onRename={(name) => {
          if (renaming && name.trim() && name !== renaming.name) edit((d) => updatePart(d, renaming.id, { name: name.trim() }), `Rename ${renaming.name}`);
          setRenaming(null);
        }}
      />
    </div>
  );
}
