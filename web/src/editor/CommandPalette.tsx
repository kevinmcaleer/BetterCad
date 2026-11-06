import { useEffect, useMemo, useRef, useState } from "react";
import { Icon, cx } from "@bettercad/ui";
import { formatCombo, search, type Command } from "../state/commands";

const RECENT_KEY = "bettercad.recentCommands";

function loadRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}

/** Ctrl+K: find any command by name and run it. Recently used commands come first. */
export function CommandPalette({ open, onClose, commands }: { open: boolean; onClose: () => void; commands: Command[] }) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const before = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open) {
      before.current = document.activeElement as HTMLElement;
      setQuery("");
      setIndex(0);
      setTimeout(() => input.current?.focus(), 0);
    }
  }, [open]);

  const results = useMemo(() => {
    const recent = loadRecent();
    const found = search(commands, query).filter((c) => c.enabled !== false);
    const rank = (c: Command) => {
      const r = recent.indexOf(c.id);
      return r < 0 ? 1000 : r;
    };
    return query ? found : [...found].sort((a, b) => rank(a) - rank(b));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commands, query, open]);

  if (!open) return null;

  const close = () => {
    onClose();
    before.current?.focus?.();
  };
  const run = (c: Command) => {
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify([c.id, ...loadRecent().filter((x) => x !== c.id)].slice(0, 8)));
    } catch {
      /* ignore */
    }
    onClose();
    c.run();
  };

  return (
    <div className="bc-scrim bc-scrim-top" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="bc-palette" role="dialog" aria-modal="true" aria-label="Find a command">
        <div className="bc-palette-search">
          <Icon name="search" />
          <input
            ref={input}
            className="bc-palette-input"
            role="combobox"
            aria-expanded="true"
            aria-controls="bc-palette-list"
            aria-activedescendant={results[index] ? `bc-cmd-${results[index].id}` : undefined}
            aria-label="Command"
            placeholder="Type a command"
            value={query}
            onChange={(e) => {
              setQuery(e.currentTarget.value);
              setIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                close();
              } else if (e.key === "ArrowDown") {
                e.preventDefault();
                setIndex((i) => Math.min(i + 1, results.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setIndex((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter" && results[index]) {
                e.preventDefault();
                run(results[index]);
              }
            }}
          />
        </div>
        <ul id="bc-palette-list" role="listbox" aria-label="Commands" className="bc-palette-list">
          {results.length === 0 && <li className="bc-note">No command matches “{query}”.</li>}
          {results.map((c, i) => (
            <li
              key={c.id}
              id={`bc-cmd-${c.id}`}
              role="option"
              aria-selected={i === index}
              className={cx("bc-menu-item", i === index && "bc-active")}
              onPointerMove={() => setIndex(i)}
              onClick={() => run(c)}
            >
              <span className="bc-menu-icon">{c.icon && <Icon name={c.icon} />}</span>
              <span>{c.label}</span>
              <span className="bc-keys">{c.keys?.[0] ? formatCombo(c.keys[0]) : c.group}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
