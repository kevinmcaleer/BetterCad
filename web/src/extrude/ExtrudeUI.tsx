import type { KeyboardEvent } from "react";
import { ArmedBar, Button, MenuButton, NumberField, type MenuEntry, type Scope } from "@bettercad/ui";
import type { Part } from "../state/document";
import { DIRECTIONS, OPERATIONS, type ExtrudeSession } from "./useExtrude";

/**
 * The strip for Extrude (distance and direction) and Revolve (angle and axis): what it does to the model, why it
 * cannot be made when it can't, and Done or Cancel.
 */
export function ExtrudeBar({ x, parts, error, scope }: { x: ExtrudeSession; parts: Part[]; error?: string; scope?: Scope }) {
  const f = x.feature;
  const title = x.kind === "revolve" ? "Revolve" : "Extrude";
  const icon = x.kind === "revolve" ? "revolve" : "extrude";
  if (!f) {
    return (
      <ArmedBar title={title} icon={icon}>
        <span className="bc-armed-note">{x.help}</span>
        <Button kind="cancel" label="Cancel" title="Put the tool down" shortcut="Esc" onClick={x.cancel} />
      </ArmedBar>
    );
  }
  // The field's own commit has already gone into the document; finish now, before an Esc could follow.
  const onFieldKey = (e: KeyboardEvent) => {
    if (e.key === "Enter") x.done();
  };
  const others = parts.filter((p) => p.id !== f.body.id);
  const target = others.find((p) => p.id === f.target);
  const targets: MenuEntry[] = others.map((p) => ({ id: p.id, label: p.name, onSelect: () => x.change({ target: p.id }) }));

  let fields;
  if (f.type === "revolve") {
    const lines = (x.sketch?.entities ?? []).filter((e) => e.kind === "line");
    const axes: MenuEntry[] = [
      { id: "x", label: "The sketch's X axis", onSelect: () => x.change({ axis: { kind: "x" } }) },
      { id: "y", label: "The sketch's Y axis", onSelect: () => x.change({ axis: { kind: "y" } }) },
      ...lines.map((l, i) => ({
        id: l.id,
        label: `Line ${i + 1}${"construction" in l && l.construction ? " (construction)" : ""}`,
        onSelect: () => x.change({ axis: { kind: "line" as const, id: l.id } }),
      })),
    ];
    const axis = f.axis;
    const axisLabel = axis.kind === "line" ? `Line ${lines.findIndex((l) => l.id === axis.id) + 1}` : `${axis.kind.toUpperCase()} axis`;
    fields = (
      <>
        <span className="bc-sk-fields" onKeyDown={onFieldKey}>
          <NumberField
            id="bc-ex-distance"
            label="Angle"
            unit="°"
            value={f.angle}
            min={1}
            max={360}
            scope={scope}
            onChange={(v) => x.change({ angle: v })}
            onCommit={(v, expr) => {
              x.change({ angle: v });
              x.setFieldExpr("angle", expr);
            }}
          />
        </span>
        <MenuButton label="Axis" entries={axes} trigger={(p) => <Button {...p} label={`Round the ${axisLabel}`} title="The line it turns round" />} />
        <Button label="Symmetric" title="Turn half the angle each way" on={!!f.symmetric} onClick={() => x.change({ symmetric: !f.symmetric })} />
      </>
    );
  } else {
    const directions: MenuEntry[] = DIRECTIONS.map((d) => ({ id: d.id, label: d.label, onSelect: () => x.change({ direction: d.id }) }));
    const direction = DIRECTIONS.find((d) => d.id === f.direction)!;
    fields = (
      <>
        <span className="bc-sk-fields" onKeyDown={onFieldKey}>
          <NumberField
            id="bc-ex-distance"
            label={f.direction === "symmetric" ? "Total" : "Distance"}
            value={f.distance}
            scope={scope}
            onChange={(v) => x.change({ distance: v })}
            onCommit={(v, expr) => {
              x.change({ distance: v });
              x.setFieldExpr("distance", expr);
            }}
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
        <MenuButton
          label="Direction"
          entries={directions}
          trigger={(p) => <Button {...p} label={direction.label} title="Which way it goes from the sketch" />}
        />
      </>
    );
  }
  return (
    <ArmedBar title={title} icon={icon}>
      {fields}
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
      {error && (
        <span className="bc-armed-note bc-armed-error" role="alert">
          {error}
        </span>
      )}
      <Button kind="cancel" label="Cancel" title={`Take the ${x.kind} back`} shortcut="Esc" onClick={x.cancel} />
      <Button kind="done" label="Done" title={`Keep the ${x.kind}`} shortcut="Enter" disabled={!x.picked} onClick={x.done} />
    </ArmedBar>
  );
}
