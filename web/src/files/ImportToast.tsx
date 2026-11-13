import type { ImportProgress } from "./importFiles";

/** The toast while a file imports: which file, what it's doing, and a bar that fills as it goes. */
export function ImportToast({ file, n, of, stage, fraction }: ImportProgress) {
  const title = `Importing ${file}${of > 1 ? ` (${n} of ${of})` : ""}`;
  return (
    <div className="bc-toast bc-toast-progress">
      <span className="bc-toast-title">{title}</span>
      <span className="bc-toast-stage">{stage}</span>
      <progress className="bc-progress" aria-label={title} max={1} value={fraction} />
    </div>
  );
}
