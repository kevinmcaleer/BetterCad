import { useId } from "react";
import { Dialog } from "@bettercad/ui";
import type { AutoRecipe, DatumCorner } from "@bettercad/kernel/drawing";
import { DATUMS, RECIPES, type AutoOptions } from "./auto";

export interface AutoCardProps {
  options: AutoOptions;
  onOptions: (o: AutoOptions) => void;
  /** How many sizes each recipe gives at this density, and how many it could. */
  counts: Record<AutoRecipe, { count: number; total: number }>;
  /** Why there is nothing to show yet. */
  wait?: string;
  onDone: () => void;
  onCancel: () => void;
}

/** A recipe at a glance: a part with its sizes all from one end, or one after another, and a marked hole. */
function Glance({ recipe }: { recipe: AutoRecipe }) {
  const chain = recipe === "chain" || recipe === "centre-chain";
  const marks = recipe === "centre-baseline" || recipe === "centre-chain";
  const rows = chain
    ? [
        [4, 16, 23],
        [16, 30, 23],
        [30, 44, 23],
      ]
    : [
        [4, 16, 21],
        [4, 30, 25],
        [4, 44, 29],
      ];
  return (
    <svg className="bc-auto-glance" viewBox="0 0 48 32" width={48} height={32} aria-hidden="true">
      <path d="M4 4H44V16H30V12H16V16H4Z" />
      <circle cx="37" cy="9" r="2.2" />
      {marks && <path d="M33 9H41M37 5V13" />}
      {rows.map(([a, b, y]) => (
        <path key={`${a}-${b}`} d={`M${a} ${y}H${b}M${a} ${y! - 2}V${y! + 2}M${b} ${y! - 2}V${y! + 2}`} />
      ))}
    </svg>
  );
}

/**
 * Auto dimension's card (#566): a recipe, the corner positions are measured from, and how many sizes you get. The
 * sheet shows the result as you choose; OK keeps it and Cancel leaves the sheet as it was.
 */
export function AutoCard({ options, onOptions, counts, wait, onDone, onCancel }: AutoCardProps) {
  const id = useId();
  const now = counts[options.recipe];
  const said = wait ?? (now.total ? `${now.count} of ${now.total} dimensions` : "There is nothing here to dimension.");
  return (
    <Dialog open title="Auto dimension" icon="dimension" className="bc-view-card" width={420} onCancel={onCancel} onDone={onDone} doneLabel="OK">
      <div className="bc-sheet-card">
        <div className="bc-auto-recipes" role="radiogroup" aria-label="Recipe">
          {RECIPES.map((r) => (
            <label key={r.id} className={options.recipe === r.id ? "bc-auto-recipe bc-auto-recipe-on" : "bc-auto-recipe"}>
              <input type="radio" name={`${id}-recipe`} checked={options.recipe === r.id} onChange={() => onOptions({ ...options, recipe: r.id })} />
              <Glance recipe={r.id} />
              <span className="bc-auto-name">
                {r.label}
                <small>{counts[r.id].total ? `${counts[r.id].count} of ${counts[r.id].total}. ${r.how}` : r.how}</small>
              </span>
            </label>
          ))}
        </div>
        <label className="bc-field-label" htmlFor={`${id}-datum`}>
          Measure from
        </label>
        <select
          id={`${id}-datum`}
          className="bc-select"
          value={options.datum}
          onChange={(e) => onOptions({ ...options, datum: e.target.value as DatumCorner })}
        >
          {DATUMS.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
        </select>
        <label className="bc-field-label" htmlFor={`${id}-density`}>
          How many sizes
        </label>
        <input
          id={`${id}-density`}
          className="bc-range"
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={options.density}
          aria-valuetext={said}
          onChange={(e) => onOptions({ ...options, density: Number(e.target.value) })}
        />
        <p className="bc-note" role="status">
          {said}
        </p>
      </div>
    </Dialog>
  );
}
