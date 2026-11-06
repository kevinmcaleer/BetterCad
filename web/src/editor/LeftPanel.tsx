import { useState, type ReactNode } from "react";
import { Banner, ContextMenu, Icon, IconButton, PartRow, PartsTree, WideButton, cx, type ContextMenuState, type MenuEntry, THEME_NAMES } from "@bettercad/ui";
import type { ModelDoc, Part, PartKind } from "../state/document";
import type { History } from "../state/history";
import type { ThemeSetting } from "../state/theme";
import { MODEL_TOOLS, type ToolId } from "./tools";
import { formatCombo } from "../state/commands";

export type PanelId = "parts" | "sketch" | "bodies" | "library" | "history" | "settings";

export interface LeftPanelProps {
  panel: PanelId;
  doc: ModelDoc;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onAdd: (kind: PartKind) => void;
  onToggleHidden: (id: string) => void;
  onRename: (p: Part) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  history: History<ModelDoc>;
  themeSetting: ThemeSetting;
  onTheme: (t: ThemeSetting) => void;
  themeLabels: Record<ThemeSetting, string>;
  onShortcuts: () => void;
  onArmTool: (t: ToolId) => void;
  tool: ToolId;
}

const TITLES: Record<PanelId, string> = { parts: "Parts", sketch: "Sketch", bodies: "Bodies", library: "Library", history: "History", settings: "Settings" };

export function LeftPanel(p: LeftPanelProps) {
  return (
    <aside className="bc-side bc-left" aria-label={TITLES[p.panel]} id="bc-left-panel">
      {p.panel === "parts" && <PartsPanel {...p} />}
      {p.panel === "sketch" && <SketchPanel {...p} />}
      {p.panel === "bodies" && (
        <Placeholder title="Bodies" epic={6}>
          Solid bodies you have extruded, pushed and combined show here, each with its own colour and visibility.
        </Placeholder>
      )}
      {p.panel === "library" && <LibraryPanel {...p} />}
      {p.panel === "history" && <HistoryPanel history={p.history} />}
      {p.panel === "settings" && <SettingsPanel {...p} />}
    </aside>
  );
}

function Placeholder({ title, epic, children }: { title: string; epic: number; children: ReactNode }) {
  return (
    <>
      <h2 className="bc-panel-title">{title}</h2>
      <p className="bc-note">{children}</p>
      <p className="bc-note">
        Arrives with <a href={`https://github.com/kevinmcaleer/BetterCad/issues/${epic}`}>epic #{epic}</a>.
      </p>
    </>
  );
}

function PartsPanel(p: LeftPanelProps) {
  const [menu, setMenu] = useState<{ at: ContextMenuState; part: Part } | null>(null);
  const entries: MenuEntry[] = menu
    ? [
        { id: "rename", label: "Rename…", icon: "pencil", keys: "F2", onSelect: () => p.onRename(menu.part) },
        { id: "dup", label: "Duplicate", icon: "copy", keys: formatCombo("mod+d"), onSelect: () => p.onDuplicate(menu.part.id) },
        { id: "hide", label: menu.part.hidden ? "Show" : "Hide", icon: menu.part.hidden ? "eye" : "eyeOff", onSelect: () => p.onToggleHidden(menu.part.id) },
        { kind: "separator", id: "s" },
        { id: "del", label: "Delete", icon: "trash", keys: "Del", danger: true, onSelect: () => p.onDelete(menu.part.id) },
      ]
    : [];
  return (
    <>
      <WideButton icon="plus" label="Add a box" variant="outline" onClick={() => p.onAdd("box")} />
      <div className="bc-parts-head">
        <h2 className="bc-panel-title">Parts</h2>
        <span className="bc-note bc-count">{p.doc.parts.length || ""}</span>
      </div>
      {p.doc.parts.length === 0 ? (
        <p className="bc-note">Nothing here yet. Add a shape from the Library, or start a sketch (K).</p>
      ) : (
        <PartsTree label="Parts">
          {p.doc.parts.map((part) => (
            <PartRow
              key={part.id}
              name={part.name}
              icon={part.kind === "box" ? "cube" : part.kind}
              selected={part.id === p.selected}
              hidden={part.hidden}
              onSelect={() => p.onSelect(part.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                p.onSelect(part.id);
                setMenu({ at: { x: e.clientX, y: e.clientY }, part });
              }}
              buttons={
                <>
                  <IconButton
                    quiet
                    icon={part.hidden ? "eyeOff" : "eye"}
                    title={part.hidden ? `Show ${part.name}` : `Hide ${part.name}`}
                    on={part.hidden}
                    onClick={() => p.onToggleHidden(part.id)}
                  />
                  <IconButton
                    quiet
                    icon="more"
                    title={`More for ${part.name}`}
                    onClick={(e) => {
                      const r = e.currentTarget.getBoundingClientRect();
                      p.onSelect(part.id);
                      setMenu({ at: { x: r.left, y: r.bottom + 4 }, part });
                    }}
                  />
                </>
              }
            />
          ))}
        </PartsTree>
      )}
      <div className="bc-section-gap" />
      <Banner>The 3D view and the modelling kernel are not wired up yet, so parts are only listed here for now.</Banner>
      <ContextMenu
        at={menu?.at ?? null}
        onClose={() => setMenu(null)}
        label={menu ? `${menu.part.name} actions` : "Part"}
        title={menu?.part.name}
        entries={entries}
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
          <button key={t.id} type="button" className="bc-menu-item" disabled title={`${t.label} (coming with sketching)`}>
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
          <button key={s.kind} type="button" className="bc-tile" title={`Add a ${s.label.toLowerCase()}`} onClick={() => p.onAdd(s.kind)}>
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
  const settings = Object.keys(p.themeLabels) as ThemeSetting[];
  return (
    <>
      <h2 className="bc-panel-title">Theme</h2>
      <div className="bc-theme-picker" role="radiogroup" aria-label="Theme">
        {settings.map((t) => (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={p.themeSetting === t}
            className={cx("bc-theme-opt", p.themeSetting === t && "bc-on")}
            onClick={() => p.onTheme(t)}
          >
            <span className={cx("bc-swatch", `bc-swatch-${t}`)} data-theme={t === "system" ? undefined : t} aria-hidden="true" />
            <span>{t === "system" ? "System" : THEME_NAMES[t]}</span>
          </button>
        ))}
      </div>
      <p className="bc-note">System follows your device, light or dark. Holodeck is a black drawing room with a yellow grid.</p>
      <h2 className="bc-panel-title">Units</h2>
      <p className="bc-note">Millimetres. Inches may come later.</p>
      <h2 className="bc-panel-title">Keyboard</h2>
      <WideButton icon="keyboard" label="Keyboard shortcuts" variant="outline" onClick={p.onShortcuts} />
      <p className="bc-note">Press ? to see them any time, or {formatCombo("mod+k")} to find a command.</p>
      <h2 className="bc-panel-title">Components</h2>
      <a className="bc-wide-btn bc-outline bc-link-btn" href="#/gallery">
        <Icon name="template" />
        <span>Open the component gallery</span>
      </a>
    </>
  );
}
