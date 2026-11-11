import { useEffect, type MutableRefObject } from "react";
import { Button, FeaturePanel, FeatureRow, NumberField, PanelNote } from "@bettercad/ui";
import type { MirrorPlane, SplitKeep } from "../state/document";
import { useSplit, type SplitDeps, type SplitSession } from "./useSplit";

const PLANES: MirrorPlane[] = ["XY", "XZ", "YZ"];
const KEEPS: { id: SplitKeep; label: string; title: string }[] = [
  { id: "both", label: "Both", title: "Keep both halves, each a body" },
  { id: "front", label: "Front", title: "Keep the half the plane faces, and throw the other away" },
  { id: "back", label: "Back", title: "Keep the half behind the plane, and throw the other away" },
];

/**
 * The Split body tool (#406) with its panel, loaded when the tool is first picked. The editor keeps a handle for Enter
 * and the help line, and passes in a step to edit from the timeline.
 */
export function SplitTool({
  deps,
  edit,
  onEdited,
  onHelp,
  api,
  error,
}: {
  deps: SplitDeps;
  edit: string | null;
  onEdited: () => void;
  onHelp: (help: string | null) => void;
  api: MutableRefObject<{ done(): void } | null>;
  /** Why the step can't be made, from the build. */
  error?: (id: string) => string | undefined;
}) {
  const x = useSplit(deps);
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
  return <SplitPanel x={x} names={new Map(deps.parts.map((p) => [p.id, p.name]))} error={x.session ? error?.(x.session.id) : undefined} />;
}

/** Split's settings: the body, the plane it splits along, and which halves stay. */
export function SplitPanel({ x, names, error }: { x: SplitSession; names: Map<string, string>; error?: string }) {
  const f = x.feature;
  if (!f) {
    return (
      <FeaturePanel title="Split body" icon="split" cancel={{ title: "Put the tool down", onClick: x.cancel }}>
        <PanelNote>{x.help}</PanelNote>
      </FeaturePanel>
    );
  }
  const custom = !!f.face || !!f.step;
  return (
    <FeaturePanel
      title="Split body"
      icon="split"
      cancel={{ title: "Take the split back", onClick: x.cancel }}
      ok={{ title: "Keep the split", onClick: x.done }}
    >
      <FeatureRow label="Body">
        <span title="Click another body in the view to split it instead">{names.get(f.part) ?? "A gone body"}</span>
      </FeatureRow>
      <FeatureRow label="Plane">
        <span role="group" aria-label="Split plane" className="bc-segmented">
          {PLANES.map((p) => (
            <Button key={p} label={p} title={`Split along the ${p} plane`} on={!custom && !x.pickingPlane && f.plane === p} onClick={() => x.setPlane(p)} />
          ))}
          <Button
            label="Face"
            title="Click a flat face, a construction plane or an origin plane in the view, to split along"
            on={custom || x.pickingPlane}
            onClick={() => x.setPickingPlane(!x.pickingPlane)}
          />
        </span>
      </FeatureRow>
      <NumberField label="Offset" unit="mm" value={f.offset} onCommit={x.setOffset} />
      <FeatureRow label="Keep">
        <span role="group" aria-label="Halves to keep" className="bc-segmented">
          {KEEPS.map((k) => (
            <Button key={k.id} label={k.label} title={k.title} on={f.keep === k.id} onClick={() => x.setKeep(k.id)} />
          ))}
        </span>
      </FeatureRow>
      {x.pickingPlane && <PanelNote>{x.help}</PanelNote>}
      {error && <PanelNote tone="error">{error}</PanelNote>}
    </FeaturePanel>
  );
}
