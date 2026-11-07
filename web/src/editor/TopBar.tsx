import { Button, Icon, IconButton, MenuButton, Separator, cx, type MenuEntry } from "@bettercad/ui";
import type { Status } from "./useStatus";
import type { ThemeSetting } from "../state/theme";
import { formatCombo } from "../state/commands";
import { ThemePicker } from "./ThemePicker";
import type { CloudState } from "../files/useFiles";
import { go } from "../cloud/route";

const CLOUD_TEXT: Record<CloudState, string> = {
  saved: "Saved to your account",
  saving: "Saving to your account…",
  dirty: "Changes not saved to your account yet",
  offline: "Offline: saves when you're back",
  error: "Not saved to your account",
};

export interface TopBarProps {
  name: string;
  onRename: (name: string) => void;
  onRenameDone: () => void;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string;
  redoLabel: string;
  onUndo: () => void;
  onRedo: () => void;
  status: Status;
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

export function TopBar(p: TopBarProps) {
  return (
    <header className="bc-top">
      <span className="bc-title">
        <Icon name="cube" size={18} />
        <span className="bc-brand">BetterCad</span>
      </span>
      <input
        className="bc-text bc-docname"
        aria-label="Model name"
        value={p.name}
        readOnly={!!p.shared}
        onChange={(e) => p.onRename(e.currentTarget.value)}
        onBlur={p.onRenameDone}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        spellCheck={false}
      />
      {p.cloud && (
        <IconButton
          className={cx("bc-cloud", (p.cloud === "error" || p.cloud === "offline") && "bc-bad")}
          icon={p.cloud === "offline" ? "cloudOff" : "cloud"}
          title={`${CLOUD_TEXT[p.cloud]}. Version history`}
          onClick={p.onHistory}
        />
      )}
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
      <span className={cx("bc-status", p.status.bad && "bc-bad")} role={p.status.bad ? "alert" : "status"} aria-live={p.status.bad ? "assertive" : "polite"}>
        {p.status.text}
      </span>
      <span className="bc-grow" />
      <Button className="bc-find" icon="search" label="Find a command" title="Find a command" shortcut={formatCombo("mod+k")} onClick={p.onPalette} />
      <IconButton className="bc-props-toggle" icon="list" title={p.propsOpen ? "Hide properties" : "Show properties"} on={p.propsOpen} onClick={p.onProps} />
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
        label="Account and theme"
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
          { kind: "title", id: "t", label: "Theme" },
        ]}
        trigger={(t) =>
          p.account ? (
            <Button {...t} className="bc-avatar-btn" title={`${p.account.name}: account and theme`}>
              <span className="bc-avatar" aria-hidden>
                {p.account.name.trim().charAt(0).toUpperCase() || "?"}
              </span>
            </Button>
          ) : p.accountsOn ? (
            <Button {...t} icon="user" label="Sign in" title="Account and theme" />
          ) : (
            <Button {...t} icon="user" title="Account and theme" />
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
