import { Fragment, useState, type ReactNode } from "react";
import { Button, Icon, IconButton, MenuButton, Separator, ToolButton, Toolbar, cx, type MenuEntry } from "@bettercad/ui";
import type { ThemeSetting } from "../state/theme";
import { formatCombo } from "../state/commands";
import { ThemePicker } from "./ThemePicker";
import type { CloudState } from "../files/useFiles";
import { go } from "../cloud/route";
import { TOOL_GROUPS, type ToolId } from "./tools";
import { CONSTRUCT_KINDS, type ConstructKind } from "../state/document";
import { constructIcon } from "./Timeline";
import type { PanelId } from "./LeftPanel";
import type { RibbonTab } from "./ribbonPrefs";

const CLOUD_TEXT: Record<CloudState, string> = {
  saved: "Saved to your account",
  saving: "Saving to your account…",
  dirty: "Changes not saved to your account yet",
  offline: "Offline: saves when you're back",
  error: "Not saved to your account",
};

export interface TopBarProps {
  /** The armed tool, and arming one. Read-only shares have no tools. */
  tool: ToolId;
  onArmTool: (t: ToolId) => void;
  /** The open left panel, and opening one (null folds it away). */
  panel: PanelId | null;
  onPanel: (p: PanelId | null) => void;
  /** The Parameters dialog, open over the view, and opening or closing it. */
  paramsOpen?: boolean;
  onParams?: () => void;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string;
  redoLabel: string;
  onUndo: () => void;
  onRedo: () => void;
  /** The arrow beside Save: Save as, Open, New, Import and the recent files, after Share, Versions and Export. */
  saveEntries: MenuEntry[];
  /** The Save button's tooltip when the model is not saved to an account: where a click saves to. */
  saveTip?: string;
  onSave?: () => void;
  onPalette: () => void;
  theme: ThemeSetting;
  onTheme: (t: ThemeSetting) => void;
  /** Under 900px: the button that opens the props sheet. */
  onProps: () => void;
  propsOpen: boolean;
  /** Signed in (#88): who. Null when signed out. */
  account?: { name: string; admin?: boolean } | null;
  /** False when there is no server to sign in to. */
  accountsOn?: boolean;
  /** The model is saved to the account (#90): how that stands. */
  cloud?: CloudState | null;
  /** Versions in the Save menu opens the version history (#91). */
  onHistory?: () => void;
  /** Set when the model can be shared (#92). */
  onShare?: () => void;
  onSignOut?: () => void;
  /** Install BetterCad as an app (#95), when the browser offers it. */
  onInstall?: () => void;
  /** A share link is open: read-only, with downloads and a way to make it yours. */
  shared?: { owner: string } | null;
  onOpenCopy?: () => void;
  onDownloadBcad?: () => void;
  onExport?: () => void;
  /** Build steps: a picture per timeline step and a Markdown guide, as a .zip. */
  onExportSteps?: () => void;
  /** Send to kevsrobots: the build steps to one of your kevsrobots projects. */
  onSendSteps?: () => void;
  /** The kevsrobots project the model was sent to before, so the entry offers an update. */
  sentTo?: string;
  /** Help (#110): shortcuts, the tour, the course, reports and About. */
  helpEntries?: MenuEntry[];
  /** The Construct menu (#265): arms the tool for a kind of plane, axis or point. */
  onConstruct?: (k: ConstructKind) => void;
  /** Mirror (#69): its own button before Pattern, though both arm the Pattern tool. */
  mirrorOn?: boolean;
  onMirror?: () => void;
  /** New component (#171): an empty one to work in, inside the active one. From bodies is on their menu. */
  onNewComponent?: () => void;
  /**
   * The desktop ribbon: when set, the bar grows a row of tabs and big tools, and this draws the open tab's tools
   * (loaded after first paint). Unset, the compact bar shows.
   */
  ribbon?: (tab: Exclude<RibbonTab, "sketch">) => ReactNode;
  /** A sketch is open: the ribbon's Sketch tab takes over, and this draws its tools. */
  sketchRibbon?: ReactNode;
}

const TABS: [Exclude<RibbonTab, "sketch">, string][] = [
  ["model", "Model"],
  ["assemble", "Assemble"],
  ["inspect", "Inspect"],
];

/** The Construct menu's entries: planes, then axes, then points, as in Fusion. */
export function constructEntries(on: (k: ConstructKind) => void): MenuEntry[] {
  const out: MenuEntry[] = [];
  for (const k of CONSTRUCT_KINDS) {
    const prev = out.length ? CONSTRUCT_KINDS[CONSTRUCT_KINDS.indexOf(k) - 1] : undefined;
    if (prev && prev.what !== k.what) out.push({ kind: "separator", id: `s-${k.what}` });
    out.push({ id: k.id, label: k.label, icon: constructIcon(k.what), onSelect: () => on(k.id) });
  }
  return out;
}

/** The arrow's entries: Share, Versions and Export first, then the file entries from the editor. */
export function saveMenuEntries(
  p: Pick<TopBarProps, "saveEntries" | "onShare" | "onHistory" | "onExport" | "onExportSteps" | "onSendSteps" | "sentTo" | "cloud">,
): MenuEntry[] {
  return [
    // Share and Versions need the model in an account; they stay in the menu, greyed, so you know where they are.
    { id: "share", label: "Share…", icon: "share", disabled: !p.onShare, onSelect: () => p.onShare?.() },
    { id: "versions", label: "Versions…", icon: "history", disabled: !(p.cloud && p.onHistory), onSelect: () => p.onHistory?.() },
    { id: "export", label: "Export…", icon: "download", keys: formatCombo("mod+e"), onSelect: () => p.onExport?.() },
    { id: "steps", label: "Build steps (.zip)…", icon: "image", disabled: !p.onExportSteps, onSelect: () => p.onExportSteps?.() },
    {
      id: "send",
      label: p.sentTo ? "Update on kevsrobots…" : "Send to kevsrobots…",
      icon: "upload",
      disabled: !p.onSendSteps,
      onSelect: () => p.onSendSteps?.(),
    },
    { kind: "separator", id: "s-file" },
    ...p.saveEntries,
  ];
}

/**
 * Save as a split button: a click on Save saves, the arrow beside it opens Share, Versions, Export and the file
 * entries. When the model is saved to an account, the icon and description say how that stands.
 */
function SaveSplit(p: TopBarProps) {
  const bad = p.cloud === "error" || p.cloud === "offline";
  return (
    <span className={cx("bc-split", bad && "bc-bad")} role="group" aria-label="Save">
      <Button
        variant="primary"
        icon={p.cloud === "offline" ? "cloudOff" : p.cloud === "error" ? "warning" : p.cloud ? "cloud" : "save"}
        label="Save"
        title={p.cloud ? CLOUD_TEXT[p.cloud] : (p.saveTip ?? "Save your model")}
        shortcut={formatCombo("mod+s")}
        aria-describedby={p.cloud ? "bc-cloud-state" : undefined}
        onClick={p.onSave}
      />
      {p.cloud && (
        <span id="bc-cloud-state" className="bc-sr-only">
          {CLOUD_TEXT[p.cloud]}
        </span>
      )}
      <MenuButton
        label="Save options"
        align="end"
        entries={saveMenuEntries(p)}
        trigger={(t) => <Button {...t} variant="primary" className="bc-split-arrow" icon="chevronDown" title="Share, versions and export" />}
      />
    </span>
  );
}

/** The panels a top-bar button opens: pressing it again goes back to the browser. */
const panelToggle = (p: TopBarProps, id: PanelId) => () => p.onPanel(p.panel === id ? "parts" : id);

export function TopBar(p: TopBarProps) {
  const [tab, setTab] = useState<Exclude<RibbonTab, "sketch">>("model");
  const [folded, setFolded] = useState(false);
  const ribbon = !p.shared && p.ribbon;
  const sketching = !!p.sketchRibbon;
  const title = (
    <span className="bc-title">
      <Icon name="cube" size={18} />
      <span className="bc-brand">BetterCad</span>
    </span>
  );
  if (ribbon) {
    const pick = (t: Exclude<RibbonTab, "sketch">) => {
      setTab(t);
      setFolded(false);
    };
    return (
      <header className={cx("bc-top bc-top-ribbon", folded && "bc-folded")}>
        <div className="bc-ribbon-bar">
          {title}
          {browserToggle(p)}
          <span className="bc-ribbon-tabs" role="tablist" aria-label="Tool tabs">
            {sketching && (
              <button type="button" role="tab" id="bc-tab-sketch" className="bc-tab" aria-selected aria-controls="bc-ribbon-tools">
                Sketch
              </button>
            )}
            {TABS.map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                id={`bc-tab-${id}`}
                className="bc-tab"
                aria-selected={!sketching && tab === id}
                aria-controls="bc-ribbon-tools"
                disabled={sketching}
                data-tip={folded ? undefined : "Double-click to fold the tools away"}
                onClick={() => pick(id)}
                onDoubleClick={() => setFolded(!folded)}
              >
                {label}
              </button>
            ))}
          </span>
          <span className="bc-grow" />
          {undoRedo(p)}
          <Separator />
          {rightSide(p)}
        </div>
        {!folded && (
          <div className="bc-ribbon-tools" id="bc-ribbon-tools" role="tabpanel" aria-labelledby={`bc-tab-${sketching ? "sketch" : tab}`}>
            <Toolbar label={sketching ? "Sketch tools" : "Model tools"} className="bc-ribbon-groups">
              {sketching ? p.sketchRibbon : ribbon(tab)}
            </Toolbar>
          </div>
        )}
      </header>
    );
  }
  return (
    <header className="bc-top">
      {title}
      {browserToggle(p)}
      <Separator />
      {undoRedo(p)}
      {!p.shared && (
        <>
          <Separator />
          <Toolbar label="Model tools" className="bc-top-tools">
            {TOOL_GROUPS.map((g, i) => (
              <span key={g.id} className="bc-tool-group" role="group" aria-label={g.label}>
                {i > 0 && <Toolbar.Separator />}
                {g.id === "make" && (
                  <>
                    <ToolButton icon="component" label="New component" onPress={p.onNewComponent} />
                    <ToolButton icon="shapes" label="Library" pressed={p.panel === "library"} onPress={panelToggle(p, "library")} />
                    <ToolButton icon="screw" label="Catalogue" pressed={p.panel === "robot"} onPress={panelToggle(p, "robot")} />
                  </>
                )}
                {g.tools.map((t) =>
                  t.id === "pattern" ? (
                    <Fragment key={t.id}>
                      <ToolButton icon="flipH" label="Mirror" pressed={!!p.mirrorOn} onPress={p.onMirror} />
                      <ToolButton icon={t.icon} label={t.label} pressed={p.tool === t.id && !p.mirrorOn} onPress={() => p.onArmTool(t.id)} />
                    </Fragment>
                  ) : t.id === "construct" ? (
                    <MenuButton
                      key={t.id}
                      label="Construct"
                      entries={constructEntries((k) => p.onConstruct?.(k))}
                      trigger={({ onClick, ...rest }) => <ToolButton {...rest} icon={t.icon} label={t.label} pressed={p.tool === t.id} onPress={onClick} />}
                    />
                  ) : (
                    <ToolButton
                      key={t.id}
                      icon={t.icon}
                      label={t.label}
                      shortcut={t.key && formatCombo(t.key)}
                      pressed={p.tool === t.id}
                      onPress={() => p.onArmTool(t.id)}
                    />
                  ),
                )}
              </span>
            ))}
          </Toolbar>
        </>
      )}
      <span className="bc-grow" />
      {rightSide(p)}
    </header>
  );
}

function undoRedo(p: TopBarProps) {
  return (
    <>
      <Button
        icon="undo"
        title={p.canUndo ? `Undo ${p.undoLabel.toLowerCase()}` : "Undo"}
        shortcut={formatCombo("mod+z")}
        disabled={!p.canUndo}
        onClick={p.onUndo}
      />
      <Button
        icon="redo"
        title={p.canRedo ? `Redo ${p.redoLabel.toLowerCase()}` : "Redo"}
        shortcut={formatCombo("shift+mod+z")}
        disabled={!p.canRedo}
        onClick={p.onRedo}
      />
    </>
  );
}

/** Find, properties, Parameters, Save (or a share's downloads), Help and the account menu, on the bar's right. */
function rightSide(p: TopBarProps) {
  return (
    <>
      <IconButton className="bc-find" icon="search" title={`Find a command (/ or ${formatCombo("mod+k")})`} onClick={p.onPalette} />
      <IconButton className="bc-props-toggle" icon="info" title={p.propsOpen ? "Hide properties" : "Show properties"} on={p.propsOpen} onClick={p.onProps} />
      {!p.shared && <IconButton icon="sliders" title="Parameters" on={!!p.paramsOpen} onClick={p.onParams} />}
      {p.shared ? (
        <>
          <span className="bc-owner">by {p.shared.owner}</span>
          <MenuButton
            label="Download"
            align="end"
            entries={[
              { id: "print", label: "STL, 3MF, STEP or glTF…", icon: "download", onSelect: () => p.onExport?.() },
              { id: "bcad", label: "BetterCad model (.bcad)", icon: "save", onSelect: () => p.onDownloadBcad?.() },
            ]}
            trigger={(t) => <Button {...t} icon="download" label="Download" title="Download this model" />}
          />
          <Button variant="primary" icon="copy" label="Open a copy" title="Open a copy in BetterCad to change it" onClick={p.onOpenCopy} />
        </>
      ) : (
        <>
          <SaveSplit {...p} />
        </>
      )}
      {p.helpEntries && (
        <MenuButton label="Help" align="end" entries={p.helpEntries} trigger={(t) => <Button {...t} icon="help" title="Help" data-help-button="" />} />
      )}
      <MenuButton
        label="Account and settings"
        align="end"
        entries={[
          ...(p.account
            ? [
                { kind: "title" as const, id: "who", label: p.account.name },
                { id: "library", label: "My models", icon: "folder" as const, onSelect: () => go("#/library") },
                { id: "account", label: "Account", icon: "user" as const, onSelect: () => go("#/account") },
                ...(p.account.admin ? [{ id: "admin", label: "Admin", icon: "lock" as const, onSelect: () => go("#/admin") }] : []),
                { id: "signout", label: "Sign out", icon: "close" as const, onSelect: () => p.onSignOut?.() },
              ]
            : p.accountsOn
              ? [{ id: "signin", label: "Sign in", icon: "user" as const, onSelect: () => go("#/signin?next=%23%2F") }]
              : [{ id: "signin", label: "Accounts can't be reached here", icon: "cloudOff" as const, disabled: true, onSelect: () => {} }]),
          { kind: "separator", id: "s1" },
          ...(p.shared ? [] : [{ id: "print", label: "Print settings", icon: "printer" as const, onSelect: () => p.onPanel("print") }]),
          { id: "settings", label: "Settings", icon: "settings" as const, onSelect: () => p.onPanel("settings") },
          ...(p.onInstall ? [{ id: "install", label: "Install BetterCad", icon: "download" as const, onSelect: p.onInstall }] : []),
          { kind: "title", id: "t", label: "Theme" },
        ]}
        trigger={(t) =>
          p.account ? (
            <Button {...t} className="bc-avatar-btn" title={`${p.account.name}: account and settings`}>
              <span className="bc-avatar" aria-hidden>
                {p.account.name.trim().charAt(0).toUpperCase() || "?"}
              </span>
            </Button>
          ) : p.accountsOn ? (
            <Button {...t} icon="user" label="Sign in" title="Account and settings" />
          ) : (
            <Button {...t} icon="user" title="Account and settings" />
          )
        }
      >
        <div className="bc-menu-extra">
          <ThemePicker value={p.theme} onChange={p.onTheme} compact />
        </div>
      </MenuButton>
    </>
  );
}

function browserToggle(p: TopBarProps) {
  return (
    <IconButton
      className="bc-browser-toggle"
      icon="layers"
      title="Browser"
      on={p.panel === "parts"}
      aria-controls="bc-left-panel"
      onClick={() => p.onPanel(p.panel === "parts" ? null : "parts")}
    />
  );
}
