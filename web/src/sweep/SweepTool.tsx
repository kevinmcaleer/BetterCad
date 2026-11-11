import { useEffect, type MutableRefObject } from "react";
import { Button, FeaturePanel, FeaturePicker, FeatureRow, MenuButton, PanelNote, type MenuEntry } from "@bettercad/ui";
import { OPERATIONS } from "../extrude/useExtrude";
import { useSweep, type SweepDeps, type SweepSession } from "./useSweep";

/**
 * The Sweep tool (#400) with its panel, loaded when the tool is first picked. The editor keeps a handle for Enter and
 * the help line, and passes in a step to edit from the timeline.
 */
export function SweepTool({
  deps,
  edit,
  onEdited,
  onHelp,
  api,
  error,
}: {
  deps: SweepDeps;
  edit: string | null;
  onEdited: () => void;
  onHelp: (help: string | null) => void;
  api: MutableRefObject<{ done(): void } | null>;
  /** Why the step can't be made, from the build. */
  error?: (id: string) => string | undefined;
}) {
  const x = useSweep(deps);
  api.current = x;
  useEffect(() => {
    if (!edit) return;
    x.edit(edit);
    onEdited();
  }, [edit, x, onEdited]);
  useEffect(() => onHelp(x.help), [x.help, onHelp]);
  useEffect(
    () => () => {
      onHelp(null);
      api.current = null;
    },
    [onHelp, api],
  );
  return (
    <SweepPanel x={x} names={new Map(deps.sketches.map((s) => [s.id, s.name]))} parts={deps.parts} error={x.session ? error?.(x.session.id) : undefined} />
  );
}

/** Sweep's settings: the shapes, the path, and what it does to the model. */
export function SweepPanel({ x, names, parts, error }: { x: SweepSession; names: Map<string, string>; parts: SweepDeps["parts"]; error?: string }) {
  const f = x.feature;
  if (!f) {
    return (
      <FeaturePanel title="Sweep" icon="sweep" cancel={{ title: "Put the tool down", onClick: x.cancel }}>
        <PanelNote>{x.help}</PanelNote>
      </FeaturePanel>
    );
  }
  const n = f.seeds.length + (f.texts?.length ?? 0);
  const k = f.path?.curves.length ?? 0;
  const sketchName = (id: string) => names.get(id) ?? "a gone sketch";
  const others = parts.filter((p) => p.id !== f.body.id);
  const many = f.operation !== "join";
  const chosen = others.filter((p) => x.targets.includes(p.id));
  const targets: MenuEntry[] = others.map((p) => ({
    id: p.id,
    label: p.name,
    checked: x.targets.includes(p.id),
    multiple: many,
    onSelect: () => (many ? x.toggleTarget(p.id) : x.setTargets([p.id])),
  }));
  const bodiesLabel = chosen.length === 0 ? (many ? "Pick bodies" : "Pick a body") : chosen.length === 1 ? chosen[0]!.name : `${chosen.length} bodies`;
  return (
    <FeaturePanel
      title="Sweep"
      icon="sweep"
      cancel={{ title: "Take the sweep back", onClick: x.cancel }}
      ok={{ title: "Keep the sweep", disabled: !n || !k, onClick: x.done }}
    >
      <FeaturePicker
        label="Profiles"
        count={n}
        empty="Pick shapes"
        title="The closed shapes it pushes along the path. Click shapes in the view to add them, or a picked one to take it out."
        named="1 shape"
        onClear={x.clearShapes}
        clearTitle="Clear the shapes and pick again"
      />
      <FeaturePicker
        label="Path"
        count={k}
        empty="Pick a path"
        title="The lines and arcs it runs along, end to end, in a sketch on another plane. A circle is a path on its own."
        named="1 curve"
        onClear={x.clearPath}
        clearTitle="Clear the path and pick again"
      />
      {n > 0 && (
        <PanelNote>{`${n === 1 ? "1 shape" : `${n} shapes`} in ${sketchName(f.sketch)}${f.path && k ? `, along ${k === 1 ? "1 curve" : `${k} curves`} in ${sketchName(f.path.sketch)}` : ""}`}</PanelNote>
      )}
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
            <MenuButton
              label={many ? "Bodies" : "Body"}
              entries={targets}
              trigger={(p) => <Button {...p} label={bodiesLabel} title="The bodies it changes. Click bodies in the view to pick them." />}
            />
          </FeatureRow>
        ) : (
          <PanelNote>There is no body to change yet.</PanelNote>
        ))}
      {error && n > 0 && k > 0 && <PanelNote tone="error">{error}</PanelNote>}
    </FeaturePanel>
  );
}
