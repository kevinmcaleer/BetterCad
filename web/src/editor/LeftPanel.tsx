import { useState, type ReactNode } from "react";
import { Banner, ContextMenu, Icon, PartsTree, WideButton, cx, type ContextMenuState, type MenuEntry, type RowToggle, type TreeItem } from "@bettercad/ui";
import { KIND_LABEL, PRIMITIVES, type Feature, type ModelDoc, type Part, type PartKind } from "../state/document";
import type { ThemeSetting } from "../state/theme";
import { formatCombo, type Command } from "../state/commands";
import { MODEL_TOOLS, type ToolId } from "./tools";
import { ThemePicker } from "./ThemePicker";
import { featureIcon, partIcon } from "./Timeline";

export type PanelId = "parts" | "sketch" | "bodies" | "library" | "history" | "params" | "settings";

export const PANEL_TITLES: Record<PanelId, string> = {
  parts: "Parts",
  sketch: "Sketch",
  bodies: "Bodies",
  library: "Library",
  history: "History",
  params: "Parameters",
  settings: "Settings",
};

export interface LeftPanelProps {
  panel: PanelId;
  doc: ModelDoc;
  /** The parts built up to the timeline marker. */
  parts: Part[];
  selection: string[];
  onSelect: (ids: string[]) => void;
  onAdd: (kind: PartKind) => void;
  onToggle: (id: string, what: RowToggle) => void;
  onRename: (id: string, name: string) => void;
  onReorder: (id: string, beforeId: string | null) => void;
  partMenu: (ids: string[]) => MenuEntry[];
  renameId: string | null;
  onRenameIdChange: (id: string | null) => void;
  features: Feature[];
  at: number;
  failed: Map<string, string>;
  summary: (f: Feature) => string;
  activeFeatureId: string | null;
  onSelectFeature: (f: Feature) => void;
  onRenameFeature: (id: string, name: string) => void;
  onReorderFeature: (id: string, beforeId: string | null) => void;
  featureMenu: (id: string) => MenuEntry[];
  featureRenameId: string | null;
  onFeatureRenameIdChange: (id: string | null) => void;
  timelineShown: boolean;
  onTimelineShown: (on: boolean) => void;
  theme: ThemeSetting;
  onTheme: (t: ThemeSetting) => void;
  commands: Command[];
  onArmTool: (t: ToolId) => void;
  tool: ToolId;
  /** The Parameters panel, made by the editor. */
  paramsPanel: ReactNode;
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
      return <HistoryPanel {...p} />;
    case "params":
      return <>{p.paramsPanel}</>;
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
  const items: TreeItem[] = p.parts.map((part) => ({
    id: part.id,
    name: part.name,
    icon: partIcon(part.kind),
    hidden: part.hidden,
    ghost: part.ghost,
    highlight: part.highlight,
  }));
  const chosen = p.parts.filter((x) => p.selection.includes(x.id));
  return (
    <>
      <WideButton icon="plus" label="Add a box" variant="outline" onClick={() => p.onAdd("box")} />
      <div className="bc-parts-head">
        <h2 className="bc-panel-title">Parts</h2>
        <span className="bc-note bc-count">{p.parts.length ? `${p.parts.length}` : ""}</span>
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
      {p.parts.length > 0 && <p className="bc-note">Shift-click selects a range, {formatCombo("mod")}-click adds one. Drag to reorder, F2 to rename.</p>}
      <div className="bc-section-gap" />
      <Banner tone="info">Press K to sketch on a plane or a flat face, then E to extrude a closed shape into a solid.</Banner>
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
            {t.key && <span className="bc-keys">{t.key.toUpperCase()}</span>}
          </button>
        ))}
      </div>
    </>
  );
}

function LibraryPanel(p: LeftPanelProps) {
  const shapes = PRIMITIVES.map((kind) => ({ kind, label: KIND_LABEL[kind], icon: partIcon(kind) }));
  return (
    <>
      <h2 className="bc-panel-title">Library</h2>
      <p className="bc-note">Click a shape to add it. Make one a hole in its properties, then Group it with a solid to cut it out.</p>
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

/** The timeline as rows, for people who prefer a list: the same steps, actions and selection as the bar. */
function HistoryPanel(p: LeftPanelProps) {
  const [menu, setMenu] = useState<{ id: string; at: ContextMenuState } | null>(null);
  const items: TreeItem[] = p.features.map((f, i) => ({
    id: f.id,
    name: f.name,
    icon: featureIcon(f),
    // Steps after the marker, and suppressed ones, are not built: shown muted.
    hidden: i >= p.at || !!f.suppressed,
    warning: p.failed.get(f.id),
  }));
  const rolledBack = p.at < p.features.length;
  return (
    <>
      <div className="bc-parts-head">
        <h2 className="bc-panel-title">History</h2>
        <span className="bc-note bc-count">{p.features.length ? (rolledBack ? `${p.at} of ${p.features.length}` : `${p.features.length}`) : ""}</span>
      </div>
      <p className="bc-note">Every step that builds the model, in order. Drag to reorder, F2 to rename, right-click to suppress or delete.</p>
      {rolledBack && <Banner tone="info">Rolled back. The model shows the first {p.at} steps, and new steps go in at the marker.</Banner>}
      <PartsTree
        label="History"
        items={items}
        selection={p.activeFeatureId ? [p.activeFeatureId] : []}
        onSelect={(ids) => {
          const f = p.features.find((x) => x.id === ids[ids.length - 1]);
          if (f) p.onSelectFeature(f);
        }}
        onRename={p.onRenameFeature}
        onReorder={p.onReorderFeature}
        toggles={[]}
        renameId={p.featureRenameId}
        onRenameIdChange={p.onFeatureRenameIdChange}
        onContextMenu={(id, at) => setMenu({ id, at })}
        empty={<p className="bc-note">No steps yet. Add a shape and it shows here and on the timeline.</p>}
      />
      <ContextMenu
        at={menu?.at ?? null}
        onClose={() => setMenu(null)}
        label="Step actions"
        title={p.features.find((f) => f.id === menu?.id)?.name}
        entries={menu ? p.featureMenu(menu.id) : []}
      />
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
      <h2 className="bc-panel-title">Timeline</h2>
      <label className="bc-check">
        <input type="checkbox" checked={p.timelineShown} onChange={(e) => p.onTimelineShown(e.target.checked)} />
        <span>Show the timeline under the view</span>
      </label>
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
