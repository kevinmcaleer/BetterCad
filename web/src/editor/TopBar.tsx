import { Button, Icon, IconButton, MenuButton, Separator, ToolButton, Toolbar, cx, type MenuEntry } from "@bettercad/ui";
import type { ThemeSetting } from "../state/theme";
import { formatCombo } from "../state/commands";
import { ThemePicker } from "./ThemePicker";
import type { CloudState } from "../files/useFiles";
import { go } from "../cloud/route";
import { TOOL_GROUPS, type ToolId } from "./tools";
import type { PanelId } from "./LeftPanel";

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
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string;
  redoLabel: string;
  onUndo: () => void;
  onRedo: () => void;
  saveEntries: MenuEntry[];
  onPalette: () => void;
  theme: ThemeSetting;
  onTheme: (t: ThemeSetting) => void;
  /** Under 900px: the button that opens the props sheet. */
  onProps: () => void;
  propsOpen: boolean;
  /** Signed in (#88): who. Null when signed out. */
  account?: { name: string } | null;
  /** False when there is no server to sign in to. */
  accountsOn?: boolean;
  /** The model is saved to the account (#90): how that stands. */
  cloud?: CloudState | null;
  /** The cloud icon opens the version history (#91). */
  onHistory?: () => void;
  /** Set when the model can be shared (#92). */
  onShare?: () => void;
  onSignOut?: () => void;
  /** A share link is open: read-only, with downloads and a way to make it yours. */
  shared?: { owner: string } | null;
  onOpenCopy?: () => void;
  onDownloadBcad?: () => void;
  onExport?: () => void;
  /** Help (#110): shortcuts, the tour, the course, reports and About. */
  helpEntries?: MenuEntry[];
}

/** The panels a top-bar button opens: pressing it again goes back to the browser. */
const panelToggle = (p: TopBarProps, id: PanelId) => () => p.onPanel(p.panel === id ? "parts" : id);

export function TopBar(p: TopBarProps) {
  return (
    <header className="bc-top">
      <span className="bc-title">
        <Icon name="cube" size={18} />
        <span className="bc-brand">BetterCad</span>
      </span>
      <IconButton
        className="bc-browser-toggle"
        icon="layers"
        title="Browser"
        on={p.panel === "parts"}
        aria-controls="bc-left-panel"
        onClick={() => p.onPanel(p.panel === "parts" ? null : "parts")}
      />
      <Separator />
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
      {!p.shared && (
        <>
          <Separator />
          <Toolbar label="Model tools" className="bc-top-tools">
            {TOOL_GROUPS.map((g, i) => (
              <span key={g.id} className="bc-tool-group" role="group" aria-label={g.label}>
                {i > 0 && <Toolbar.Separator />}
                {g.id === "make" && <ToolButton icon="shapes" label="Library" pressed={p.panel === "library"} onPress={panelToggle(p, "library")} />}
                {g.tools.map((t) => (
                  <ToolButton
                    key={t.id}
                    icon={t.icon}
                    label={t.label}
                    shortcut={t.key?.toUpperCase()}
                    pressed={p.tool === t.id}
                    onPress={() => p.onArmTool(t.id)}
                  />
                ))}
              </span>
            ))}
          </Toolbar>
        </>
      )}
      <span className="bc-grow" />
      <IconButton className="bc-find" icon="search" title={`Find a command (${formatCombo("mod+k")})`} onClick={p.onPalette} />
      <IconButton className="bc-props-toggle" icon="list" title={p.propsOpen ? "Hide properties" : "Show properties"} on={p.propsOpen} onClick={p.onProps} />
      {!p.shared && (
        <>
          <IconButton icon="sliders" title="Parameters" on={p.panel === "params"} onClick={panelToggle(p, "params")} />
          <IconButton icon="printer" title="Print" on={p.panel === "print"} onClick={panelToggle(p, "print")} />
        </>
      )}
      {p.cloud && (
        <IconButton
          className={cx("bc-cloud", (p.cloud === "error" || p.cloud === "offline") && "bc-bad")}
          icon={p.cloud === "offline" ? "cloudOff" : "cloud"}
          title={`${CLOUD_TEXT[p.cloud]}. Version history`}
          onClick={p.onHistory}
        />
      )}
      {p.shared ? (
        <>
          <span className="bc-owner">by {p.shared.owner}</span>
          <MenuButton
            label="Download"
            align="end"
            entries={[
              { id: "print", label: "STL, 3MF or STEP…", icon: "download", onSelect: () => p.onExport?.() },
              { id: "bcad", label: "BetterCad model (.bcad)", icon: "save", onSelect: () => p.onDownloadBcad?.() },
            ]}
            trigger={(t) => <Button {...t} icon="download" label="Download" title="Download this model" />}
          />
          <Button variant="primary" icon="copy" label="Open a copy" title="Open a copy in BetterCad to change it" onClick={p.onOpenCopy} />
        </>
      ) : (
        <>
          {p.onShare && <Button icon="share" label="Share" title="Share a view-only link" onClick={p.onShare} />}
          <MenuButton
            label="Save"
            align="end"
            entries={p.saveEntries}
            trigger={(t) => <Button {...t} variant="primary" icon="save" label="Save" title="Save your model" />}
          />
        </>
      )}
      {p.helpEntries && <MenuButton label="Help" align="end" entries={p.helpEntries} trigger={(t) => <Button {...t} icon="info" title="Help" />} />}
      <MenuButton
        label="Account and settings"
        align="end"
        entries={[
          ...(p.account
            ? [
                { kind: "title" as const, id: "who", label: p.account.name },
                { id: "library", label: "My models", icon: "folder" as const, onSelect: () => go("#/library") },
                { id: "account", label: "Account", icon: "user" as const, onSelect: () => go("#/account") },
                { id: "signout", label: "Sign out", icon: "close" as const, onSelect: () => p.onSignOut?.() },
              ]
            : p.accountsOn
              ? [{ id: "signin", label: "Sign in", icon: "user" as const, onSelect: () => go("#/signin?next=%23%2F") }]
              : [{ id: "signin", label: "Accounts can't be reached here", icon: "cloudOff" as const, disabled: true, onSelect: () => {} }]),
          { kind: "separator", id: "s1" },
          { id: "settings", label: "Settings", icon: "settings" as const, onSelect: () => p.onPanel("settings") },
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
    </header>
  );
}
