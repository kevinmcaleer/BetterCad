import { useState } from "react";
import { Icon, cx, type IconName } from "@bettercad/ui";
import { CATALOGUE } from "@bettercad/kernel/catalogue";
import { CATALOGUE_CATEGORIES, type CatalogueCategory, type CataloguePart } from "../state/document";

/** Each category's icon in the list. */
const ICON: Record<CatalogueCategory, IconName> = {
  servo: "screw",
  motor: "revolve",
  board: "grid",
  sensor: "info",
  bearing: "torus",
  power: "cylinder",
};

/** Whether a part matches what's typed: every word somewhere in its name, id or description. */
export function matches(p: CataloguePart, q: string): boolean {
  const hay = `${p.name} ${p.id} ${p.description}`.toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}

export interface CataloguePanelProps {
  /** The part being placed, if any. */
  placing: string | null;
  onPick: (p: CataloguePart) => void;
}

/** Robot parts (#187): the catalogue by category, with search. Pick one, then click a face to place it. */
export function CataloguePanel({ placing, onPick }: CataloguePanelProps) {
  const [q, setQ] = useState("");
  const found = CATALOGUE.filter((p) => matches(p, q));
  return (
    <>
      <h2 className="bc-panel-title">Robot parts catalogue</h2>
      <p className="bc-note">Pick a part, then click a face to put it there. It comes in as a reference body to design round.</p>
      <input className="bc-text" type="search" aria-label="Search parts" placeholder="Search parts" value={q} onChange={(e) => setQ(e.target.value)} />
      {found.length === 0 && <p className="bc-note">No parts match “{q}”.</p>}
      {CATALOGUE_CATEGORIES.map((c) => {
        const list = found.filter((p) => p.category === c.id);
        if (!list.length) return null;
        return (
          <section key={c.id} aria-label={c.label}>
            <h3 className="bc-panel-title">{c.label}</h3>
            <div className="bc-tool-list">
              {list.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={cx("bc-menu-item", placing === p.id && "bc-on")}
                  aria-pressed={placing === p.id}
                  data-tip={`${p.description}${p.checked ? "" : " Sizes are from common listings, not checked: measure yours."}`}
                  onClick={() => onPick(p)}
                >
                  <span className="bc-menu-icon">
                    <Icon name={ICON[p.category]} />
                  </span>
                  <span>{p.name}</span>
                  <span className="bc-keys">{p.mass} g</span>
                </button>
              ))}
            </div>
          </section>
        );
      })}
    </>
  );
}
