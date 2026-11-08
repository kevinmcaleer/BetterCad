import { ArmedBar, Button } from "@bettercad/ui";
import type { PlaceSession } from "./usePlacePart";

/** The strip while placing a robot part (#187): what's being placed, its turn, Turn and Cancel. */
export function PlaceBar({ x }: { x: PlaceSession }) {
  if (!x.part) return null;
  return (
    <ArmedBar title={`Place ${x.part.name}`} icon="screw">
      <span className="bc-armed-note">
        Click a flat face, or the ground. Turned {x.quarters * 90}°.{x.part.checked ? "" : " Sizes aren't checked: measure yours."}
      </span>
      <Button label="Turn 90°" title="Turn the part a quarter about the face" shortcut="T" onClick={x.turn} />
      <Button kind="cancel" label="Cancel" title="Put the part back" shortcut="Esc" onClick={x.cancel} />
    </ArmedBar>
  );
}
