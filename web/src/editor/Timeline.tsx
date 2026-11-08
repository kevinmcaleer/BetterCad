import { useEffect, useRef, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { Icon, IconButton, cx, longPress, type ContextMenuState, type IconName } from "@bettercad/ui";
import type { Feature, PartKind } from "../state/document";
import { formatCombo } from "../state/commands";

export const FEATURE_ICON: Record<Feature["type"], IconName> = {
  add: "cube",
  duplicate: "copy",
  pattern: "distributeH",
  move: "move",
  resize: "resize",
  delete: "trash",
  sketch: "sketch",
  extrude: "extrude",
  combine: "combine",
  fillet: "fillet",
  chamfer: "chamfer",
  shell: "shell",
  pushpull: "pushpull",
  revolve: "revolve",
  hole: "hole",
  import: "upload",
  insert: "screw",
  mount: "hole",
  gear: "gear",
};

/** The icon for a kind of part. */
export function partIcon(kind: PartKind): IconName {
  return kind === "box" ? "cube" : kind === "solid" ? "extrude" : kind;
}

/** The tile icon: an Add shows the shape it adds. */
export function featureIcon(f: Feature): IconName {
  if (f.type === "add") return partIcon(f.part.kind);
  return FEATURE_ICON[f.type];
}

export interface TimelineProps {
  features: Feature[];
  /** The marker: how many features are built. features.length when not rolled back. */
  at: number;
  onMarker: (at: number) => void;
  /** Features that failed to build, with the reason. */
  failed: Map<string, string>;
  activeId: string | null;
  summary: (f: Feature) => string;
  onSelect: (f: Feature) => void;
  onMenu: (f: Feature, at: ContextMenuState) => void;
  /** Opens a step to change it: a double-click or double-tap on its tile. */
  onEdit?: (f: Feature) => void;
  /** The same steps as a list, in the left panel. */
  onHistory?: () => void;
  historyOpen?: boolean;
  /** Shown above the steps while a change lands before later steps: changing an earlier one, or adding while rolled back. */
  warning?: string | null;
}

/** Two clicks or taps on the same tile within this many milliseconds open it to edit. */
export const DOUBLE_TAP_MS = 400;

/**
 * The Fusion-style timeline along the bottom of the stage: one tile per feature in order, a marker you drag to roll
 * the model back, and play controls. Features after the marker are greyed and not built.
 *
 * The marker is one element that never moves in the DOM; CSS `order` places it between the tiles. Moving it between
 * tile wrappers would remount it at every step, which drops its pointer capture and focus, so a drag stopped after
 * one step.
 */
export function Timeline({ features, at, onMarker, failed, activeId, summary, onSelect, onMenu, onEdit, onHistory, historyOpen, warning }: TimelineProps) {
  const strip = useRef<HTMLDivElement>(null);
  const marker = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const lastTap = useRef<{ id: string; t: number } | null>(null);
  const n = features.length;
  const rolledBack = at < n;

  // Keep the marker in view as it moves.
  useEffect(() => {
    marker.current?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [at, n]);

  /** The gap nearest a pointer: the number of tiles whose centre is left of it. */
  const gapAt = (clientX: number) => {
    const tiles = strip.current?.querySelectorAll<HTMLElement>(".bc-tl-tile") ?? [];
    let i = 0;
    tiles.forEach((t) => {
      const r = t.getBoundingClientRect();
      if (clientX > r.left + r.width / 2) i += 1;
    });
    return i;
  };

  const onMarkerKey = (e: KeyboardEvent) => {
    const to = { ArrowLeft: at - 1, ArrowRight: at + 1, Home: 0, End: n }[e.key];
    if (to === undefined || e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    e.stopPropagation();
    onMarker(Math.max(0, Math.min(n, to)));
  };

  const startDrag = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    dragging.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    e.currentTarget.focus();
  };
  /** Follows the pointer across as many steps as it passes in one drag. */
  const drag = (e: PointerEvent) => {
    if (!dragging.current) return;
    const to = gapAt(e.clientX);
    if (to !== at) onMarker(to);
  };
  const endDrag = () => {
    dragging.current = false;
  };

  /** A click on a tile selects it; a second click or tap on the same tile soon after opens it to edit. */
  const tileClick = (f: Feature, e: MouseEvent) => {
    onSelect(f);
    if (!onEdit) return;
    // A keyboard click (Enter, Space) has no detail; only pointer clicks make a double.
    if (e.detail === 0) return;
    const now = e.timeStamp || performance.now();
    const last = lastTap.current;
    if (e.detail >= 2 || (last && last.id === f.id && now - last.t < DOUBLE_TAP_MS)) {
      lastTap.current = null;
      onEdit(f);
      return;
    }
    lastTap.current = { id: f.id, t: now };
  };

  const after = (i: number) => (i === 0 ? "the start" : features[i - 1]!.name);
  const markerEl = (
    <div
      ref={marker}
      className="bc-tl-marker"
      role="slider"
      tabIndex={0}
      aria-label="Timeline marker"
      aria-orientation="horizontal"
      aria-valuemin={0}
      aria-valuemax={n}
      aria-valuenow={at}
      aria-valuetext={at === n ? "At the end, every step is built" : `Rolled back to after ${after(at)}`}
      data-tip={`Drag to roll back (${formatCombo("alt+arrowleft")} ${formatCombo("alt+arrowright")})`}
      style={{ order: 2 * at }}
      onKeyDown={onMarkerKey}
      onPointerDown={startDrag}
      onPointerMove={drag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
    />
  );

  return (
    <section className={cx("bc-timeline", rolledBack && "bc-rolled-back", warning && "bc-tl-warned")} aria-label="Timeline">
      {warning && (
        <p className="bc-tl-warn" role="status">
          <Icon name="warning" size={14} />
          <span>{warning}</span>
        </p>
      )}
      <div className="bc-tl-play" role="group" aria-label="Play controls">
        <IconButton icon="skipStart" title="Roll back to the start" disabled={at === 0} onClick={() => onMarker(0)} />
        <IconButton icon="stepBack" title={`Step back (${formatCombo("alt+arrowleft")})`} disabled={at === 0} onClick={() => onMarker(at - 1)} />
        <IconButton icon="stepForward" title={`Step forward (${formatCombo("alt+arrowright")})`} disabled={at === n} onClick={() => onMarker(at + 1)} />
        <IconButton icon="skipEnd" title="Go to the end" disabled={at === n} onClick={() => onMarker(n)} />
      </div>
      <div
        ref={strip}
        className="bc-tl-strip"
        onWheel={(e) => {
          if (strip.current && Math.abs(e.deltaY) > Math.abs(e.deltaX)) strip.current.scrollLeft += e.deltaY;
        }}
        onPointerDown={(e) => {
          // A click on the strip between tiles moves the marker there.
          if (e.button === 0 && e.target === e.currentTarget && n) onMarker(gapAt(e.clientX));
        }}
      >
        {n === 0 && <span className="bc-tl-empty">Each step you take shows here, in order.</span>}
        {n > 0 && markerEl}
        {features.map((f, i) => {
          const why = failed.get(f.id);
          const state = [i >= at && "not built", f.suppressed && "suppressed", why && `problem: ${why}`].filter(Boolean).join(", ");
          const press = longPress((p) => onMenu(f, p));
          return (
            <button
              key={f.id}
              type="button"
              className={cx("bc-tl-tile", f.id === activeId && "bc-on", i >= at && "bc-after", f.suppressed && "bc-suppressed", why && "bc-failed")}
              aria-pressed={f.id === activeId}
              aria-label={`${f.name}, ${summary(f)}${state ? `, ${state}` : ""}`}
              data-tip={`${f.name} · ${summary(f)}${why ? `. ${why}` : ""}${onEdit ? ". Double-click to edit" : ""}`}
              style={{ order: 2 * i + 1 }}
              onClick={(e) => tileClick(f, e)}
              onContextMenu={(e) => {
                e.preventDefault();
                onSelect(f);
                onMenu(f, { x: e.clientX, y: e.clientY });
              }}
              onKeyDown={(e) => {
                if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
                  e.preventDefault();
                  const r = e.currentTarget.getBoundingClientRect();
                  onMenu(f, { x: r.left, y: r.top });
                }
              }}
              {...press}
            >
              <Icon name={featureIcon(f)} size={16} />
            </button>
          );
        })}
      </div>
      <span className="bc-tl-summary" aria-hidden="true">
        {n === 0 ? "No steps yet" : rolledBack ? `Step ${at} of ${n}` : `${n} ${n === 1 ? "step" : "steps"}`}
      </span>
      {onHistory && <IconButton icon="history" title="History" on={!!historyOpen} onClick={onHistory} />}
    </section>
  );
}
