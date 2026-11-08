import { useEffect, useState, type ReactNode } from "react";
import {
  Banner,
  Button,
  ContextMenu,
  Fields,
  NumberField,
  Icon,
  PartsTree,
  type ContextMenuState,
  type MenuEntry,
  type RowToggle,
  type TreeItem,
} from "@bettercad/ui";
import {
  KIND_LABEL,
  ORIENT_WEIGHTS,
  PRIMITIVES,
  type OrientWeights,
  type BuiltLink,
  type Feature,
  type JointFeature,
  type ModelDoc,
  type Part,
  type PartKind,
} from "../state/document";
import type { ThemeSetting } from "../state/theme";
import { formatCombo } from "../state/commands";
import { ThemePicker } from "./ThemePicker";
import { featureIcon, partIcon } from "./Timeline";
import { BrowserPanel, type BrowserConstruct, type BrowserModel, type BrowserPanelProps, type BrowserSketch, type OriginItem } from "./Browser";
import type { WorldPlaneName } from "../viewport/engine";
import { cachedBytes, clearCachedApp } from "../pwa/register";

export type PanelId = "parts" | "library" | "robot" | "history" | "params" | "print" | "settings";

export const PANEL_TITLES: Record<PanelId, string> = {
  parts: "Browser",
  library: "Library",
  robot: "Catalogue",
  history: "History",
  params: "Parameters",
  print: "Print",
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
  /** The model's name, renamed from the top of the browser. */
  onRenameModel: (name: string) => void;
  /** A view-only share. */
  readOnly?: boolean;
  onReorder: (id: string, beforeId: string | null) => void;
  partMenu: (ids: string[]) => MenuEntry[];
  renameId: string | null;
  onRenameIdChange: (id: string | null) => void;
  /** The browser's sketches, origin planes and their eyes. */
  sketches: BrowserSketch[];
  /** Links (#171) as built. */
  links?: BuiltLink[];
  /** Joints (#172) as built. */
  joints?: JointFeature[];
  /** Named poses (#177) and what to do with them, under Joints in the browser. */
  poses?: Pick<BrowserModel, "poses" | "atPose"> &
    Required<Pick<BrowserPanelProps, "onPose" | "onSavePose" | "onUpdatePose" | "onRenamePose" | "onDeletePose">>;
  origin: OriginItem[];
  onOrigin: (shown: OriginItem[]) => void;
  onBodiesHidden: (ids: string[], hidden: boolean) => void;
  onSketchesHidden: (ids: string[], hidden: boolean) => void;
  onBrowserPicked: (id: string | null) => void;
  onSketchOn: (plane: WorldPlaneName) => void;
  /** Construction geometry (#265) for the browser, and sketching on a construction plane. */
  construct?: BrowserConstruct[];
  onSketchOnStep?: (id: string) => void;
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
  /** The printer's build volume in the view (#100), shared with the Print panel. */
  bedShown: boolean;
  onBedShown: (on: boolean) => void;
  theme: ThemeSetting;
  onTheme: (t: ThemeSetting) => void;
  /** The Parameters panel, made by the editor. */
  paramsPanel: ReactNode;
  /** Back to the browser, from any other panel. */
  onBack: () => void;
  /** The Print panel (#100), made by the editor. */
  printPanel: ReactNode;
  /** Robot parts (#187), made by the editor. */
  robotPanel: ReactNode;
  /** How orientation suggestions are scored (#103). */
  orientWeights: OrientWeights;
  onOrientWeights: (w: OrientWeights) => void;
}

/**
 * The panel floating on the left. The browser is the home panel; the Library, Parameters, Print, History and Settings
 * open in its place, from the top bar and the account menu, with a way back.
 */
export function LeftPanel(p: LeftPanelProps) {
  if (p.panel === "parts") return <PartsPanel {...p} />;
  return (
    <>
      <div className="bc-panel-back">
        <Button size="dense" icon="chevron" className="bc-back-btn" label="Browser" title="Back to the browser" shortcut="Esc" onClick={p.onBack} />
        <span className="bc-panel-back-title">{PANEL_TITLES[p.panel]}</span>
      </div>
      <PanelBody {...p} />
    </>
  );
}

function PanelBody(p: LeftPanelProps) {
  switch (p.panel) {
    case "parts":
      return <PartsPanel {...p} />;
    case "library":
      return <LibraryPanel {...p} />;
    case "history":
      return <HistoryPanel {...p} />;
    case "params":
      return <>{p.paramsPanel}</>;
    case "print":
      return <>{p.printPanel}</>;
    case "robot":
      return <>{p.robotPanel}</>;
    case "settings":
      return <SettingsPanel {...p} />;
  }
}

function PartsPanel(p: LeftPanelProps) {
  return (
    <BrowserPanel
      model={{
        name: p.doc.name,
        parts: p.parts,
        sketches: p.sketches,
        origin: p.origin,
        readOnly: p.readOnly,
        links: p.links,
        joints: p.joints,
        construct: p.construct,
        poses: p.poses?.poses,
        atPose: p.poses?.atPose,
      }}
      selection={p.selection}
      onSelect={p.onSelect}
      onAdd={p.onAdd}
      onToggle={p.onToggle}
      onBodiesHidden={p.onBodiesHidden}
      onSketchesHidden={p.onSketchesHidden}
      onOrigin={p.onOrigin}
      onPicked={p.onBrowserPicked}
      onSelectSketch={(id) => {
        const f = p.features.find((x) => x.id === id);
        if (f) p.onSelectFeature(f);
      }}
      onRename={p.onRename}
      onRenameModel={p.onRenameModel}
      onRenameSketch={p.onRenameFeature}
      onReorder={p.onReorder}
      onSketchOn={p.onSketchOn}
      onSketchOnStep={p.onSketchOnStep}
      partMenu={p.partMenu}
      sketchMenu={p.featureMenu}
      renameId={p.renameId}
      onRenameIdChange={p.onRenameIdChange}
      onPose={p.poses?.onPose}
      onSavePose={p.poses?.onSavePose}
      onUpdatePose={p.poses?.onUpdatePose}
      onRenamePose={p.poses?.onRenamePose}
      onDeletePose={p.poses?.onDeletePose}
    />
  );
}

function LibraryPanel(p: LeftPanelProps) {
  const shapes = PRIMITIVES.map((kind) => ({ kind, label: KIND_LABEL[kind], icon: partIcon(kind) }));
  return (
    <>
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
      <h2 className="bc-panel-title">Build volume</h2>
      <label className="bc-check">
        <input type="checkbox" checked={p.bedShown} onChange={(e) => p.onBedShown(e.target.checked)} />
        <span>Show the build volume</span>
      </label>
      <p className="bc-note">The space your printer can print in. Choose your printer in Print.</p>
      <OfflineSettings />
      <h2 className="bc-panel-title">Units</h2>
      <p className="bc-note">Millimetres. Z points up.</p>
      <h2 className="bc-panel-title">Keyboard shortcuts</h2>
      <p className="bc-note">Press ? or open Help to see them, or {formatCombo("mod+k")} to find any command.</p>
      <h2 className="bc-panel-title">Advanced</h2>
      <h3 className="bc-sub" id="bc-orient-weights">
        Orientation suggestions
      </h3>
      <div role="group" aria-labelledby="bc-orient-weights">
        <Fields>
          {(
            [
              ["contact", "Contact"],
              ["overhang", "Overhang"],
              ["height", "Height"],
            ] as const
          ).map(([k, label]) => (
            <NumberField
              key={k}
              label={label}
              value={p.orientWeights[k]}
              min={0}
              max={1}
              step={0.1}
              precision={2}
              unit="none"
              onCommit={(v) => p.onOrientWeights({ ...p.orientWeights, [k]: Math.max(0, Math.min(1, v)) })}
            />
          ))}
        </Fields>
      </div>
      <p className="bc-note">How much each counts when the Print panel suggests a way to lay the model: more on the bed, less overhang, less height.</p>
      <Button size="dense" label="Reset" title="Back to 0.4, 0.4 and 0.2" onClick={() => p.onOrientWeights(ORIENT_WEIGHTS)} />
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

/** The cached app (#94): how much it takes, and a way to clear it. */
function OfflineSettings() {
  const [bytes, setBytes] = useState<number | null>(null);
  const [cleared, setCleared] = useState(false);
  useEffect(() => {
    let gone = false;
    void cachedBytes().then((b) => !gone && setBytes(b));
    return () => {
      gone = true;
    };
  }, []);
  if (typeof caches === "undefined") return null;
  return (
    <>
      <h2 className="bc-panel-title">Offline</h2>
      <p className="bc-note">
        BetterCad keeps itself in this browser so it opens offline
        {bytes !== null ? `, using ${bytes >= 1024 * 1024 ? `${Math.round(bytes / (1024 * 1024))} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`}` : ""}.
        {cleared ? " Cleared: the next load fetches it again." : ""}
      </p>
      <Button
        label="Clear cached app"
        title="Remove the cached app; your autosaves stay"
        disabled={cleared}
        onClick={() =>
          void clearCachedApp().then(() => {
            setCleared(true);
            setBytes(null);
          })
        }
      />
    </>
  );
}
