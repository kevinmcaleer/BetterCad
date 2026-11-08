import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { ESC, Icon, IconButton, cx, longPress, useEscape, type ContextMenuState, type IconName } from "@bettercad/ui";
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
  link: "link",
  joint: "joint",
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
  /** Drag a tile to move its step before another (null for the end). */
  onReorder?: (id: string, beforeId: string | null) => void;
  /** Why a step can't go before another, shown while it is dragged there, or null when it can. */
  moveProblem?: (id: string, beforeId: string | null) => string | null;
}

/** How far, in pixels, a tile must be dragged before it starts to move rather than being clicked. */
export const DRAG_START_PX = 6;

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
export function Timeline({
  features,
  at,
  onMarker,
  failed,
  activeId,
  summary,
  onSelect,
  onMenu,
  onEdit,
  onHistory,
  historyOpen,
  warning,
  onReorder,
  moveProblem,
}: TimelineProps) {
  const strip = useRef<HTMLDivElement>(null);
  const marker = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const lastTap = useRef<{ id: string; t: number } | null>(null);
  /** A tile pressed with the mouse or a pen, which becomes a reorder once it moves far enough. */
  const press = useRef<{ id: string; x: number } | null>(null);
  /** A reorder drag ended on this tile, so the click that follows is not a click. */
  const swallowClick = useRef(false);
  /** The step being dragged and the gap it would drop into (0 is before the first step). */
  const [moving, setMoving] = useState<{ id: string; gap: number } | null>(null);
  const n = features.length;
  const rolledBack = at < n;

  const stopMoving = () => {
    press.current = null;
    setMoving(null);
  };
  useEscape(moving !== null, stopMoving, ESC.drag);

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

  /** Where a drop into `gap` puts the step: before the step now there, or the end. Null when it would not move. */
  const dropTarget = (id: string, gap: number): { beforeId: string | null } | null => {
    const from = features.findIndex((f) => f.id === id);
    if (from < 0 || gap === from || gap === from + 1) return null;
    return { beforeId: features[gap]?.id ?? null };
  };
  const target = moving ? dropTarget(moving.id, moving.gap) : null;
  const blocked = moving && target ? (moveProblem?.(moving.id, target.beforeId) ?? null) : null;
  const shown = moving && blocked ? `${blocked}, so it can't go there` : warning;

  const tileDown = (f: Feature, e: PointerEvent<HTMLButtonElement>) => {
    if (onReorder && e.button === 0 && e.pointerType !== "touch") press.current = { id: f.id, x: e.clientX };
  };
  const tileMove = (e: PointerEvent<HTMLButtonElement>) => {
    const p = press.current;
    if (!p) return;
    if (!moving) {
      if (Math.abs(e.clientX - p.x) < DRAG_START_PX) return;
      e.currentTarget.setPointerCapture?.(e.pointerId);
    }
    // Near either end of the strip, scroll it so a step can travel past what's in view.
    const s = strip.current;
    if (s) {
      const r = s.getBoundingClientRect();
      if (e.clientX < r.left + 24) s.scrollLeft -= 8;
      else if (e.clientX > r.right - 24) s.scrollLeft += 8;
    }
    const gap = gapAt(e.clientX);
    if (!moving || moving.gap !== gap) setMoving({ id: p.id, gap });
  };
  const tileUp = () => {
    if (moving) {
      swallowClick.current = true;
      if (target && !blocked) onReorder?.(moving.id, target.beforeId);
    }
    stopMoving();
  };

  /** A click on a tile selects it; a second click or tap on the same tile soon after opens it to edit. */
  const tileClick = (f: Feature, e: MouseEvent) => {
    if (swallowClick.current) {
      swallowClick.current = false;
      return;
    }
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

  /** ". Double-click to edit, drag to reorder", for each that applies. */
  const how = [onEdit && "double-click to edit", onReorder && "drag to reorder"].filter(Boolean).join(", ");
  const tipHow = how ? `. ${how[0]!.toUpperCase()}${how.slice(1)}` : "";
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
    <section className={cx("bc-timeline", rolledBack && "bc-rolled-back", shown && "bc-tl-warned")} aria-label="Timeline">
      {shown && (
        <p className="bc-tl-warn" role="status">
          <Icon name="warning" size={14} />
          <span>{shown}</span>
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
        {moving && target && <div className={cx("bc-tl-drop", blocked && "bc-blocked")} style={{ order: 2 * moving.gap }} aria-hidden="true" />}
        {features.map((f, i) => {
          const why = failed.get(f.id);
          const state = [i >= at && "not built", f.suppressed && "suppressed", why && `problem: ${why}`].filter(Boolean).join(", ");
          const hold = longPress((p) => onMenu(f, p));
          return (
            <button
              key={f.id}
              type="button"
              className={cx(
                "bc-tl-tile",
                f.id === activeId && "bc-on",
                i >= at && "bc-after",
                f.suppressed && "bc-suppressed",
                why && "bc-failed",
                moving?.id === f.id && "bc-moving",
              )}
              aria-pressed={f.id === activeId}
              aria-label={`${f.name}, ${summary(f)}${state ? `, ${state}` : ""}`}
              data-tip={`${f.name} · ${summary(f)}${why ? `. ${why}` : ""}${tipHow}`}
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
              onPointerDown={(e) => {
                hold.onPointerDown(e);
                tileDown(f, e);
              }}
              onPointerMove={(e) => {
                hold.onPointerMove(e);
                tileMove(e);
              }}
              onPointerUp={() => {
                hold.onPointerUp();
                tileUp();
              }}
              onPointerCancel={() => {
                hold.onPointerCancel();
                stopMoving();
              }}
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
