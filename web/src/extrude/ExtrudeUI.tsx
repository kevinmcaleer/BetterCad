import type { KeyboardEvent } from "react";
import { ArmedBar, Button, MenuButton, NumberField, type MenuEntry, type Scope } from "@bettercad/ui";
import type { Part } from "../state/document";
import { refText, throughAllAllowed, type AxisRef } from "../state/document";
import { DIRECTIONS, EXTENTS, OPERATIONS, type ExtrudeSession } from "./useExtrude";

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
  const chosen = others.filter((p) => x.targets.includes(p.id));
  // Join changes one body; Cut and Intersect tick as many as you like.
  const many = f.operation !== "join";
  const targets: MenuEntry[] = others.map((p) => ({
    id: p.id,
    label: p.name,
    checked: x.targets.includes(p.id),
    multiple: many,
    onSelect: () => (many ? x.toggleTarget(p.id) : x.setTargets([p.id])),
  }));
  if (many && others.length > 1)
    targets.push(
      { kind: "separator", id: "sep" },
      { id: "all-bodies", label: "Every body", onSelect: () => x.setTargets(others.filter((p) => !p.reference).map((p) => p.id)) },
    );
  const bodiesLabel = chosen.length === 0 ? (many ? "Pick bodies" : "Pick a body") : chosen.length === 1 ? chosen[0]!.name : `${chosen.length} bodies`;
  const bodiesTitle = many
    ? `The bodies it ${f.operation === "cut" ? "cuts" : "intersects"}. Click bodies in the view or the browser to add or take them out.`
    : "The body it changes. Click a body in the view or the browser to pick it.";

  let fields;
  if (f.type === "revolve") {
    const lines = (x.sketch?.entities ?? []).filter((e) => e.kind === "line");
    const set = (axis: AxisRef) => () => x.pickAxis(axis);
    const builtAxes = x.construct.filter((c) => c.geo.what === "axis");
    // Picking in the view first; then the axes it can take by name. Sketch lines are picked in the view (a sketch can
    // have dozens), but its construction lines are listed too.
    const axes: MenuEntry[] = [
      { id: "pick", label: "Pick in the view", checked: x.pickingAxis, onSelect: x.repickAxis },
      { kind: "separator", id: "sep-sketch" },
      { id: "x", label: "The sketch's X axis", onSelect: set({ kind: "x" }) },
      { id: "y", label: "The sketch's Y axis", onSelect: set({ kind: "y" }) },
      ...lines
        .map((l, i) => ({ l, i }))
        .filter(({ l }) => "construction" in l && l.construction)
        .map(({ l, i }) => ({ id: l.id, label: `Line ${i + 1} (construction)`, onSelect: set({ kind: "line", id: l.id }) })),
      { kind: "separator", id: "sep-origin" },
      ...(["X", "Y", "Z"] as const).map((o) => ({ id: `origin:${o}`, label: `The ${o} axis`, onSelect: set({ kind: "ref", ref: { origin: o } }) })),
      ...builtAxes.map((c) => ({ id: c.id, label: c.name, onSelect: set({ kind: "ref", ref: { step: c.id } }) })),
    ];
    const names = new Map<string, string>([...parts.map((p) => [p.id, p.name] as const), ...x.construct.map((c) => [c.id, c.name] as const)]);
    const axis = f.axis;
    const axisLabel = !axis
      ? "Pick an axis"
      : axis.kind === "line"
        ? `Round Line ${lines.findIndex((l) => l.id === axis.id) + 1}`
        : axis.kind === "ref"
          ? `Round ${refText(axis.ref, (id) => names.get(id))}`
          : `Round the sketch's ${axis.kind.toUpperCase()} axis`;
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
        <MenuButton
          label="Axis"
          entries={axes}
          trigger={(p) => <Button {...p} label={axisLabel} on={x.pickingAxis} title="What it turns round: an axis, a sketch line or a straight edge" />}
        />
        {x.pickingAxis && (
          <span className="bc-armed-note" role="status">
            Click an axis, a sketch line or a straight edge
          </span>
        )}
        <Button label="Symmetric" title="Turn half the angle each way" on={!!f.symmetric} onClick={() => x.change({ symmetric: !f.symmetric })} />
      </>
    );
  } else {
    const directions: MenuEntry[] = DIRECTIONS.map((d) => ({ id: d.id, label: d.label, onSelect: () => x.change({ direction: d.id }) }));
    const direction = DIRECTIONS.find((d) => d.id === f.direction)!;
    const canAll = throughAllAllowed(f.operation);
    const all = f.extent === "all" && canAll && !x.wantTo;
    const to = x.wantTo || f.extent === "to";
    const now = to ? "to" : all ? "all" : "distance";
    const extents: MenuEntry[] = EXTENTS.map((e) => ({
      id: e.id,
      label: e.label,
      checked: now === e.id,
      disabled: e.id === "all" && !canAll,
      onSelect: () => x.setExtent(e.id),
    }));
    const extentEntry = EXTENTS.find((e) => e.id === now)!;
    const upTo = f.to?.kind === "vertex" ? "a point" : f.to?.kind === "edge" ? "an edge" : "a face";
    fields = (
      <>
        <MenuButton
          label="Extent"
          entries={extents}
          trigger={(p) => (
            <Button {...p} label={extentEntry.label} title={canAll ? "How far it goes" : "How far it goes. Through all works with Cut and Intersect."} />
          )}
        />
        {to ? (
          <span className="bc-armed-note" role="status">
            {x.wantTo || !f.to ? "Click a face, edge or point" : `Up to ${upTo}, ${fmtMm(Math.abs(f.distance))}`}
          </span>
        ) : all ? (
          f.direction === "one" && <Button label="Flip" title="Go the other way from the sketch" onClick={x.flip} />
        ) : (
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
        )}
        {!to && (
          <MenuButton
            label="Direction"
            entries={directions}
            trigger={(p) => <Button {...p} label={direction.label} title="Which way it goes from the sketch" />}
          />
        )}
      </>
    );
  }
  return (
    <ArmedBar title={title} icon={icon}>
      <MenuButton
        label="Shapes"
        entries={[
          { id: "pick", label: "Pick in the view", checked: x.pickingShapes, onSelect: () => x.repickShapes() },
          { id: "clear", label: "Clear and pick again", onSelect: () => x.repickShapes(true) },
        ]}
        trigger={(p) => (
          <Button
            {...p}
            label={x.picked ? (x.picked === 1 ? "1 shape" : `${x.picked} shapes`) : "Pick shapes"}
            on={x.pickingShapes}
            title={`The closed shapes it ${x.kind === "revolve" ? "turns" : "pushes"}. Pick them again in the view, or clear them and start over.`}
          />
        )}
      />
      {x.pickingShapes && <Button label="Done picking" title="Stop picking shapes" shortcut="Esc" onClick={x.stopShapes} />}
      {fields}
      <span role="group" aria-label="Operation" className="bc-segmented">
        {OPERATIONS.map((o) => (
          <Button key={o.id} label={o.label} title={o.title} on={f.operation === o.id} onClick={() => x.setOperation(o.id)} />
        ))}
      </span>
      {f.operation !== "new" &&
        (others.length ? (
          <MenuButton label={many ? "Bodies" : "Body"} entries={targets} trigger={(p) => <Button {...p} label={bodiesLabel} title={bodiesTitle} />} />
        ) : (
          <span className="bc-armed-note">There is no body to change yet.</span>
        ))}
      {error && !(f.type === "revolve" && !f.axis) && (
        <span className="bc-armed-note bc-armed-error" role="alert">
          {error}
        </span>
      )}
      <Button kind="cancel" label="Cancel" title={`Take the ${x.kind} back`} shortcut="Esc" onClick={x.cancel} />
      <Button
        kind="done"
        label="Done"
        title={`Keep the ${x.kind}`}
        shortcut="Enter"
        disabled={!x.picked || (f.type === "revolve" && !f.axis)}
        onClick={x.done}
      />
    </ArmedBar>
  );
}

const fmtMm = (v: number) => `${Math.round(v * 100) / 100} mm`;
