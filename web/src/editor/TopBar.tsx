import { Button, Icon, IconButton, MenuButton, Separator, cx, type MenuEntry } from "@bettercad/ui";
import type { Status } from "./useStatus";
import type { ThemeSetting } from "../state/theme";
import { formatCombo } from "../state/commands";
import { ThemePicker } from "./ThemePicker";

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
        onChange={(e) => p.onRename(e.currentTarget.value)}
        onBlur={p.onRenameDone}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        spellCheck={false}
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
      <span className={cx("bc-status", p.status.bad && "bc-bad")} role={p.status.bad ? "alert" : "status"} aria-live={p.status.bad ? "assertive" : "polite"}>
        {p.status.text}
      </span>
      <span className="bc-grow" />
      <Button className="bc-find" icon="search" label="Find a command" title="Find a command" shortcut={formatCombo("mod+k")} onClick={p.onPalette} />
      <IconButton className="bc-props-toggle" icon="list" title={p.propsOpen ? "Hide properties" : "Show properties"} on={p.propsOpen} onClick={p.onProps} />
      <MenuButton
        label="Save"
        align="end"
        entries={p.saveEntries}
        trigger={(t) => <Button {...t} variant="primary" icon="save" label="Save" title="Save your model" />}
      />
      <MenuButton
        label="Account and theme"
        align="end"
        entries={[
          { id: "signin", label: "Sign in (coming with accounts)", icon: "user", disabled: true, onSelect: () => {} },
          { kind: "separator", id: "s1" },
          { kind: "title", id: "t", label: "Theme" },
        ]}
        trigger={(t) => <Button {...t} icon="user" title="Account and theme" />}
      >
        <div className="bc-menu-extra">
          <ThemePicker value={p.theme} onChange={p.onTheme} compact />
        </div>
      </MenuButton>
    </header>
  );
}
