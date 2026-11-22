import { Button, ESC, Icon, useEscape } from "@bettercad/ui";
import type { UploadRow } from "./upload";

/**
 * The upload card in My models: one line per file, saying what it's doing with a bar that fills, then the model it made
 * or why it failed. It floats at the bottom right while files go up, and stays after a failure until you close it, so
 * a file that doesn't go up never does so quietly.
 */
export function UploadCard({ rows, onClose }: { rows: UploadRow[]; onClose: () => void }) {
  const busy = rows.some((r) => r.state === "waiting" || r.state === "working");
  const failed = rows.filter((r) => r.state === "failed").length;
  const done = rows.filter((r) => r.state === "done").length;
  useEscape(!busy, onClose, ESC.overlay);
  const title = busy
    ? rows.length === 1
      ? "Uploading"
      : `Uploading ${Math.min(done + failed + 1, rows.length)} of ${rows.length} files`
    : failed
      ? failed === rows.length
        ? rows.length === 1
          ? "Upload failed"
          : `${failed} uploads failed`
        : `${failed} of ${rows.length} uploads failed`
      : rows.length === 1
        ? "Uploaded"
        : `${done} models uploaded`;
  return (
    <section className="bc-upload-card" aria-label="Uploads">
      <header className="bc-upload-head">
        <span className="bc-upload-title" role="status" aria-live="polite">
          {title}
        </span>
        {!busy && <Button icon="close" title="Close" shortcut="Esc" size="dense" onClick={onClose} />}
      </header>
      <ul className="bc-upload-rows">
        {rows.map((r, i) => (
          <li key={i} className={`bc-upload-row bc-upload-${r.state}`}>
            <span className="bc-upload-file">
              {r.state === "done" && <Icon name="check" />}
              {r.state === "failed" && <Icon name="warning" />}
              {r.file}
            </span>
            {r.state === "failed" ? (
              <span className="bc-upload-why" role="alert">
                {r.stage}
              </span>
            ) : (
              <span className="bc-upload-stage">{r.state === "done" ? `Saved as ${r.stage}` : r.stage}</span>
            )}
            {(r.state === "working" || r.state === "waiting") && (
              <progress className="bc-progress" aria-label={`Uploading ${r.file}`} max={1} value={r.fraction ?? 0} />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
