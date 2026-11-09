import { Button, IconButton } from "@bettercad/ui";
import { STAGE } from "./useStageNotice";

/** What the notice says at each stage. Short, second person, sentence case (the brand book). */
export const STAGE_TEXT = {
  alpha: {
    title: "BetterCad is in alpha",
    text: "It's still in active development, so things may change or break. Save your work to a file now and then.",
  },
  beta: {
    title: "BetterCad is in beta",
    text: "Most things work, but some may still change. Save your work to a file now and then.",
  },
} as const;

/**
 * The stage notice: a toast at the bottom right of the view that stays until you put it away. While the start card
 * is up it sits `inline` just above it instead, so the two never overlap.
 */
export function StageNotice({ onDismiss, inline }: { onDismiss: () => void; inline?: boolean }) {
  const { title, text } = STAGE_TEXT[STAGE];
  return (
    <aside className={inline ? "bc-stage-notice bc-stage-inline" : "bc-stage-notice"} aria-label={title}>
      <div className="bc-stage-head">
        <strong>{title}</strong>
        <IconButton icon="close" title="Dismiss" quiet onClick={onDismiss} />
      </div>
      <p>{text}</p>
      <Button size="dense" variant="primary" label="Got it" onClick={onDismiss} />
    </aside>
  );
}
