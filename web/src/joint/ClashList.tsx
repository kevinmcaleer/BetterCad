import { Button } from "@bettercad/ui";
import type { Clash } from "@bettercad/kernel";

export interface ClashListProps {
  /** Whether the check is on: it runs now and again after each change. */
  on: boolean;
  onToggle: (on: boolean) => void;
  sameLink: boolean;
  references: boolean;
  onOptions: (change: { sameLink?: boolean; references?: boolean }) => void;
  /** Named poses (#177) to check at instead of the pose now, Home first; left out when there are no joints. */
  poses?: { id: string; name: string }[];
  /** The pose checked: null for the pose now. */
  at?: string | null;
  onAt?: (id: string | null) => void;
  /** How far the check has got, 0 to 1, while it runs. */
  progress: number | null;
  /** The last answer, biggest overlap first; null before there is one. */
  clashes: Clash[] | null;
  nameOf: (id: string) => string;
  onShow: (c: Clash) => void;
  onStop: () => void;
}

/** An overlap's volume: cm³ from 0.1 cm³, mm³ below that. */
export function volumeText(mm3: number): string {
  if (mm3 >= 100) return `${(Math.round(mm3 / 100) / 10).toLocaleString("en-GB", { maximumFractionDigits: 1 })} cm³`;
  return `${(Math.round(mm3 * 10) / 10).toLocaleString("en-GB", { maximumFractionDigits: 1 })} mm³`;
}

/**
 * The clash check (#178): which bodies overlap at this pose, and by how much, and which only touch (printed parts that
 * touch fuse or bind). Show frames each one.
 */
export function ClashList({
  on,
  onToggle,
  sameLink,
  references,
  onOptions,
  poses,
  at = null,
  onAt,
  progress,
  clashes,
  nameOf,
  onShow,
  onStop,
}: ClashListProps) {
  const overlaps = clashes?.filter((c) => c.kind === "overlap") ?? [];
  const touches = clashes?.filter((c) => c.kind === "touch") ?? [];
  const row = (c: Clash, text: string) => (
    <li key={`${c.a}-${c.b}`} className="bc-clash">
      <span>{text}</span>
      <Button size="dense" label="Show" title="Frame it in the view" onClick={() => onShow(c)} />
    </li>
  );
  return (
    <div className="bc-clashes">
      <Button icon="warning" label="Check clashes" title="Find bodies that overlap or touch at this pose" on={on} onClick={() => onToggle(!on)} />
      {on && (
        <>
          {poses && onAt && (
            <label className="bc-clash-at">
              <span className="bc-field-label">At</span>
              <select className="bc-select" value={at ?? ""} onChange={(e) => onAt(e.target.value || null)}>
                <option value="">The pose now</option>
                {poses.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="bc-check">
            <input type="checkbox" checked={sameLink} onChange={(e) => onOptions({ sameLink: e.target.checked })} />
            <span>Bodies in the same link</span>
          </label>
          <label className="bc-check">
            <input type="checkbox" checked={references} onChange={(e) => onOptions({ references: e.target.checked })} />
            <span>Reference bodies</span>
          </label>
          {progress !== null ? (
            <p className="bc-note" role="status">
              {`Checking, ${Math.round(progress * 100)}%`} <Button size="dense" label="Stop" title="Stop checking (Esc)" onClick={onStop} />
            </p>
          ) : clashes && !clashes.length ? (
            <p className="bc-note" role="status">
              {at ? `No clashes at ${poses?.find((p) => p.id === at)?.name ?? "that pose"}.` : "No clashes at this pose."}
            </p>
          ) : null}
          {overlaps.length > 0 && (
            <ul className="bc-clash-list" aria-label="Overlaps">
              {overlaps.map((c) => row(c, `${nameOf(c.a)} and ${nameOf(c.b)} overlap by ${volumeText(c.volume)}`))}
            </ul>
          )}
          {touches.length > 0 && (
            <>
              <h3 className="bc-clash-head">Touching</h3>
              <ul className="bc-clash-list" aria-label="Touching">
                {touches.map((c) => row(c, `${nameOf(c.a)} and ${nameOf(c.b)} touch`))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}
