import type { KeyboardEvent } from "react";
import { ArmedBar, Button, MenuButton, NumberField, type MenuEntry } from "@bettercad/ui";
import type { Part } from "../state/document";
import { DIRECTIONS, OPERATIONS, type ExtrudeSession } from "./useExtrude";

/** The Extrude tool's strip: distance, direction, what it does to the model, and Done or Cancel. */
export function ExtrudeBar({ x, parts }: { x: ExtrudeSession; parts: Part[] }) {
  const f = x.feature;
  if (!f) {
    return (
      <ArmedBar title="Extrude" icon="extrude">
        <span className="bc-armed-note">{x.help}</span>
        <Button kind="cancel" label="Cancel" title="Put the tool down" shortcut="Esc" onClick={x.cancel} />
      </ArmedBar>
    );
  }
  // Enter in a field keeps its value, then keeps the extrude.
  const onFieldKey = (e: KeyboardEvent) => {
    // The field's own commit has already gone into the document; finish now, before an Esc could follow.
    if (e.key === "Enter") x.done();
  };
  const others = parts.filter((p) => p.id !== f.body.id);
  const target = others.find((p) => p.id === f.target);
  const targets: MenuEntry[] = others.map((p) => ({ id: p.id, label: p.name, onSelect: () => x.change({ target: p.id }) }));
  const directions: MenuEntry[] = DIRECTIONS.map((d) => ({ id: d.id, label: d.label, onSelect: () => x.change({ direction: d.id }) }));
  const direction = DIRECTIONS.find((d) => d.id === f.direction)!;
  return (
    <ArmedBar title="Extrude" icon="extrude">
      <span className="bc-sk-fields" onKeyDown={onFieldKey}>
        <NumberField
          id="bc-ex-distance"
          label={f.direction === "symmetric" ? "Total" : "Distance"}
          value={f.distance}
          onChange={(v) => x.change({ distance: v })}
          onCommit={(v) => x.change({ distance: v })}
        />
        {f.direction === "two" && (
          <NumberField
            label="Other side"
            value={f.distance2 ?? 0}
            min={0}
            onChange={(v) => x.change({ distance2: v })}
            onCommit={(v) => x.change({ distance2: v })}
          />
        )}
      </span>
      <MenuButton label="Direction" entries={directions} trigger={(p) => <Button {...p} label={direction.label} title="Which way it goes from the sketch" />} />
      <span role="group" aria-label="Operation" className="bc-segmented">
        {OPERATIONS.map((o) => (
          <Button key={o.id} label={o.label} title={o.title} on={f.operation === o.id} onClick={() => x.setOperation(o.id)} />
        ))}
      </span>
      {f.operation !== "new" &&
        (others.length ? (
          <MenuButton
            label="Body"
            entries={targets}
            trigger={(p) => <Button {...p} label={target ? target.name : "Pick a body"} title="The body it changes" />}
          />
        ) : (
          <span className="bc-armed-note">There is no body to change yet.</span>
        ))}
      <Button kind="cancel" label="Cancel" title="Take the extrude back" shortcut="Esc" onClick={x.cancel} />
      <Button kind="done" label="Done" title="Keep the extrude" shortcut="Enter" disabled={!x.picked} onClick={x.done} />
    </ArmedBar>
  );
}
