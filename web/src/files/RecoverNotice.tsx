import { useState } from "react";
import { Banner, Button } from "@bettercad/ui";
import { ago, type AutosaveRecord } from "./autosave";

export interface RecoverNoticeProps {
  /** Autosaves that can be recovered, newest first. */
  list: AutosaveRecord[];
  onRecover: (r: AutosaveRecord) => void;
  onDiscard: (r: AutosaveRecord) => void;
  onDiscardAll: () => void;
  /** For tests. */
  now?: () => number;
}

/**
 * One notice for every autosave that can be recovered (#84), however many there are. One model shows its name with
 * Recover and Discard; more show a count, and Choose opens the list.
 */
export function RecoverNotice({ list, onRecover, onDiscard, onDiscardAll, now = Date.now }: RecoverNoticeProps) {
  const [open, setOpen] = useState(false);
  if (!list.length) return null;
  const t = now();

  if (list.length === 1) {
    const r = list[0]!;
    return (
      <div className="bc-recover">
        <Banner
          tone="warn"
          action={
            <span className="bc-actions">
              <Button size="dense" label="Recover" title={`Open what was autosaved of ${r.name}`} onClick={() => onRecover(r)} />
              <Button size="dense" label="Discard" title="Forget this autosave" onClick={() => onDiscard(r)} />
            </span>
          }
        >
          Recover ‘{r.name}’ from {ago(t - r.modified)}
        </Banner>
      </div>
    );
  }

  return (
    <div className="bc-recover">
      <Banner
        tone="warn"
        action={
          <span className="bc-actions">
            <Button
              size="dense"
              label={open ? "Hide" : "Choose"}
              title={open ? "Hide the list" : "Pick the models to recover"}
              aria-expanded={open}
              aria-controls="bc-recover-list"
              onClick={() => setOpen((o) => !o)}
            />
            <Button size="dense" label="Discard all" title="Forget all of these autosaves" onClick={onDiscardAll} />
          </span>
        }
      >
        You have {list.length} unsaved models you can recover
      </Banner>
      {open && (
        <ul className="bc-recover-list" id="bc-recover-list" aria-label="Models you can recover">
          {list.map((r) => (
            <li key={r.id} className="bc-recover-row">
              <span className="bc-recover-name">
                <strong>{r.name}</strong>
                <span className="bc-recover-when">{ago(t - r.modified)}</span>
              </span>
              <span className="bc-actions">
                <Button
                  size="dense"
                  label="Recover"
                  title={`Open what was autosaved of ${r.name}`}
                  aria-label={`Recover ${r.name}`}
                  onClick={() => onRecover(r)}
                />
                <Button size="dense" label="Discard" title={`Forget the autosave of ${r.name}`} aria-label={`Discard ${r.name}`} onClick={() => onDiscard(r)} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
