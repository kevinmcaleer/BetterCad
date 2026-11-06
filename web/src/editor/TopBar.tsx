import { useRef, useState } from "react";
import { Button, Icon, Menu, Separator, cx, type MenuEntry } from "@bettercad/ui";
import type { Status } from "./useStatus";
import type { ThemeSetting } from "../state/theme";
import { formatCombo } from "../state/commands";

export interface TopBarProps {
  name: string;
  onRename: (name: string) => void;
  onRenameDone: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  status: Status;
  onSave: () => void;
  onOpen: () => void;
  onNew: () => void;
  onPalette: () => void;
  themeSetting: ThemeSetting;
  onTheme: (t: ThemeSetting) => void;
  themeLabels: Record<ThemeSetting, string>;
}

export function TopBar(p: TopBarProps) {
  const [fileOpen, setFileOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const fileBtn = useRef<HTMLButtonElement>(null);
  const accountBtn = useRef<HTMLButtonElement>(null);

  const fileEntries: MenuEntry[] = [
    { id: "save", label: "Save to disk", icon: "download", keys: formatCombo("mod+s"), onSelect: p.onSave },
    { id: "open", label: "Open from disk…", icon: "folder", keys: formatCombo("mod+o"), onSelect: p.onOpen },
    { id: "new", label: "New model", icon: "plus", onSelect: p.onNew },
    { kind: "separator", id: "s1" },
    { id: "cloud", label: "Save to my account (coming soon)", icon: "upload", disabled: true, onSelect: () => {} },
  ];
  const accountEntries: MenuEntry[] = [
    { id: "signin", label: "Sign in (coming soon)", icon: "user", disabled: true, onSelect: () => {} },
    { kind: "separator", id: "s1" },
    { kind: "title", id: "t", label: "Theme" },
    ...(Object.keys(p.themeLabels) as ThemeSetting[]).map<MenuEntry>((t) => ({
      id: `theme-${t}`,
      label: p.themeLabels[t],
      checked: p.themeSetting === t,
      onSelect: () => p.onTheme(t),
    })),
  ];

  return (
    <header className="bc-top" role="banner">
      <span className="bc-title">
        <Icon name="cube" size={18} />
        <span className="bc-brand">BetterCad</span>
      </span>
      <input
        className="bc-text bc-docname"
        aria-label="Model name"
        value={p.name}
        onChange={(e) => p.onRename(e.currentTarget.value)}
        onBlur={p.onRenameDone}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        spellCheck={false}
      />
      <Separator />
      <Button icon="undo" title="Undo" shortcut={formatCombo("mod+z")} disabled={!p.canUndo} onClick={p.onUndo} />
      <Button icon="redo" title="Redo" shortcut={formatCombo("shift+mod+z")} disabled={!p.canRedo} onClick={p.onRedo} />
      <span className={cx("bc-status", p.status.bad && "bc-bad")} role="status" aria-live="polite">
        {p.status.text}
      </span>
      <span className="bc-grow" />
      <Button className="bc-find" icon="search" label="Find a command" title="Find a command" shortcut={formatCombo("mod+k")} onClick={p.onPalette} />
      <div className="bc-anchor">
        <Button
          ref={fileBtn}
          kind="done"
          icon="save"
          label="Save"
          title="Save"
          aria-haspopup="menu"
          aria-expanded={fileOpen}
          onClick={() => setFileOpen((o) => !o)}
        />
        <Menu
          open={fileOpen}
          onClose={() => {
            setFileOpen(false);
            fileBtn.current?.focus();
          }}
          label="Save"
          entries={fileEntries}
          className="bc-menu-right"
        />
      </div>
      <div className="bc-anchor">
        <Button
          ref={accountBtn}
          icon="user"
          title="Account and theme"
          aria-haspopup="menu"
          aria-expanded={accountOpen}
          onClick={() => setAccountOpen((o) => !o)}
        />
        <Menu
          open={accountOpen}
          onClose={() => {
            setAccountOpen(false);
            accountBtn.current?.focus();
          }}
          label="Account"
          entries={accountEntries}
          className="bc-menu-right"
        />
      </div>
    </header>
  );
}
