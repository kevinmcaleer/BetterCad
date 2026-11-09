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

/** The stage notice: a toast at the bottom right of the view that stays until you put it away. */
export function StageNotice({ onDismiss }: { onDismiss: () => void }) {
  const { title, text } = STAGE_TEXT[STAGE];
  return (
    <aside className="bc-stage-notice" aria-label={title}>
      <div className="bc-stage-head">
        <strong>{title}</strong>
        <IconButton icon="close" title="Dismiss" quiet onClick={onDismiss} />
      </div>
      <p>{text}</p>
      <Button size="dense" variant="primary" label="Got it" onClick={onDismiss} />
    </aside>
  );
}
