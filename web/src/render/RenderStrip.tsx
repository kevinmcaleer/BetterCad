import { useState, useSyncExternalStore } from "react";
import { Button, ContextMenu, Dialog, Icon, type ContextMenuState, type MenuEntry } from "@bettercad/ui";
import type { RenderShot } from "@bettercad/kernel/document";
import type { Job, RenderJobs } from "./jobs";

const useJobs = (jobs: RenderJobs) => useSyncExternalStore(jobs.subscribe, jobs.get);

export interface RenderStripProps {
  jobs: RenderJobs;
  shots: RenderShot[];
  /** The key each shot's picture would have now: a picture made from another key is out of date. */
  keyOf: (s: RenderShot) => string;
  /** Adds the Render view's current shot to the strip. */
  onAdd?: () => void;
  onRerender: (s: RenderShot) => void;
  /** Puts the Render view on this shot: its camera, light, background and finish. */
  onUse?: (s: RenderShot) => void;
  onChange: (s: RenderShot) => void;
  onDelete: (s: RenderShot) => void;
  onSave: (s: RenderShot) => void;
  /** Saves a clip's video: plays it in the Render view from the start and records it. */
  onRecord?: (s: RenderShot) => void;
  /** Moves a shot to this place on the strip: renders still waiting go in the strip's order. */
  onMove?: (id: string, to: number) => void;
  /** A shared model: look, don't change. */
  readOnly?: boolean;
}

/** A ring that fills clockwise from the top, `f` of the way round: the strip's tiles and the top bar's wheel. */
export function Pie({ f, size = 18 }: { f: number; size?: number }) {
  const r = 7;
  const a = Math.min(0.9999, Math.max(0, f)) * Math.PI * 2;
  const x = 9 + r * Math.sin(a),
    y = 9 - r * Math.cos(a);
  return (
    <svg className="bc-pie" width={size} height={size} viewBox="0 0 18 18" aria-hidden>
      <circle cx="9" cy="9" r={r + 1} className="bc-pie-back" />
      {f > 0 && <path className="bc-pie-fill" d={`M9 9V${9 - r}A${r} ${r} 0 ${a > Math.PI ? 1 : 0} 1 ${x.toFixed(2)} ${y.toFixed(2)}Z`} />}
    </svg>
  );
}

const LENGTH_SECONDS = { quick: 5, normal: 10, slow: 20 } as const;
/** A clip's length on its tile: "10 s". */
const secsOf = (s: RenderShot) => `${LENGTH_SECONDS[s.animation!.length]} s`;
/** "animation, 10 s". */
const clipText = (s: RenderShot) => `animation, ${secsOf(s)}`;

const percent = (f: number) => `${Math.round(f * 100)}%`;

function jobText(j: Job | undefined): string | null {
  if (!j) return null;
  return j.running ? `Rendering, ${percent(j.progress)}` : "Waiting to render";
}

/**
 * The render film strip: one tile per shot along the bottom of the Render view, each its latest picture. A shot
 * still rendering shows how far it has got; one made before the model changed says it is out of date.
 */
export function RenderStrip({ jobs, shots, keyOf, onAdd, onRerender, onUse, onChange, onDelete, onSave, onRecord, onMove, readOnly }: RenderStripProps) {
  const state = useJobs(jobs);
  const movable = !!onMove && !readOnly;
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [menu, setMenu] = useState<(ContextMenuState & { id: string }) | null>(null);
  const shown = shots.find((s) => s.id === open);
  const entries = (s: RenderShot): MenuEntry[] => {
    const pic = state.pictures[s.id];
    const job = state.jobs.find((j) => j.shot === s.id);
    const clip = !!s.animation;
    return [
      ...(clip && onUse ? [{ id: "play", label: "Play", icon: "play", onSelect: () => onUse(s) } as MenuEntry] : []),
      ...(clip && onRecord ? [{ id: "video", label: "Save video", icon: "video", onSelect: () => onRecord(s) } as MenuEntry] : []),
      { id: "save", label: clip ? "Save poster" : "Save image", icon: "download", disabled: !pic, onSelect: () => onSave(s) },
      ...(readOnly
        ? []
        : ([
            job
              ? { id: "stop", label: "Stop rendering", icon: "close", onSelect: () => jobs.cancel(s.id) }
              : { id: "again", label: "Render again", icon: "camera", onSelect: () => onRerender(s) },
            ...(onUse && !clip ? [{ id: "use", label: "Use this view", icon: "eye", onSelect: () => onUse(s) }] : []),
            { id: "auto", label: "Update when I save", checked: s.auto, onSelect: () => onChange({ ...s, auto: !s.auto }) },
            ...(movable && shots.length > 1
              ? [
                  {
                    id: "earlier",
                    label: "Move earlier",
                    disabled: shots[0]?.id === s.id,
                    onSelect: () => onMove!(s.id, shots.findIndex((x) => x.id === s.id) - 1),
                  },
                  {
                    id: "later",
                    label: "Move later",
                    disabled: shots.at(-1)?.id === s.id,
                    onSelect: () => onMove!(s.id, shots.findIndex((x) => x.id === s.id) + 1),
                  },
                ]
              : []),
            { kind: "separator", id: "s1" },
            { id: "delete", label: "Delete", icon: "trash", onSelect: () => onDelete(s) },
          ] as MenuEntry[])),
    ];
  };
  return (
    <section className="bc-render-strip" aria-label="Renders">
      <ul className="bc-render-tiles">
        {shots.map((s, i) => {
          const pic = state.pictures[s.id];
          const job = state.jobs.find((j) => j.shot === s.id);
          // A first look (key "") is the Render view's picture from when the shot was added, not a render of it.
          const first = !!pic && pic.key === "";
          const stale = !!pic && !first && !job && pic.key !== keyOf(s);
          const note = jobText(job) ?? (stale ? "Out of date" : pic && !first ? null : "Not rendered yet");
          return (
            <li
              key={s.id}
              className={over === i && dragging && dragging !== s.id ? "bc-render-drop" : undefined}
              draggable={movable}
              onDragStart={(e) => {
                setDragging(s.id);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", s.id);
              }}
              onDragOver={(e) => {
                if (!dragging) return;
                e.preventDefault();
                setOver(i);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragging && dragging !== s.id) onMove?.(dragging, i);
                setDragging(null);
                setOver(null);
              }}
              onDragEnd={() => {
                setDragging(null);
                setOver(null);
              }}
            >
              <button
                type="button"
                className="bc-render-tile"
                aria-label={`${s.name}${s.animation ? `, ${clipText(s)}` : ""}${note ? `, ${note.toLowerCase()}` : ""}`}
                title={`${s.name}${s.auto ? ". Updates when you save" : ""}${movable ? ". Drag to change the order" : ""}`}
                onClick={() => setOpen(s.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenu({ x: e.clientX, y: e.clientY, id: s.id });
                }}
              >
                <span className="bc-render-tile-pic">
                  {job?.preview ? (
                    <img src={job.preview} alt="" draggable={false} data-preview="" />
                  ) : pic ? (
                    <img src={pic.url} alt="" draggable={false} data-first={first || undefined} />
                  ) : (
                    <span className="bc-render-tile-empty" />
                  )}
                  {s.animation && !job && (
                    <span className="bc-render-tile-clip" aria-hidden>
                      <Icon name="play" size={14} />
                      {secsOf(s)}
                    </span>
                  )}
                  {job && (
                    <span className={job.preview ? "bc-render-tile-job bc-render-tile-live" : "bc-render-tile-job"}>
                      <Pie f={job.progress} size={28} />
                    </span>
                  )}
                </span>
                <span className="bc-render-tile-name">{s.name}</span>
                {note && <span className={stale ? "bc-render-tile-note bc-render-stale" : "bc-render-tile-note"}>{note}</span>}
              </button>
            </li>
          );
        })}
        {onAdd && !readOnly && (
          <li>
            <button type="button" className="bc-render-tile bc-render-add" title="Keep this view on the strip and render it in the background" onClick={onAdd}>
              <span className="bc-render-tile-pic bc-render-tile-empty">
                <Icon name="plus" />
              </span>
              <span className="bc-render-tile-name">Add to strip</span>
            </button>
          </li>
        )}
      </ul>
      {menu && (
        <ContextMenu
          label="Render"
          at={menu}
          entries={(() => {
            const s = shots.find((x) => x.id === menu.id);
            return s ? entries(s) : [];
          })()}
          onClose={() => setMenu(null)}
        />
      )}
      {shown && (
        <RenderViewer
          shot={shown}
          url={state.pictures[shown.id]?.url}
          note={jobText(state.jobs.find((j) => j.shot === shown.id)) ?? (state.pictures[shown.id] ? null : "Not rendered yet")}
          stale={!!state.pictures[shown.id] && state.pictures[shown.id].key !== "" && state.pictures[shown.id].key !== keyOf(shown)}
          readOnly={readOnly}
          onClose={() => setOpen(null)}
          onSave={() => onSave(shown)}
          onRerender={() => onRerender(shown)}
          onUse={
            onUse &&
            (() => {
              setOpen(null);
              onUse(shown);
            })
          }
          onRecord={
            onRecord &&
            (() => {
              setOpen(null);
              onRecord(shown);
            })
          }
          onAuto={(auto) => onChange({ ...shown, auto })}
          onDelete={() => {
            setOpen(null);
            onDelete(shown);
          }}
        />
      )}
    </section>
  );
}

interface ViewerProps {
  shot: RenderShot;
  url?: string;
  note: string | null;
  stale: boolean;
  readOnly?: boolean;
  onClose: () => void;
  onSave: () => void;
  onRerender: () => void;
  onUse?: () => void;
  onRecord?: () => void;
  onAuto: (on: boolean) => void;
  onDelete: () => void;
}

/** One render, large, with what you can do with it. */
function RenderViewer({ shot, url, note, stale, readOnly, onClose, onSave, onRerender, onUse, onRecord, onAuto, onDelete }: ViewerProps) {
  const clip = !!shot.animation;
  return (
    <Dialog
      open
      modal
      title={shot.name}
      icon="image"
      width={720}
      className="bc-render-viewer"
      onCancel={onClose}
      footer={
        <>
          {!readOnly && <Button variant="danger" icon="trash" label="Delete" onClick={onDelete} />}
          <span className="bc-grow" />
          {!readOnly && !clip && onUse && <Button icon="eye" label="Use this view" title="Put the Render view on this shot" onClick={onUse} />}
          {!readOnly && <Button icon="camera" label={clip ? "Render poster again" : "Render again"} onClick={onRerender} />}
          {clip && onUse && <Button icon="play" label="Play" title="Play the clip in the Render view" onClick={onUse} />}
          {clip && onRecord ? (
            <Button variant="primary" icon="video" label="Save video" title="Play the clip from the start and record it" onClick={onRecord} />
          ) : (
            <Button variant="primary" icon="download" label={clip ? "Save poster" : "Save image"} disabled={!url} onClick={onSave} />
          )}
        </>
      }
    >
      <div className="bc-render-viewer-pic">{url ? <img src={url} alt={`Render of ${shot.name}`} /> : <p className="bc-note">{note}</p>}</div>
      <p className="bc-note">
        {clip && `${clipText(shot)[0]!.toUpperCase()}${clipText(shot).slice(1)}. `}
        {shot.width} × {shot.height}
        {stale ? ". Out of date: the model has changed since this render." : note && url ? `. ${note}.` : ""}
      </p>
      {!readOnly && (
        <label className="bc-check">
          <input type="checkbox" checked={shot.auto} onChange={(e) => onAuto(e.currentTarget.checked)} />
          Update when I save
        </label>
      )}
    </Dialog>
  );
}

/**
 * The top bar's sign that renders are running in the background: a wheel that fills as they get done. Gone when
 * nothing is waiting. Clicking it opens the strip.
 */
export function RenderWheel({ jobs, onOpen }: { jobs: RenderJobs; onOpen: () => void }) {
  useJobs(jobs);
  const o = jobs.overall();
  if (!o) return null;
  const more = o.count > 1 ? ` (${o.count} renders)` : "";
  return (
    <button
      type="button"
      className="bc-btn bc-render-wheel"
      title={`Rendering ${o.name}, ${percent(o.progress)}${more}. Click to see the renders`}
      aria-label={`Renders in the background, ${percent(o.progress)} done`}
      onClick={onOpen}
    >
      <span role="progressbar" aria-label="Background renders" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(o.progress * 100)}>
        <Pie f={o.progress} />
      </span>
    </button>
  );
}
