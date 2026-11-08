import { NumberField, PropRow } from "@bettercad/ui";
import { formatMass, type MassMethod, type MassProps } from "../state/document";

export interface MassInfo {
  /** The link the selection is in, with its bodies' total; "Base" for bodies in no link. */
  link?: { name: string; props: MassProps };
  /** The one selected body, when one is selected and it has mass. */
  body?: MassProps & { method: MassMethod };
  /** Its datasheet mass, when it has one of its own. */
  datasheet?: number;
  /** Sets the body's datasheet mass in grams, or clears it (undefined) to go back to the estimate. */
  onDatasheet?: (g: number | undefined) => void;
}

const mm = (v: number) => String(Math.round(v * 10) / 10);
const at = (p: MassProps) => `${mm(p.com[0])}, ${mm(p.com[1])}, ${mm(p.com[2])} mm`;

const HOW: Record<MassMethod, string> = {
  shell: "Printed: solid walls and the infill inside, in the model's material.",
  uniform: "Printed, estimated evenly: the walls couldn't be worked out for this shape.",
  datasheet: "From its datasheet, spread evenly.",
};

/** Mass, centre of mass and the datasheet field (#174), in Properties. */
export function MassRows({ link, body, datasheet, onDatasheet }: MassInfo) {
  return (
    <>
      {body && (
        <>
          <PropRow label="Mass">{formatMass(body.mass)}</PropRow>
          <p className="bc-note">{HOW[body.method]}</p>
        </>
      )}
      {onDatasheet && (
        <NumberField label="Datasheet mass" value={datasheet ?? null} unit="g" min={0} precision={1} onCommit={(g) => onDatasheet(g > 0 ? g : undefined)} />
      )}
      {link && (
        <>
          <PropRow label={link.name}>{formatMass(link.props.mass)}</PropRow>
          <PropRow label="Centre of mass">{at(link.props)}</PropRow>
        </>
      )}
    </>
  );
}
