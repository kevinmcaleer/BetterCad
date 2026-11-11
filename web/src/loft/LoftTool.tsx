import { useEffect, type MutableRefObject } from "react";
import { Button, FeatureCheck, FeaturePanel, FeaturePicker, FeatureRow, MenuButton, PanelNote, type MenuEntry } from "@bettercad/ui";
import { OPERATIONS } from "../extrude/useExtrude";
import { useLoft, type LoftDeps, type LoftSession } from "./useLoft";

/**
 * The Loft tool (#399) with its panel, loaded when the tool is first picked. The editor keeps a handle for Enter and
 * the help line, and passes in a step to edit from the timeline.
 */
export function LoftTool({
  deps,
  edit,
  onEdited,
  onHelp,
  api,
  error,
}: {
  deps: LoftDeps;
  edit: string | null;
  onEdited: () => void;
  onHelp: (help: string | null) => void;
  api: MutableRefObject<{ done(): void } | null>;
  /** Why the step can't be made, from the build. */
  error?: (id: string) => string | undefined;
}) {
  const x = useLoft(deps);
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
  return <LoftPanel x={x} names={new Map(deps.sketches.map((s) => [s.id, s.name]))} parts={deps.parts} error={x.session ? error?.(x.session.id) : undefined} />;
}

/** Loft's settings: the shapes in order, straight or smooth sides, and what it does to the model. */
export function LoftPanel({ x, names, parts, error }: { x: LoftSession; names: Map<string, string>; parts: LoftDeps["parts"]; error?: string }) {
  const f = x.feature;
  if (!f) {
    return (
      <FeaturePanel title="Loft" icon="loft" cancel={{ title: "Put the tool down", onClick: x.cancel }}>
        <PanelNote>{x.help}</PanelNote>
      </FeaturePanel>
    );
  }
  const n = f.sections.length;
  const shapes: MenuEntry[] = [
    ...f.sections.map((s, i) => ({
      id: `${i}`,
      label: `Take out ${i + 1}: ${names.get(s.sketch) ?? "a gone sketch"}`,
      onSelect: () => x.remove(i),
    })),
    ...(n ? [{ kind: "separator" as const, id: "sep" }] : []),
    { id: "clear", label: "Clear and pick again", onSelect: x.clear },
  ];
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
      title="Loft"
      icon="loft"
      cancel={{ title: "Take the loft back", onClick: x.cancel }}
      ok={{ title: "Keep the loft", disabled: n < 2, onClick: x.done }}
    >
      <FeaturePicker
        label="Profiles"
        count={n}
        empty="Pick shapes"
        title="The closed shapes it runs through, in order, one on each plane. Click shapes in the view to add them, or a picked one to take it out."
        named={n === 1 ? "1 shape" : undefined}
        entries={shapes}
        onClear={x.clear}
        clearTitle="Clear the shapes and pick again"
      />
      {n > 0 && <PanelNote>{`${n === 1 ? "From" : "Through"} ${f.sections.map((s) => names.get(s.sketch) ?? "a gone sketch").join(", then ")}`}</PanelNote>}
      <FeatureCheck label="Straight sides" title="Flat sides from one shape to the next, not one smooth surface" on={!!f.ruled} onChange={x.setRuled} />
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
      {error && n >= 2 && <PanelNote tone="error">{error}</PanelNote>}
    </FeaturePanel>
  );
}
