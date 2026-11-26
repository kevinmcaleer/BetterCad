import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Icon, IconButton, RibbonButton, overlayRoot, useEscape, type IconName } from "@bettercad/ui";
import type { Registry } from "../state/commands";
import { formatCombo } from "../state/commands";
import type { ToolId } from "./tools";
import type { PanelId } from "./LeftPanel";
import type { RibbonTab } from "./ribbonPrefs";
import { RIBBON, SHORT, isPressed, sectionItems } from "./Ribbon";
import "./moreTools.css";

type Tab = Exclude<RibbonTab, "sketch">;

const TABS: [Tab, string][] = [
  ["model", "Model"],
  ["assemble", "Assemble"],
  ["inspect", "Inspect"],
  ["drawing", "Drawing"],
  ["render", "Render"],
  ["electronics", "Electronics"],
];

// Render has no tools of its own on the ribbon: choosing it opens the Render view, as on the desktop ribbon.
const RENDER = "view.render";

// The tab you last looked at, while the page stays open.
let lastTab: Tab = "model";

export interface MoreToolsProps {
  registry: Registry;
  tool: ToolId;
  mirrorOn?: boolean;
  panel: PanelId | null;
  /** The model's drawings, for the Drawing tab's Open group. */
  drawings: { id: string; name: string }[];
  onOpenDrawing: (id: string) => void;
  /** Find a command: the palette, for anything not on a tab. */
  onFind: () => void;
  onClose: () => void;
}

/**
 * The ribbon on a phone or tablet: a sheet from the compact tool bar's More tools button, with the ribbon's tabs and
 * every tool of each group as a big button. A tool runs and the sheet closes.
 */
export function MoreTools({ registry, tool, mirrorOn, panel, drawings, onOpenDrawing, onFind, onClose }: MoreToolsProps) {
  useSyncExternalStore(registry.subscribe, registry.version);
  const [tab, setTab] = useState<Tab>(lastTab);
  const sheet = useRef<HTMLDivElement>(null);
  useEscape(true, onClose);

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    sheet.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
    return () => before?.focus?.();
  }, []);

  const run = (fn: () => void) => {
    onClose();
    fn();
  };
  const canRender = !!registry.get(RENDER) && registry.enabled(RENDER);
  const tabs = TABS.filter(([id]) => id !== "render" || canRender);
  const pick = (t: Tab) => {
    if (t !== "render") lastTab = t;
    setTab(t);
  };
  // Arrow keys move between tabs, as in any tab list.
  const onTabKey = (e: KeyboardEvent) => {
    const i = tabs.findIndex(([id]) => id === tab);
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = tabs[(i + step + tabs.length) % tabs.length]![0];
    pick(next);
    sheet.current?.querySelector<HTMLElement>(`#bc-more-tab-${next}`)?.focus();
  };

  return createPortal(
    <div className="bc-scrim bc-more-scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={sheet} className="bc-more" role="dialog" aria-modal="true" aria-label="More tools">
        <div className="bc-more-head">
          <div className="bc-more-tabs" role="tablist" aria-label="Tool tabs" onKeyDown={onTabKey}>
            {tabs.map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                id={`bc-more-tab-${id}`}
                className="bc-tab"
                aria-selected={tab === id}
                aria-controls="bc-more-tools"
                tabIndex={tab === id ? 0 : -1}
                onClick={() => (id === "render" ? run(() => registry.run(RENDER)) : pick(id))}
              >
                {label}
              </button>
            ))}
          </div>
          <IconButton icon="close" title="Close" onClick={onClose} />
        </div>
        <div className="bc-more-body" id="bc-more-tools" role="tabpanel" aria-labelledby={`bc-more-tab-${tab}`}>
          {RIBBON[tab].map((g) => {
            const items = g.sections.flatMap(([, list]) => sectionItems(list, registry));
            if (!items.length) return null;
            return (
              <section key={g.id} className="bc-more-group" aria-label={g.label}>
                <h3 className="bc-more-name">{g.label}</h3>
                <div className="bc-more-grid">
                  {items.map((it) => {
                    const c = registry.get(it.id)!;
                    return (
                      <RibbonButton
                        key={it.id}
                        icon={(c.icon ?? "more") as IconName}
                        colour={it.colour ?? true}
                        label={c.label}
                        short={it.short ?? SHORT[it.id] ?? c.label}
                        shortcut={c.keys?.[0] && formatCombo(c.keys[0])}
                        pressed={isPressed(it.id, tool, mirrorOn, panel)}
                        disabled={!registry.enabled(it.id)}
                        onPress={() => run(() => registry.run(it.id))}
                      />
                    );
                  })}
                </div>
              </section>
            );
          })}
          {tab === "render" && canRender && (
            <section className="bc-more-group" aria-label="Show">
              <h3 className="bc-more-name">Show</h3>
              <div className="bc-more-grid">
                <RibbonButton icon="sun" colour="camera" label="Open the Render view" short="Render" onPress={() => run(() => registry.run(RENDER))} />
              </div>
            </section>
          )}
          {tab === "drawing" && (
            <section className="bc-more-group" aria-label="Open">
              <h3 className="bc-more-name">Open</h3>
              {drawings.length ? (
                <div className="bc-more-grid">
                  {drawings.map((d) => (
                    <RibbonButton
                      key={d.id}
                      icon="drawing"
                      colour="drawingOpen"
                      label={`Open ${d.name}`}
                      short={d.name}
                      onPress={() => run(() => onOpenDrawing(d.id))}
                    />
                  ))}
                </div>
              ) : (
                <p className="bc-note">This model has no drawings yet.</p>
              )}
            </section>
          )}
        </div>
        <button type="button" className="bc-more-find" onClick={() => run(onFind)}>
          <Icon name="search" />
          Find a command
        </button>
      </div>
    </div>,
    overlayRoot(),
  );
}
