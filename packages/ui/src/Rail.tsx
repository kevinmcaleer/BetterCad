import { Icon } from "./Icon";
import type { IconName } from "./icons";

export interface RailItem<T extends string = string> {
  id: T;
  icon: IconName;
  label: string;
  shortcut?: string;
}

export interface RailProps<T extends string> {
  items: RailItem<T>[];
  /** The open panel, or null when the panel is folded away. */
  value: T | null;
  /** Clicking the open item again passes null, so the panel folds. */
  onChange: (id: T | null) => void;
  label?: string;
  /** The id of the panel element the rail controls. */
  controls?: string;
}

/** The icon rail on the editor's left edge. Switches the left panel; clicking the open one folds it. */
export function Rail<T extends string>({ items, value, onChange, label = "Panels", controls }: RailProps<T>) {
  return (
    <nav className="bc-rail" aria-label={label}>
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          className="bc-rail-btn"
          aria-pressed={it.id === value}
          aria-controls={it.id === value ? controls : undefined}
          aria-keyshortcuts={it.shortcut}
          data-tip={it.shortcut ? `${it.label} (${it.shortcut})` : it.label}
          onClick={() => onChange(it.id === value ? null : it.id)}
        >
          <Icon name={it.icon} size={20} />
          <span>{it.label}</span>
        </button>
      ))}
    </nav>
  );
}
