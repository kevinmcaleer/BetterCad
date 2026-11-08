import type { KeyboardEvent } from "react";
import { ArmedBar, Button, MenuButton, NumberField, type MenuEntry } from "@bettercad/ui";
import { copiesWhat, type MirrorOf, type MirrorPlane, type PatternKind, type WorldAxis } from "../state/document";
import type { PatternSession } from "./usePattern";

const KINDS: { id: PatternKind; label: string; title: string }[] = [
  { id: "mirror", label: "Mirror", title: "A mirror image across a plane" },
  { id: "rect", label: "Rectangle", title: "Copies in a row, or rows and columns" },
  { id: "circle", label: "Circle", title: "Copies round an axis" },
];
const PLANES: MirrorPlane[] = ["YZ", "XZ", "XY"];
const OFS: { id: MirrorOf; label: string; title: string }[] = [
  { id: "bodies", label: "Bodies", title: "Mirror whole bodies" },
  { id: "features", label: "Features", title: "Mirror the cuts, joins and holes of steps on the timeline onto the same bodies" },
  { id: "component", label: "Component", title: "Mirror every body in a component, as a new component" },
];
const PATTERN_OFS: { id: MirrorOf; label: string; title: string }[] = [
  { id: "bodies", label: "Bodies", title: "Copy whole bodies" },
  { id: "features", label: "Features", title: "Copy the cuts, joins and holes of steps on the timeline onto the same bodies" },
];

/** What a Mirror or Pattern copies, and the picks for features or a component: on the bar before the step starts, and after. */
function CopyWhat({ x }: { x: PatternSession }) {
  const mirror = x.kind === "mirror";
  const f = x.feature;
  const ticked = f?.features ?? [];
  const featureEntries: MenuEntry[] = x.mirrorable.length
    ? x.mirrorable.map((m) => ({ id: m.id, label: m.name, checked: ticked.includes(m.id), multiple: true, onSelect: () => x.toggleFeature(m.id) }))
    : [{ id: "none", label: `No cuts, joins or holes to ${mirror ? "mirror" : "copy"} yet`, disabled: true, onSelect: () => {} }];
  const linkEntries: MenuEntry[] = x.links.length
    ? x.links.map((l) => ({ id: l.id, label: l.name, checked: f?.link === l.id, onSelect: () => x.pick({ link: l.id }) }))
    : [{ id: "none", label: "No components yet. Make one with Link.", disabled: true, onSelect: () => {} }];
  const names = (ids: string[]) => ids.map((id) => x.mirrorable.find((m) => m.id === id)?.name ?? "a gone step");
  const featureLabel = ticked.length ? (ticked.length > 2 ? `${ticked.length} features` : names(ticked).join(", ")) : "Choose features";
  const linkLabel = f?.link ? (x.links.find((l) => l.id === f.link)?.name ?? "A gone component") : "Choose component";
  return (
    <>
      <span role="group" aria-label={mirror ? "Mirror what" : "Copy what"} className="bc-segmented">
        {(mirror ? OFS : PATTERN_OFS).map((o) => (
          <Button key={o.id} label={o.label} title={o.title} on={x.of === o.id} onClick={() => x.setOf(o.id)} />
        ))}
      </span>
      {x.of === "features" && (
        <MenuButton
          label={mirror ? "Features to mirror" : "Features to copy"}
          entries={featureEntries}
          trigger={(p) => <Button {...p} label={featureLabel} title={`The steps whose cuts, joins and holes are ${mirror ? "mirrored" : "copied"}`} />}
        />
      )}
      {mirror && x.of === "component" && (
        <MenuButton label="Component to mirror" entries={linkEntries} trigger={(p) => <Button {...p} label={linkLabel} title="The component to mirror" />} />
      )}
    </>
  );
}
const AXES: WorldAxis[] = ["x", "y", "z"];

function Axes({ label, value, onChange }: { label: string; value: WorldAxis; onChange: (a: WorldAxis) => void }) {
  return (
    <span role="group" aria-label={label} className="bc-segmented">
      {AXES.map((a) => (
        <Button key={a} label={a.toUpperCase()} title={`${label}: along ${a.toUpperCase()}`} on={value === a} onClick={() => onChange(a)} />
      ))}
    </span>
  );
}

/** X, Y, Z or a construction axis, for a circular pattern to turn round. */
function TurnAxis({ x }: { x: PatternSession }) {
  const f = x.feature!;
  const axes = x.construct.filter((c) => c.geo.what === "axis").map((c) => ({ id: c.id, name: x.nameOf(c.id) ?? "Axis" }));
  const entries: MenuEntry[] = axes.length
    ? axes.map((a) => ({
        id: a.id,
        label: a.name,
        checked: f.axisStep === a.id,
        onSelect: () => {
          x.setPickingAxis(false);
          x.change({ axisStep: a.id });
        },
      }))
    : [{ id: "none", label: "No construction axes yet. Make one with Construct.", disabled: true, onSelect: () => {} }];
  return (
    <span role="group" aria-label="Axis" className="bc-segmented">
      {AXES.map((a) => (
        <Button
          key={a}
          label={a.toUpperCase()}
          title={`Axis: round ${a.toUpperCase()}`}
          on={!f.axisStep && !x.pickingAxis && f.axis === a}
          onClick={() => {
            x.setPickingAxis(false);
            x.change({ axis: a, axisStep: undefined });
          }}
        />
      ))}
      <Button
        label={f.axisStep ? (x.nameOf(f.axisStep) ?? "Axis") : "Pick axis"}
        title="Click a construction axis in the view to turn round, such as Axis 1"
        on={!!f.axisStep || x.pickingAxis}
        onClick={() => x.setPickingAxis(!x.pickingAxis)}
      />
      <MenuButton
        label="Construction axes"
        entries={entries}
        trigger={(p) => <Button {...p} icon="chevronDown" title="Choose a construction axis to turn round" />}
      />
    </span>
  );
}

/** The strip for Mirror and Pattern (#69): the kind, its settings, Join, Cancel and Done. */
export function PatternBar({ x, error, onCancel }: { x: PatternSession; error?: string; onCancel: () => void }) {
  const f = x.feature;
  if (!f) {
    return (
      <ArmedBar title={x.kind === "mirror" ? "Mirror" : "Pattern"} icon={x.kind === "mirror" ? "flipH" : "distributeH"}>
        <CopyWhat x={x} />
        <span className="bc-armed-note">{x.help}</span>
        <Button kind="cancel" label="Cancel" title="Put the tool down" shortcut="Esc" onClick={onCancel} />
      </ArmedBar>
    );
  }
  const onFieldKey = (e: KeyboardEvent) => {
    if (e.key === "Enter") x.done();
  };
  const n = f.parts.length;
  const k = f.features?.length ?? 0;
  const of = copiesWhat(f);
  const what =
    of === "features"
      ? k === 1
        ? "1 feature"
        : `${k} features`
      : of === "component"
        ? (x.links.find((l) => l.id === f.link)?.name ?? "the component")
        : n === 1
          ? "1 body"
          : `${n} bodies`;
  return (
    <ArmedBar title={f.kind === "mirror" ? "Mirror" : "Pattern"} icon={f.kind === "mirror" ? "flipH" : "distributeH"}>
      <span role="group" aria-label="Kind" className="bc-segmented">
        {KINDS.map((k) => (
          <Button key={k.id} label={k.label} title={k.title} on={f.kind === k.id} onClick={() => x.change({ kind: k.id })} />
        ))}
      </span>
      <CopyWhat x={x} />
      {f.kind === "mirror" && (
        <span role="group" aria-label="Mirror plane" className="bc-segmented">
          {PLANES.map((p) => (
            <Button
              key={p}
              label={p}
              title={`Mirror across the ${p} plane`}
              on={!f.face && !f.step && !x.pickingPlane && f.plane === p}
              onClick={() => {
                x.setPickingPlane(false);
                x.change({ plane: p, face: undefined, step: undefined });
              }}
            />
          ))}
          <Button
            label="Face"
            title="Click a flat face, a construction plane or an origin plane in the view, to mirror across"
            on={!!f.face || !!f.step || x.pickingPlane}
            onClick={() => x.setPickingPlane(!x.pickingPlane)}
          />
        </span>
      )}
      {f.kind === "circle" && <TurnAxis x={x} />}
      {f.kind === "rect" && <Axes label="Direction" value={f.dir1} onChange={(dir1) => x.change({ dir1 })} />}
      <span className="bc-sk-fields" onKeyDown={onFieldKey}>
        {f.kind === "mirror" && <NumberField label="Offset" unit="mm" value={f.offset} onCommit={(v) => x.change({ offset: v })} />}
        {f.kind === "rect" && (
          <>
            <NumberField label="Count" value={f.count1} unit="none" precision={0} min={1} onCommit={(v) => x.change({ count1: Math.round(v) })} />
            <NumberField label="Spacing" unit="mm" value={f.spacing1} onCommit={(v) => x.change({ spacing1: v })} />
            <NumberField label="Rows" value={f.count2} unit="none" precision={0} min={1} onCommit={(v) => x.change({ count2: Math.round(v) })} />
            {f.count2 > 1 && <NumberField label="Row spacing" unit="mm" value={f.spacing2} onCommit={(v) => x.change({ spacing2: v })} />}
          </>
        )}
        {f.kind === "circle" && (
          <>
            <NumberField label="Count" value={f.count} unit="none" precision={0} min={2} onCommit={(v) => x.change({ count: Math.round(v) })} />
            <NumberField label="Angle" unit="°" value={f.angle} min={1} max={360} onCommit={(v) => x.change({ angle: v })} />
          </>
        )}
      </span>
      {f.kind === "rect" && f.count2 > 1 && <Axes label="Rows along" value={f.dir2} onChange={(dir2) => x.change({ dir2 })} />}
      {/* Copied features land on the same body; only bodies a feature made have copies to join. */}
      {(of !== "features" || f.parts.length > 0) && (
        <Button label="Join" title="Join each copy to its original, for one printable body" on={f.join} onClick={() => x.change({ join: !f.join })} />
      )}
      <span className="bc-armed-note">
        {f.kind === "mirror"
          ? x.pickingPlane
            ? "Click a flat face, a construction plane or an origin plane."
            : `Mirroring ${what} across ${f.step ? (x.stepName ?? "a construction plane") : f.face ? "a face" : f.plane}.`
          : f.kind === "rect"
            ? `Copying ${what} in rows.`
            : x.pickingAxis
              ? "Click a construction axis."
              : `Copying ${what} round ${f.axisStep ? (x.nameOf(f.axisStep) ?? "an axis") : `the ${f.axis.toUpperCase()} axis`}.`}
      </span>
      {error && (
        <span className="bc-armed-note bc-armed-error" role="alert">
          {error}
        </span>
      )}
      <Button kind="cancel" label="Cancel" title="Take the copies back" shortcut="Esc" onClick={x.cancel} />
      <Button kind="done" label="Done" title="Keep the copies" shortcut="Enter" onClick={x.done} />
    </ArmedBar>
  );
}
