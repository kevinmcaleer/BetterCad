import { useState, type ReactNode } from "react";
import { Banner, ContextMenu, Icon, PartsTree, WideButton, cx, type ContextMenuState, type MenuEntry, type RowToggle, type TreeItem } from "@bettercad/ui";
import type { ModelDoc, PartKind } from "../state/document";
import type { History } from "../state/history";
import type { ThemeSetting } from "../state/theme";
import { formatCombo, type Command } from "../state/commands";
import { MODEL_TOOLS, type ToolId } from "./tools";
import { ThemePicker } from "./ThemePicker";

export type PanelId = "parts" | "sketch" | "bodies" | "library" | "history" | "settings";

export const PANEL_TITLES: Record<PanelId, string> = {
  parts: "Parts",
  sketch: "Sketch",
  bodies: "Bodies",
  library: "Library",
  history: "History",
  settings: "Settings",
};

export interface LeftPanelProps {
  panel: PanelId;
  doc: ModelDoc;
  selection: string[];
  onSelect: (ids: string[]) => void;
  onAdd: (kind: PartKind) => void;
  onToggle: (id: string, what: RowToggle) => void;
  onRename: (id: string, name: string) => void;
  onReorder: (id: string, beforeId: string | null) => void;
  partMenu: (ids: string[]) => MenuEntry[];
  renameId: string | null;
  onRenameIdChange: (id: string | null) => void;
  history: History<ModelDoc>;
  theme: ThemeSetting;
  onTheme: (t: ThemeSetting) => void;
  commands: Command[];
  onArmTool: (t: ToolId) => void;
  tool: ToolId;
}

export function LeftPanel(p: LeftPanelProps) {
  switch (p.panel) {
    case "parts":
      return <PartsPanel {...p} />;
    case "sketch":
      return <SketchPanel {...p} />;
    case "bodies":
      return (
        <Placeholder title="Bodies" epic={6}>
          Solid bodies you have extruded, pushed and combined show here, each with its own colour and visibility.
        </Placeholder>
      );
    case "library":
      return <LibraryPanel {...p} />;
    case "history":
      return <HistoryPanel history={p.history} />;
    case "settings":
      return <SettingsPanel {...p} />;
  }
}

function Placeholder({ title, epic, children }: { title: string; epic: number; children: ReactNode }) {
  return (
    <>
      <h2 className="bc-panel-title">{title}</h2>
      <p className="bc-note">{children}</p>
      <Banner tone="info">
        Arrives with <a href={`https://github.com/kevinmcaleer/BetterCad/issues/${epic}`}>epic #{epic}</a>.
      </Banner>
    </>
  );
}

function PartsPanel(p: LeftPanelProps) {
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const items: TreeItem[] = p.doc.parts.map((part) => ({
    id: part.id,
    name: part.name,
    icon: part.kind === "box" ? "cube" : part.kind,
    hidden: part.hidden,
    ghost: part.ghost,
    highlight: part.highlight,
  }));
  const chosen = p.doc.parts.filter((x) => p.selection.includes(x.id));
  return (
    <>
      <WideButton icon="plus" label="Add a box" variant="outline" onClick={() => p.onAdd("box")} />
      <div className="bc-parts-head">
        <h2 className="bc-panel-title">Parts</h2>
        <span className="bc-note bc-count">{p.doc.parts.length ? `${p.doc.parts.length}` : ""}</span>
      </div>
      <PartsTree
        label="Parts"
        items={items}
        selection={p.selection}
        onSelect={p.onSelect}
        onRename={p.onRename}
        onToggle={p.onToggle}
        onReorder={p.onReorder}
        toggles={["hidden", "ghost", "highlight"]}
        renameId={p.renameId}
        onRenameIdChange={p.onRenameIdChange}
        onContextMenu={(_id, at) => setMenu(at)}
        empty={<p className="bc-note">Nothing here yet. Add a shape from the Library, or start a sketch (K).</p>}
      />
      {p.doc.parts.length > 0 && <p className="bc-note">Shift-click selects a range, {formatCombo("mod")}-click adds one. Drag to reorder, F2 to rename.</p>}
      <div className="bc-section-gap" />
      <Banner tone="info">The 3D view and the modelling kernel are not wired up yet, so parts are only listed here for now.</Banner>
      <ContextMenu
        at={menu}
        onClose={() => setMenu(null)}
        label="Part actions"
        title={chosen.length > 1 ? `${chosen.length} parts` : chosen[0]?.name}
        entries={p.partMenu(p.selection)}
      />
    </>
  );
}

function SketchPanel(p: LeftPanelProps) {
  return (
    <>
      <h2 className="bc-panel-title">Sketch</h2>
      <p className="bc-note">Draw on a face or plane, then constrain and dimension it, the way Fusion does. Sketch tools arrive with epic #5.</p>
      <div className="bc-tool-list">
        {[
          { id: "line", icon: "pencil" as const, label: "Line", key: "L" },
          { id: "rect", icon: "border" as const, label: "Rectangle", key: "" },
          { id: "circle", icon: "hole" as const, label: "Circle", key: "" },
          { id: "dim", icon: "dimension" as const, label: "Dimension", key: "D" },
          { id: "con", icon: "constraint" as const, label: "Constraint", key: "" },
        ].map((t) => (
          <button key={t.id} type="button" className="bc-menu-item" aria-disabled="true" data-tip={`${t.label} comes with sketching (#5)`}>
            <span className="bc-menu-icon">
              <Icon name={t.icon} />
            </span>
            <span>{t.label}</span>
            {t.key && <span className="bc-keys">{t.key}</span>}
          </button>
        ))}
      </div>
      <h2 className="bc-panel-title">Model tools</h2>
      <div className="bc-tool-list">
        {MODEL_TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={cx("bc-menu-item", p.tool === t.id && "bc-on")}
            aria-pressed={p.tool === t.id}
            onClick={() => p.onArmTool(t.id)}
          >
            <span className="bc-menu-icon">
              <Icon name={t.icon} />
            </span>
            <span>{t.label}</span>
            <span className="bc-keys">{t.key.toUpperCase()}</span>
          </button>
        ))}
      </div>
    </>
  );
}

function LibraryPanel(p: LeftPanelProps) {
  const shapes: { kind: PartKind; label: string; icon: "cube" | "cylinder" | "sphere" }[] = [
    { kind: "box", label: "Box", icon: "cube" },
    { kind: "cylinder", label: "Cylinder", icon: "cylinder" },
    { kind: "sphere", label: "Sphere", icon: "sphere" },
  ];
  return (
    <>
      <h2 className="bc-panel-title">Library</h2>
      <p className="bc-note">Click a shape to add it. Dragging onto the view comes with the 3D view.</p>
      <div className="bc-tiles bc-tiles-labelled">
        {shapes.map((s) => (
          <button key={s.kind} type="button" className="bc-tile" data-tip={`Add a ${s.label.toLowerCase()}`} onClick={() => p.onAdd(s.kind)}>
            <Icon name={s.icon} size={28} />
            <span>{s.label}</span>
          </button>
        ))}
      </div>
    </>
  );
}

function HistoryPanel({ history }: { history: History<ModelDoc> }) {
  const steps = [...history.past.slice(1).map((s) => s.label), ...(history.past.length ? [history.label] : [])];
  return (
    <>
      <h2 className="bc-panel-title">History</h2>
      <p className="bc-note">Every change you make, newest last. The full timeline, where you can edit an old step, arrives with epic #7.</p>
      {steps.length === 0 ? (
        <p className="bc-note">No changes yet.</p>
      ) : (
        <ol className="bc-history">
          {steps.map((label, i) => (
            <li key={i} className={cx(i === steps.length - 1 && "bc-on")}>
              {label}
            </li>
          ))}
          {history.future.map((f, i) => (
            <li key={`f${i}`} className="bc-undone">
              {f.label}
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

function SettingsPanel(p: LeftPanelProps) {
  const groups = new Map<string, Command[]>();
  for (const c of p.commands) if (c.keys?.length) groups.set(c.group, [...(groups.get(c.group) ?? []), c]);
  return (
    <>
      <h2 className="bc-panel-title">Theme</h2>
      <ThemePicker value={p.theme} onChange={p.onTheme} />
      <p className="bc-note">System follows your device, light or dark. Holodeck is a black drawing room with a yellow grid.</p>
      <h2 className="bc-panel-title">Units</h2>
      <p className="bc-note">Millimetres. Z points up.</p>
      <h2 className="bc-panel-title" id="bc-shortcuts-title">
        Keyboard shortcuts
      </h2>
      <p className="bc-note">Press ? to see these any time, or {formatCombo("mod+k")} to find any command.</p>
      <div aria-labelledby="bc-shortcuts-title">
        {[...groups].map(([group, list]) => (
          <div key={group}>
            <h3 className="bc-sub">{group}</h3>
            <dl className="bc-shortcuts">
              {list.map((c) => (
                <div key={c.id}>
                  <dt>{c.label}</dt>
                  <dd>
                    {c.keys!.map((k) => (
                      <kbd key={k}>{formatCombo(k)}</kbd>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
      {import.meta.env.DEV || import.meta.env.VITE_GALLERY ? (
        <>
          <h2 className="bc-panel-title">Components</h2>
          <a className="bc-wide-btn bc-outline bc-link-btn" href="#/gallery">
            <Icon name="template" />
            <span>Open the component gallery</span>
          </a>
        </>
      ) : null}
    </>
  );
}
