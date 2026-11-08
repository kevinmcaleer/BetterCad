import { useState, type ReactNode } from "react";
import { Icon } from "./Icon";
import { cx } from "./cx";

export interface PropsSection {
  /** Remembers whether the section is folded, per id. */
  id: string;
  title: string;
  content: ReactNode;
}

export interface PropsPanelProps {
  label?: string;
  sections: PropsSection[];
  /** Shown when there are no sections: "Select something to see its properties." */
  empty?: ReactNode;
  /** Stays at the foot of the panel below the sections, such as the sketch palette's Finish sketch button. */
  footer?: ReactNode;
}

const KEY = "bettercad.props.folded";

function loadFolded(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

/** The right-hand panel: titled sections that fold, each a grid of label and field rows. */
export function PropsPanel({ label = "Properties", sections, empty, footer }: PropsPanelProps) {
  const [folded, setFolded] = useState(loadFolded);
  const toggle = (id: string) =>
    setFolded((f) => {
      const n = new Set(f);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      try {
        localStorage.setItem(KEY, JSON.stringify([...n]));
      } catch {
        /* storage blocked: folds last for this visit */
      }
      return n;
    });
  return (
    <aside className="bc-side bc-props" aria-label={label}>
      {sections.length === 0
        ? (empty ?? <p className="bc-note">Select something to see its properties.</p>)
        : sections.map((s) => {
            const open = !folded.has(s.id);
            return (
              <section key={s.id} className="bc-section" aria-labelledby={`bc-sec-${s.id}`}>
                <h2 className="bc-panel-title">
                  <button
                    type="button"
                    id={`bc-sec-${s.id}`}
                    className={cx("bc-section-toggle", open && "bc-open")}
                    aria-expanded={open}
                    onClick={() => toggle(s.id)}
                  >
                    <Icon name="chevron" size={14} />
                    {s.title}
                  </button>
                </h2>
                {open && <div className="bc-section-body">{s.content}</div>}
              </section>
            );
          })}
      {footer && <div className="bc-props-footer">{footer}</div>}
    </aside>
  );
}

/** One label and value row in a props section's two-column grid. */
export function PropRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="bc-prop-row">
      <span className="bc-prop-label">{label}</span>
      <div className="bc-prop-value">{children}</div>
    </div>
  );
}
