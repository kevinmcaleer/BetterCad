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

const percent = (f: number) => `${Math.round(f * 100)}%`;

function jobText(j: Job | undefined): string | null {
  if (!j) return null;
  return j.running ? `Rendering, ${percent(j.progress)}` : "Waiting to render";
}

/**
 * The render film strip: one tile per shot along the bottom of the Render view, each its latest picture. A shot
 * still rendering shows how far it has got; one made before the model changed says it is out of date.
 */
export function RenderStrip({ jobs, shots, keyOf, onAdd, onRerender, onUse, onChange, onDelete, onSave, readOnly }: RenderStripProps) {
  const state = useJobs(jobs);
  const [open, setOpen] = useState<string | null>(null);
  const [menu, setMenu] = useState<(ContextMenuState & { id: string }) | null>(null);
  const shown = shots.find((s) => s.id === open);
  const entries = (s: RenderShot): MenuEntry[] => {
    const pic = state.pictures[s.id];
    const job = state.jobs.find((j) => j.shot === s.id);
    return [
      { id: "save", label: "Save image", icon: "download", disabled: !pic, onSelect: () => onSave(s) },
      ...(readOnly
        ? []
        : ([
            job
              ? { id: "stop", label: "Stop rendering", icon: "close", onSelect: () => jobs.cancel(s.id) }
              : { id: "again", label: "Render again", icon: "camera", onSelect: () => onRerender(s) },
            ...(onUse ? [{ id: "use", label: "Use this view", icon: "eye", onSelect: () => onUse(s) }] : []),
            { id: "auto", label: "Update when I save", checked: s.auto, onSelect: () => onChange({ ...s, auto: !s.auto }) },
            { kind: "separator", id: "s1" },
            { id: "delete", label: "Delete", icon: "trash", onSelect: () => onDelete(s) },
          ] as MenuEntry[])),
    ];
  };
  return (
    <section className="bc-render-strip" aria-label="Renders">
      <ul className="bc-render-tiles">
        {shots.map((s) => {
          const pic = state.pictures[s.id];
          const job = state.jobs.find((j) => j.shot === s.id);
          const stale = !!pic && !job && pic.key !== keyOf(s);
          const note = jobText(job) ?? (stale ? "Out of date" : pic ? null : "Not rendered yet");
          return (
            <li key={s.id}>
              <button
                type="button"
                className="bc-render-tile"
                aria-label={`${s.name}${note ? `, ${note.toLowerCase()}` : ""}`}
                title={`${s.name}${s.auto ? ". Updates when you save" : ""}`}
                onClick={() => setOpen(s.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenu({ x: e.clientX, y: e.clientY, id: s.id });
                }}
              >
                <span className="bc-render-tile-pic">
                  {pic ? <img src={pic.url} alt="" draggable={false} /> : <span className="bc-render-tile-empty" />}
                  {job && (
                    <span className="bc-render-tile-job">
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
          stale={!!state.pictures[shown.id] && state.pictures[shown.id].key !== keyOf(shown)}
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
  onAuto: (on: boolean) => void;
  onDelete: () => void;
}

/** One render, large, with what you can do with it. */
function RenderViewer({ shot, url, note, stale, readOnly, onClose, onSave, onRerender, onUse, onAuto, onDelete }: ViewerProps) {
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
          {!readOnly && onUse && <Button icon="eye" label="Use this view" title="Put the Render view on this shot" onClick={onUse} />}
          {!readOnly && <Button icon="camera" label="Render again" onClick={onRerender} />}
          <Button variant="primary" icon="download" label="Save image" disabled={!url} onClick={onSave} />
        </>
      }
    >
      <div className="bc-render-viewer-pic">{url ? <img src={url} alt={`Render of ${shot.name}`} /> : <p className="bc-note">{note}</p>}</div>
      <p className="bc-note">
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
