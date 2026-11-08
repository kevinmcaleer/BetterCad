import { useLayoutEffect, useRef, useState } from "react";
import { Button, Icon, IconButton } from "@bettercad/ui";
import { formatCombo } from "../state/commands";

export interface Tip {
  id: string;
  title: string;
  text: string;
}

/** The tips, in the order they show. Short, second person, sentence case (the brand book). */
export function tips(): Tip[] {
  const mod = formatCombo("mod");
  return [
    { id: "sketch", title: "Sketch, then extrude", text: "Press K to sketch on a plane or a flat face, then E to extrude a closed shape into a solid." },
    { id: "plane", title: "Sketch on any plane", text: "Right-click a plane in the browser to sketch on it." },
    {
      id: "browser",
      title: "Pick in the browser",
      text: `Shift-click selects a range, ${mod}-click adds one. Drag bodies to reorder, F2 to rename.`,
    },
    {
      id: "components",
      title: "Join parts together",
      text: "Make a component to work in, or one from bodies, then use the Joint tool to hang each from another.",
    },
    { id: "find", title: "Find any command", text: `Press ${formatCombo("mod+k")} to find a command by name, or ? to see every shortcut.` },
  ];
}

/** The Help button on the top bar: where the card goes when you put it away, and where it comes from on Help → Tips. */
const helpButton = () => document.querySelector<HTMLElement>("[data-help-button]");

const still = () => typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** The move from the card's place to the Help button, as a transform on the card. */
function towardHelp(card: HTMLElement): Keyframe | null {
  const help = helpButton();
  if (!help) return null;
  const a = card.getBoundingClientRect();
  const b = help.getBoundingClientRect();
  if (!a.width || !b.width) return null;
  const dx = b.left + b.width / 2 - (a.left + a.width / 2);
  const dy = b.top + b.height / 2 - (a.top + a.height / 2);
  return { transform: `translate(${dx}px, ${dy}px) scale(${b.width / a.width})`, opacity: 0 };
}

const MOVE: KeyframeAnimationOptions = { duration: 360, easing: "cubic-bezier(0.4, 0, 0.2, 1)" };

/**
 * The tips card: one tip at a time, floating over the view at the bottom left. Dismissing it shrinks it into the
 * Help button, where Help → Tips brings it back.
 */
export function TipsCard({ from, onDismiss }: { from: "auto" | "help"; onDismiss: () => void }) {
  const list = tips();
  const [i, setI] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const ref = useRef<HTMLElement>(null);
  const tip = list[i]!;
  const last = i === list.length - 1;

  // Asked for from Help: grow out of the Help button.
  useLayoutEffect(() => {
    const el = ref.current;
    if (from !== "help" || !el || typeof el.animate !== "function" || still()) return;
    const at = towardHelp(el);
    if (at) el.animate([at, { transform: "none", opacity: 1 }], MOVE);
  }, [from]);

  const dismiss = () => {
    if (leaving) return;
    setLeaving(true);
    const el = ref.current;
    const at = el && typeof el.animate === "function" && !still() ? towardHelp(el) : null;
    if (!el || !at) return onDismiss();
    const run = el.animate([{ transform: "none", opacity: 1 }, at], { ...MOVE, fill: "forwards" });
    const done = () => {
      onDismiss();
      // A small nod from the Help button, so you can see where the tips went.
      helpButton()?.animate?.([{ transform: "scale(1)" }, { transform: "scale(1.2)" }, { transform: "scale(1)" }], { duration: 300 });
    };
    run.finished.then(done, done);
  };

  return (
    <aside ref={ref} className="bc-tips-card" aria-label="Tips">
      <div className="bc-tips-head">
        <Icon name="bulb" />
        <strong className="bc-tips-title">{tip.title}</strong>
        <span className="bc-tips-count">
          {i + 1} of {list.length}
        </span>
        <IconButton icon="close" title="Dismiss tips" quiet onClick={dismiss} />
      </div>
      <p aria-live="polite">{tip.text}</p>
      <div className="bc-tips-foot">
        {i > 0 && <Button size="dense" label="Back" onClick={() => setI(i - 1)} />}
        <Button size="dense" variant="primary" label={last ? "Done" : "Next tip"} onClick={last ? dismiss : () => setI(i + 1)} />
      </div>
    </aside>
  );
}
