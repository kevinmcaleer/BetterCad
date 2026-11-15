import { ArmedBar, Button } from "@bettercad/ui";
import type { PlaceSession } from "./usePlacePart";

/** The strip while placing a robot part (#187) or a model (#484): what's being placed, its turn, Turn and Cancel. */
export function PlaceBar({ x }: { x: PlaceSession }) {
  if (!x.part) return null;
  return (
    <ArmedBar title={`Place ${x.part.name}`} icon={x.part.step ? "insertModel" : "screw"}>
      <span className="bc-armed-note">
        Click a flat face, or the ground. Turned {x.quarters * 90}°.{x.part.unchecked ? " Sizes aren't checked: measure yours." : ""}
      </span>
      <Button label="Turn 90°" title={`Turn the ${x.part.step ? "model" : "part"} a quarter about the face`} shortcut="T" onClick={x.turn} />
      <Button kind="cancel" label="Cancel" title={`Put the ${x.part.step ? "model" : "part"} back`} shortcut="Esc" onClick={x.cancel} />
    </ArmedBar>
  );
}
