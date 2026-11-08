import { Button, Icon, MenuButton, PropRow, type MenuEntry } from "@bettercad/ui";
import { DEFAULT_COLOUR, FILAMENT_COLOURS, FINISHES, finishById, finishOf, parseHex, type FinishId, type Looked } from "@bettercad/kernel";

export interface LookControlsProps {
  /** The selected bodies' looks. */
  parts: Looked[];
  /** A colour for them all, or undefined for the theme's part colour. */
  onColour: (hex: string | undefined) => void;
  onFinish: (id: FinishId) => void;
}

/** The value every body shares, or null when they differ. */
function same<T>(xs: T[]): T | null {
  return xs.every((x) => x === xs[0]) ? xs[0]! : null;
}

/**
 * Colour and Finish (#196) in Properties: a row of filament colours, a custom picker and Theme (no colour of its
 * own), then a menu of finishes. The colour shows in the view; the finish in renders and glTF.
 */
export function LookControls({ parts, onColour, onFinish }: LookControlsProps) {
  const colour = same(parts.map((p) => parseHex(p.colour) ?? ""));
  const finish = same(parts.map((p) => finishOf(p)));
  const known = FILAMENT_COLOURS.some((c) => c.hex === colour);
  const custom = !!colour && !known;
  const entries: MenuEntry[] = FINISHES.map((f) => ({
    id: f.id,
    label: f.label,
    checked: finish === f.id,
    onSelect: () => onFinish(f.id),
  }));
  return (
    <>
      <PropRow label="Colour">
        <span className="bc-chips" role="group" aria-label="Colour">
          <button
            type="button"
            className="bc-chip bc-chip-none"
            aria-label="Theme colour"
            title="Theme colour: follows Light, Dark or Holoroom"
            aria-pressed={colour === ""}
            onClick={() => onColour(undefined)}
          />
          {FILAMENT_COLOURS.map((c) => (
            <button
              key={c.hex}
              type="button"
              className="bc-chip"
              aria-label={c.name}
              title={c.name}
              aria-pressed={colour === c.hex}
              style={{ background: c.hex }}
              onClick={() => onColour(c.hex)}
            />
          ))}
          <label className="bc-chip bc-chip-custom" title="Any colour" style={custom ? { background: colour } : undefined}>
            {!custom && <Icon name="plus" size={14} />}
            <input type="color" aria-label="Any colour" value={colour || DEFAULT_COLOUR} onChange={(e) => onColour(parseHex(e.target.value))} />
          </label>
        </span>
      </PropRow>
      <PropRow label="Finish">
        <MenuButton
          label="Finish"
          entries={entries}
          trigger={(p) => <Button {...p} label={finish ? finishById(finish).label : "Several"} title="How it looks in a render and in glTF" />}
        />
      </PropRow>
    </>
  );
}
