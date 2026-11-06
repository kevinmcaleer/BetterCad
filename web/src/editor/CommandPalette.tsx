import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon, cx, overlayRoot, useEscape } from "@bettercad/ui";
import { formatCombo, search, type Command } from "../state/commands";

const RECENT_KEY = "bettercad.recentCommands";

function loadRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  commands: Command[];
  isEnabled: (id: string) => boolean;
  run: (id: string) => void;
}

/** Ctrl+K (⌘K): find any command by typing part of its name, and run it. Recently used commands come first. */
export function CommandPalette({ open, onClose, commands, isEnabled, run }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const before = useRef<HTMLElement | null>(null);

  const close = () => {
    onClose();
    before.current?.focus?.();
  };
  useEscape(open, close);

  useEffect(() => {
    if (open) {
      before.current = document.activeElement as HTMLElement;
      setQuery("");
      setIndex(0);
      setTimeout(() => input.current?.focus(), 0);
    }
  }, [open]);

  const results = useMemo(() => {
    if (!open) return [];
    const usable = commands.filter((c) => isEnabled(c.id));
    if (query) return search(usable, query);
    const recent = loadRecent();
    const rank = (c: Command) => (recent.includes(c.id) ? recent.indexOf(c.id) : 1000);
    return [...usable].sort((a, b) => rank(a) - rank(b));
  }, [commands, query, open, isEnabled]);

  if (!open) return null;

  const pick = (c: Command) => {
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify([c.id, ...loadRecent().filter((x) => x !== c.id)].slice(0, 8)));
    } catch {
      /* storage blocked: no recents */
    }
    onClose();
    run(c.id);
  };

  return createPortal(
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
            aria-autocomplete="list"
            aria-activedescendant={results[index] ? `bc-cmd-${results[index].id}` : undefined}
            aria-label="Command"
            placeholder="Type a command"
            value={query}
            onChange={(e) => {
              setQuery(e.currentTarget.value);
              setIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setIndex((i) => Math.min(i + 1, results.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setIndex((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter" && results[index]) {
                e.preventDefault();
                pick(results[index]);
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
              onClick={() => pick(c)}
            >
              <span className="bc-menu-icon">{c.icon && <Icon name={c.icon} />}</span>
              <span>{c.label}</span>
              <span className="bc-keys">{c.keys?.[0] ? formatCombo(c.keys[0]) : c.group}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>,
    overlayRoot(),
  );
}
