import { Button, FeatureCheck, FeaturePanel, FeaturePicker, FeatureRow, MenuButton, NumberField, PanelNote, type MenuEntry, type Scope } from "@bettercad/ui";
import type { Part } from "../state/document";
import { refText, throughAllAllowed, type AxisRef } from "../state/document";
import { DIRECTIONS, EXTENTS, OPERATIONS, type ExtrudeSession } from "./useExtrude";

/**
 * The settings panel for Extrude (distance and direction) and Revolve (angle and axis): one row per setting, like
 * Fusion's feature dialog, why it cannot be made when it can't, then Cancel and OK.
 */
export function ExtrudeBar({ x, parts, error, scope }: { x: ExtrudeSession; parts: Part[]; error?: string; scope?: Scope }) {
  const f = x.feature;
  const title = x.kind === "revolve" ? "Revolve" : "Extrude";
  const icon = x.kind === "revolve" ? "revolve" : "extrude";
  if (!f) {
    return (
      <FeaturePanel title={title} icon={icon} cancel={{ title: "Put the tool down", onClick: x.cancel }}>
        <PanelNote>{x.help}</PanelNote>
      </FeaturePanel>
    );
  }
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

  const profile = (
    <>
      <FeaturePicker
        label="Profile"
        count={x.picked}
        empty="Pick shapes"
        picking={x.pickingShapes}
        title={`The closed shapes it ${x.kind === "revolve" ? "turns" : "pushes"}. Pick them again in the view, or clear them and start over.`}
        entries={[
          { id: "pick", label: "Pick in the view", checked: x.pickingShapes, onSelect: () => x.repickShapes() },
          { id: "clear", label: "Clear and pick again", onSelect: () => x.repickShapes(true) },
        ]}
        onClear={() => x.repickShapes(true)}
        clearTitle="Clear the shapes and pick again"
      />
      {x.pickingShapes && (
        <div className="bc-fpanel-pick">
          <PanelNote live>Click shapes to add them or take them out.</PanelNote>
          <Button size="dense" label="Done picking" title="Stop picking shapes" shortcut="Esc" onClick={x.stopShapes} />
        </div>
      )}
    </>
  );

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
    const axisName = !axis
      ? ""
      : axis.kind === "line"
        ? `Line ${lines.findIndex((l) => l.id === axis.id) + 1}`
        : axis.kind === "ref"
          ? refText(axis.ref, (id) => names.get(id))
          : `The sketch's ${axis.kind.toUpperCase()} axis`;
    fields = (
      <>
        <FeaturePicker
          label="Axis"
          count={axis ? 1 : 0}
          empty="Pick an axis"
          picking={x.pickingAxis}
          title={
            axis
              ? `Turns round ${axisName}. Pick another axis, a sketch line or a straight edge.`
              : "What it turns round: an axis, a sketch line or a straight edge"
          }
          entries={axes}
          onClear={() => {
            x.change({ axis: undefined });
            x.repickAxis();
          }}
          clearTitle="Clear the axis and pick again"
        />
        {x.pickingAxis && <PanelNote live>Click an axis, a sketch line or a straight edge</PanelNote>}
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
        <FeatureCheck label="Symmetric" title="Turn half the angle each way" on={!!f.symmetric} onChange={(on) => x.change({ symmetric: on })} />
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
        {!to && (
          <FeatureRow label="Direction">
            <MenuButton
              label="Direction"
              entries={directions}
              trigger={(p) => <Button {...p} label={direction.label} title="Which way it goes from the sketch" />}
            />
          </FeatureRow>
        )}
        <FeatureRow label="Extent">
          <MenuButton
            label="Extent"
            entries={extents}
            trigger={(p) => (
              <Button {...p} label={extentEntry.label} title={canAll ? "How far it goes" : "How far it goes. Through all works with Cut and Intersect."} />
            )}
          />
        </FeatureRow>
        {to ? (
          <PanelNote live>{x.wantTo || !f.to ? "Click a face, edge or point" : `Up to ${upTo}, ${fmtMm(Math.abs(f.distance))}`}</PanelNote>
        ) : all ? (
          f.direction === "one" && (
            <FeatureRow label="Side">
              <Button label="Flip" title="Go the other way from the sketch" onClick={x.flip} />
            </FeatureRow>
          )
        ) : (
          <>
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
          </>
        )}
      </>
    );
  }
  return (
    <FeaturePanel
      title={title}
      icon={icon}
      // The field's own commit has already gone into the document; finish now, before an Esc could follow.
      onFieldEnter={() => x.done()}
      cancel={{ title: `Take the ${x.kind} back`, onClick: x.cancel }}
      ok={{ title: `Keep the ${x.kind}`, disabled: !x.picked || (f.type === "revolve" && !f.axis), onClick: x.done }}
    >
      {profile}
      {fields}
      <FeatureRow label="Operation">
        <span role="group" aria-label="Operation" className="bc-segmented">
          {OPERATIONS.map((o) => (
            <Button key={o.id} label={o.label} title={o.title} on={f.operation === o.id} onClick={() => x.setOperation(o.id)} />
          ))}
        </span>
      </FeatureRow>
      {f.operation !== "new" &&
        (others.length ? (
          <FeatureRow label={many ? "Bodies" : "Body"}>
            <MenuButton label={many ? "Bodies" : "Body"} entries={targets} trigger={(p) => <Button {...p} label={bodiesLabel} title={bodiesTitle} />} />
          </FeatureRow>
        ) : (
          <PanelNote>There is no body to change yet.</PanelNote>
        ))}
      {error && !(f.type === "revolve" && !f.axis) && <PanelNote tone="error">{error}</PanelNote>}
    </FeaturePanel>
  );
}

const fmtMm = (v: number) => `${Math.round(v * 100) / 100} mm`;
