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
  value: T;
  onChange: (id: T) => void;
  label?: string;
}

/** The icon rail on the editor's left edge. Switches the left panel. */
export function Rail<T extends string>({ items, value, onChange, label = "Panels" }: RailProps<T>) {
  return (
    <nav className="bc-rail" aria-label={label}>
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          className="bc-rail-btn"
          aria-pressed={it.id === value}
          title={it.shortcut ? `${it.label} (${it.shortcut})` : it.label}
          onClick={() => onChange(it.id)}
        >
          <Icon name={it.icon} size={20} />
          <span>{it.label}</span>
        </button>
      ))}
    </nav>
  );
}
