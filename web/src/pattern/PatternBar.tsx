import { Button, FeatureCheck, FeaturePanel, FeatureRow, MenuButton, NumberField, PanelNote, type MenuEntry } from "@bettercad/ui";
import { useMemo } from "react";
import { trackFitText } from "@bettercad/kernel/track-fit";
import { copiesWhat, TRACK_DEFAULTS, type MirrorOf, type MirrorPlane, type PatternKind, type WorldAxis } from "../state/document";
import type { PatternSession } from "./usePattern";
import { fillTrack, TRACK_HELP, trackLayout, type TrackSlot } from "./trackPick";

const KINDS: { id: PatternKind; label: string; title: string }[] = [
  { id: "mirror", label: "Mirror", title: "A mirror image across a plane" },
  { id: "rect", label: "Rectangle", title: "Copies in a row, or rows and columns" },
  { id: "circle", label: "Circle", title: "Copies round an axis" },
  { id: "track", label: "Track", title: "One piece repeated round two or more wheels, joined end to end, like a tank track" },
];
const PLANES: MirrorPlane[] = ["YZ", "XZ", "XY"];
const OFS: { id: MirrorOf; label: string; title: string }[] = [
  { id: "bodies", label: "Bodies", title: "Mirror whole bodies" },
  { id: "features", label: "Features", title: "Mirror the cuts, joins, holes, fillets and chamfers of steps on the timeline onto the same bodies" },
  { id: "component", label: "Component", title: "Mirror every body in a component, as a new component" },
];
const PATTERN_OFS: { id: MirrorOf; label: string; title: string }[] = [
  { id: "bodies", label: "Bodies", title: "Copy whole bodies" },
  { id: "features", label: "Features", title: "Copy the cuts, joins, holes, fillets and chamfers of steps on the timeline onto the same bodies" },
];

/** What a Mirror or Pattern copies, and the picks for features or a component: on the bar before the step starts, and after. */
function CopyWhat({ x }: { x: PatternSession }) {
  const mirror = x.kind === "mirror";
  const f = x.feature;
  const ticked = f?.features ?? [];
  const featureEntries: MenuEntry[] = x.mirrorable.length
    ? x.mirrorable.map((m) => ({ id: m.id, label: m.name, checked: ticked.includes(m.id), multiple: true, onSelect: () => x.toggleFeature(m.id) }))
    : [{ id: "none", label: `No cuts, joins, holes or fillets to ${mirror ? "mirror" : "copy"} yet`, disabled: true, onSelect: () => {} }];
  const linkEntries: MenuEntry[] = x.links.length
    ? x.links.map((l) => ({ id: l.id, label: l.name, checked: f?.link === l.id, onSelect: () => x.pick({ link: l.id }) }))
    : [{ id: "none", label: "No components yet. Make one with Link.", disabled: true, onSelect: () => {} }];
  const names = (ids: string[]) => ids.map((id) => x.mirrorable.find((m) => m.id === id)?.name ?? "a gone step");
  const featureLabel = ticked.length ? (ticked.length > 2 ? `${ticked.length} features` : names(ticked).join(", ")) : "Choose features";
  const linkLabel = f?.link ? (x.links.find((l) => l.id === f.link)?.name ?? "A gone component") : "Choose component";
  return (
    <>
      <FeatureRow label={mirror ? "Mirror" : "Copy"}>
        <span role="group" aria-label={mirror ? "Mirror what" : "Copy what"} className="bc-segmented">
          {(mirror ? OFS : PATTERN_OFS).map((o) => (
            <Button key={o.id} label={o.label} title={o.title} on={x.of === o.id} onClick={() => x.setOf(o.id)} />
          ))}
        </span>
      </FeatureRow>
      {x.of === "features" && (
        <FeatureRow label="Features">
          <MenuButton
            label={mirror ? "Features to mirror" : "Features to copy"}
            entries={featureEntries}
            trigger={(p) => (
              <Button {...p} label={featureLabel} title={`The steps whose cuts, joins, holes, fillets and chamfers are ${mirror ? "mirrored" : "copied"}`} />
            )}
          />
        </FeatureRow>
      )}
      {mirror && x.of === "component" && (
        <FeatureRow label="Component">
          <MenuButton label="Component to mirror" entries={linkEntries} trigger={(p) => <Button {...p} label={linkLabel} title="The component to mirror" />} />
        </FeatureRow>
      )}
    </>
  );
}
const AXES: WorldAxis[] = ["x", "y", "z"];

function Axes({ label, row, value, onChange }: { label: string; row: string; value: WorldAxis; onChange: (a: WorldAxis) => void }) {
  return (
    <FeatureRow label={row}>
      <span role="group" aria-label={label} className="bc-segmented">
        {AXES.map((a) => (
          <Button key={a} label={a.toUpperCase()} title={`${label}: along ${a.toUpperCase()}`} on={value === a} onClick={() => onChange(a)} />
        ))}
      </span>
    </FeatureRow>
  );
}

/** X, Y, Z, a construction axis, or a round edge or face on the model, for a circular pattern to turn round. */
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
          x.change({ axisStep: a.id, axisRef: undefined });
        },
      }))
    : [{ id: "none", label: "No construction axes yet. Make one with Construct.", disabled: true, onSelect: () => {} }];
  return (
    <FeatureRow label="Axis">
      <span role="group" aria-label="Axis" className="bc-segmented">
        {AXES.map((a) => (
          <Button
            key={a}
            label={a.toUpperCase()}
            title={`Axis: round ${a.toUpperCase()}`}
            on={!f.axisStep && !f.axisRef && !x.pickingAxis && f.axis === a}
            onClick={() => {
              x.setPickingAxis(false);
              x.change({ axis: a, axisStep: undefined, axisRef: undefined });
            }}
          />
        ))}
        <Button
          label={f.axisRef ? ("kind" in f.axisRef && f.axisRef.kind === "face" ? "Face" : "Edge") : f.axisStep ? (x.nameOf(f.axisStep) ?? "Axis") : "Pick axis"}
          title="Click a round edge or face on the model to turn round its centre, or a construction axis"
          on={!!f.axisStep || !!f.axisRef || x.pickingAxis}
          onClick={() => x.setPickingAxis(!x.pickingAxis)}
        />
        <MenuButton
          label="Construction axes"
          entries={entries}
          trigger={(p) => <Button {...p} icon="chevronDown" title="Choose a construction axis to turn round" />}
        />
      </span>
    </FeatureRow>
  );
}

/** A track's picks and line-up: the piece's pins, the wheels, how many pieces, and where they sit. */
function Track({ x }: { x: PatternSession }) {
  const f = x.feature!;
  const t = f.track ?? TRACK_DEFAULTS;
  const lay = useMemo(() => trackLayout(x.doc, f), [x.doc, f]);
  const fits = typeof lay === "string" ? 0 : lay.fits;
  const use = Math.max(2, Math.round(fits));
  const set = (c: Partial<typeof t>) => x.change({ track: { ...t, ...c } });
  const slot = (s: TrackSlot, label: string, title: string, done: boolean) => (
    <Button
      label={x.pickingTrack === s ? "Picking" : label}
      icon={done ? "check" : undefined}
      title={title}
      on={x.pickingTrack === s}
      onClick={() => x.setPickingTrack(x.pickingTrack === s ? null : s)}
    />
  );
  const n = t.wheels.length;
  return (
    <>
      <FeatureRow label="Pins">
        <span role="group" aria-label="Pins" className="bc-segmented">
          {slot("start", "Start", "Pick the pin or hole where the piece joins the one before it", !!t.start)}
          {slot("end", "End", "Pick the pin or hole at its other end, where the next piece joins on", !!t.end)}
        </span>
      </FeatureRow>
      <FeatureRow label="Wheels">
        {slot(
          "wheel",
          n ? `${n} wheel${n === 1 ? "" : "s"}` : "Pick wheels",
          "Pick a round edge on each wheel the track goes round. Click one again to leave it out.",
          n >= 2,
        )}
      </FeatureRow>
      {t.start && t.end && n >= 2 && (
        <>
          <NumberField
            label="Pieces"
            value={t.count}
            unit="none"
            precision={0}
            min={2}
            max={MAX}
            onCommit={(v) => set({ count: Math.max(2, Math.min(MAX, Math.round(v))) })}
          />
          {fits > 0 && (
            <FeatureRow label="Fit">
              <Button
                label={`Use ${use}`}
                title="As many pieces as go round the wheels"
                disabled={use === t.count}
                onClick={() => set({ count: Math.min(MAX, use) })}
              />
            </FeatureRow>
          )}
          {fits > 0 && <PanelNote>{trackFitText(t.count, fits, typeof lay === "string" ? 0 : lay.pitch)}</PanelNote>}
          <NumberField label="Offset" unit="mm" value={t.offset} onCommit={(v) => set({ offset: v })} />
          <NumberField label="Lift" unit="mm" value={t.lift} onCommit={(v) => set({ lift: v })} />
          <NumberField label="Sideways" unit="mm" value={t.side} onCommit={(v) => set({ side: v })} />
          <FeatureCheck
            label="Flip"
            title="Turn the pieces over, so their other side faces the wheels"
            on={!!t.flip}
            onChange={(flip) => set({ flip: flip || undefined })}
          />
          <FeatureRow label="Sit">
            <Button
              label="Sit on wheels"
              title="Set the lift so the pieces' insides sit on the wheels"
              onClick={() => x.change({ track: fillTrack(x.doc, f, t, x.engine(), true) })}
            />
          </FeatureRow>
        </>
      )}
    </>
  );
}
const MAX = 100;

/** The panel for Mirror and Pattern (#69): the kind, what it copies, its settings, Join, Cancel and OK. */
export function PatternBar({ x, error, onCancel }: { x: PatternSession; error?: string; onCancel: () => void }) {
  const f = x.feature;
  if (!f) {
    return (
      <FeaturePanel
        title={x.kind === "mirror" ? "Mirror" : "Pattern"}
        icon={x.kind === "mirror" ? "flipH" : "distributeH"}
        cancel={{ title: "Put the tool down", onClick: onCancel }}
      >
        <CopyWhat x={x} />
        <PanelNote>{x.help}</PanelNote>
      </FeaturePanel>
    );
  }
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
    <FeaturePanel
      title={f.kind === "mirror" ? "Mirror" : "Pattern"}
      icon={f.kind === "mirror" ? "flipH" : "distributeH"}
      onFieldEnter={() => x.done()}
      cancel={{ title: "Take the copies back", onClick: x.cancel }}
      ok={{ title: "Keep the copies", onClick: x.done }}
    >
      <FeatureRow label="Kind">
        <span role="group" aria-label="Kind" className="bc-segmented">
          {KINDS.map((k) => (
            <Button
              key={k.id}
              label={k.label}
              title={k.title}
              on={f.kind === k.id}
              onClick={() => {
                if (k.id !== "track") return x.change({ kind: k.id });
                x.change({ kind: "track", of: "bodies", track: f.track ?? TRACK_DEFAULTS });
                if (!f.track?.start) x.setPickingTrack("start");
              }}
            />
          ))}
        </span>
      </FeatureRow>
      {f.kind !== "track" && <CopyWhat x={x} />}
      {f.kind === "track" && <Track x={x} />}
      {f.kind === "mirror" && (
        <>
          <FeatureRow label="Plane">
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
          </FeatureRow>
          <NumberField label="Offset" unit="mm" value={f.offset} onCommit={(v) => x.change({ offset: v })} />
        </>
      )}
      {f.kind === "circle" && (
        <>
          <TurnAxis x={x} />
          <NumberField label="Count" value={f.count} unit="none" precision={0} min={2} onCommit={(v) => x.change({ count: Math.round(v) })} />
          <NumberField label="Angle" unit="°" value={f.angle} min={1} max={360} onCommit={(v) => x.change({ angle: v })} />
        </>
      )}
      {f.kind === "rect" && (
        <>
          <Axes label="Direction" row="Direction" value={f.dir1} onChange={(dir1) => x.change({ dir1 })} />
          <NumberField label="Count" value={f.count1} unit="none" precision={0} min={1} onCommit={(v) => x.change({ count1: Math.round(v) })} />
          <NumberField label="Spacing" unit="mm" value={f.spacing1} onCommit={(v) => x.change({ spacing1: v })} />
          <NumberField label="Rows" value={f.count2} unit="none" precision={0} min={1} onCommit={(v) => x.change({ count2: Math.round(v) })} />
          {f.count2 > 1 && (
            <>
              <Axes label="Rows along" row="Rows along" value={f.dir2} onChange={(dir2) => x.change({ dir2 })} />
              <NumberField label="Row spacing" unit="mm" value={f.spacing2} onCommit={(v) => x.change({ spacing2: v })} />
            </>
          )}
        </>
      )}
      {/* Copied features land on the same body; only bodies a feature made have copies to join. */}
      {f.kind !== "track" && (of !== "features" || f.parts.length > 0) && (
        <FeatureCheck label="Join" title="Join each copy to its original, for one printable body" on={f.join} onChange={(join) => x.change({ join })} />
      )}
      <PanelNote>
        {f.kind === "mirror"
          ? x.pickingPlane
            ? "Click a flat face, a construction plane or an origin plane."
            : `Mirroring ${what} across ${f.step ? (x.stepName ?? "a construction plane") : f.face ? "a face" : f.plane}.`
          : f.kind === "track"
            ? x.pickingTrack
              ? TRACK_HELP[x.pickingTrack]
              : `Wrapping ${what} round the wheels as a track. The piece becomes its first link.`
            : f.kind === "rect"
              ? `Copying ${what} in rows.`
              : x.pickingAxis
                ? "Click a round edge or face, or an axis."
                : `Copying ${what} round ${f.axisRef ? `the ${"kind" in f.axisRef && f.axisRef.kind === "face" ? "face" : "edge"} you picked` : f.axisStep ? (x.nameOf(f.axisStep) ?? "an axis") : `the ${f.axis.toUpperCase()} axis`}.`}
      </PanelNote>
      {error && <PanelNote tone="error">{error}</PanelNote>}
    </FeaturePanel>
  );
}
