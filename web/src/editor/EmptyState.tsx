import { Icon, type IconName } from "@bettercad/ui";
import { SampleCards } from "../samples/SampleCards";

/**
 * The empty editor (#99): three ways in, the drop hint and the sample models, centred over the grid. It hides once
 * the model has a step, and never shows on a share link.
 */
export interface EmptyStateProps {
  onShape: () => void;
  onSketch: () => void;
  onOpen: () => void;
  onSample: (id: string) => void;
}

const ACTIONS: { id: keyof Omit<EmptyStateProps, "onSample">; icon: IconName; label: string }[] = [
  { id: "onShape", icon: "shapes", label: "Add a shape" },
  { id: "onSketch", icon: "sketch", label: "Sketch" },
  { id: "onOpen", icon: "folder", label: "Open" },
];

export function EmptyState(p: EmptyStateProps) {
  return (
    <div className="bc-empty-state-host">
      <section className="bc-empty-state" aria-labelledby="bc-empty-title">
        <h2 id="bc-empty-title" className="bc-empty-title">
          Start with a shape, a sketch, or open a file
        </h2>
        <div className="bc-empty-actions">
          {ACTIONS.map((a) => (
            <button key={a.id} type="button" className="bc-empty-action" onClick={p[a.id]}>
              <Icon name={a.icon} size={24} />
              <span>{a.label}</span>
            </button>
          ))}
        </div>
        <p className="bc-empty-drop">or drop an STL, STEP or .bcad here</p>
        <SampleCards onOpen={p.onSample} />
      </section>
    </div>
  );
}
