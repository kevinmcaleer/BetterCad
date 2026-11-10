import { useEffect, type MutableRefObject } from "react";
import { createPortal } from "react-dom";
import { Button, FeaturePanel, FeaturePicker, FeatureRow, NumberField, PanelNote, cx } from "@bettercad/ui";
import { loupeBox, loupeHint } from "../sketch/loupe";
import { JOINT_KINDS, limitUnit, type JointKind } from "../state/document";
import { useJoint, type JointDeps, type JointPick, type JointSession, type JointStage } from "./useJoint";

const XYZ = ["X", "Y", "Z"] as const;
const at = (p: number[]) => `${p.map((v) => Math.round(v * 10) / 10 + 0).join(", ")} mm`;

/**
 * The Joint tool's panel (#172), with every field in view, as the Projects scene editor's joint dialog has them: the
 * component that moves and its snap, the one it hangs from and its snap (each snap with where it is and an × to pick
 * it again), how it moves (the kind, in plain words with URDF's name beside it, and its limits) and how it lines up
 * (angle, gap, X, Y and Z offsets, flip). The same panel makes a joint and edits one. Cancel and OK at the foot.
 */
export function JointPanel({ x, error, scope, onCancel }: { x: JointSession; error?: string; scope?: Record<string, number>; onCancel: () => void }) {
  const s = x.settings;
  const unit = limitUnit(s.kind);
  const offset = s.offset ?? [0, 0, 0];
  const comps = x.links;

  const snap = (which: JointPick, where: number[] | null, what: string) => (
    <FeaturePicker
      label="Snap"
      count={where ? 1 : 0}
      named={where ? at(where) : undefined}
      empty={x.target === which ? "Click in the view" : "Pick a snap"}
      picking={x.target === which}
      title={`Pick ${what} in the view`}
      onPick={() => x.setTarget(which)}
      onClear={() => x.clear(which)}
      clearTitle={`Clear ${what}`}
    />
  );
  type Choice = { id: string; name: string };
  const list = (options: Choice[]) =>
    options.map((o) => (
      <option key={o.id} value={o.id}>
        {o.name}
      </option>
    ));
  // Bodies in Base are offered too, below the components: picking one makes it a component.
  const choose = (label: string, value: string, options: Choice[], onPick: (id: string) => void, bodies: Choice[] = []) => (
    <FeatureRow label="Component">
      <select className="bc-select" aria-label={label} value={value} onChange={(e) => e.target.value && onPick(e.target.value)}>
        {value === "" && <option value="">{bodies.length ? "Pick a component or body" : "Pick a component"}</option>}
        {bodies.length ? (
          <>
            {options.length > 0 && <optgroup label="Components">{list(options)}</optgroup>}
            <optgroup label="Bodies (made a component)">{list(bodies)}</optgroup>
          </>
        ) : (
          list(options)
        )}
      </select>
    </FeatureRow>
  );

  return (
    <FeaturePanel
      title={x.session?.isNew === false && x.feature ? `Edit ${x.feature.name}` : "Joint"}
      icon="joint"
      onFieldEnter={() => x.done()}
      cancel={
        x.session
          ? { title: x.session.isNew ? "Take the joint back" : "Put the joint back as it was", onClick: x.cancel }
          : { title: "Put the tool down", onClick: onCancel }
      }
      ok={{ title: x.missing ? `Pick ${x.missing} first` : "Keep the joint", disabled: !x.session || !!x.missing, onClick: x.done }}
    >
      {x.help && <PanelNote live>{x.help}</PanelNote>}
      <section aria-label="Moves" className="bc-fsection">
        <h3 className="bc-fsection-head">{x.child === null ? "Moves" : `Moves: ${x.nameOf(x.child)}`}</h3>
        {choose("The component that moves", x.child ?? "", comps, x.pickChild, x.loose)}
        {snap("child", x.from?.point ?? null, "a snap on the component that moves")}
      </section>
      <section aria-label="Hangs from" className="bc-fsection">
        <h3 className="bc-fsection-head">{x.parent === undefined ? "Hangs from" : `Hangs from: ${x.nameOf(x.parent)}`}</h3>
        {choose(
          "The component it hangs from",
          x.parent === undefined ? "" : (x.parent ?? "base"),
          [{ id: "base", name: "Base" }, ...comps.filter((c) => c.id !== x.child)],
          (id) => x.pickParent(id === "base" ? null : id),
        )}
        {snap("parent", x.frame?.origin ?? null, "a snap on the part it hangs from")}
        {x.target === "parent" && x.parent === undefined && (
          <FeatureRow label="">
            <Button label="Base" title="Hang it from Base" shortcut="Enter" onClick={() => x.pickParent(null)} />
          </FeatureRow>
        )}
      </section>
      <section aria-label="How it moves" className="bc-fsection">
        <h3 className="bc-fsection-head">How it moves</h3>
        <FeatureRow label="Kind">
          <select className="bc-select" aria-label="Kind" value={s.kind} onChange={(e) => x.change({ kind: e.target.value as JointKind })}>
            {JOINT_KINDS.map((k) => (
              <option key={k.id} value={k.id} title={k.title}>
                {`${k.label} (${k.urdf})`}
              </option>
            ))}
          </select>
        </FeatureRow>
        {unit && (
          <div className="bc-fgrid">
            {(["lower", "upper"] as const).map((which) => (
              <NumberField
                key={which}
                label={which === "lower" ? "Lower" : "Upper"}
                unit={unit}
                value={s[which]}
                scope={scope}
                step={unit === "°" ? 5 : 1}
                onCommit={(v, expr) => {
                  x.change({ [which]: v });
                  x.setFieldExpr(which, expr);
                }}
              />
            ))}
          </div>
        )}
        {x.session && s.kind !== "fixed" && (
          <FeatureRow label="">
            <Button label="Show how it moves" title="Swing the part through its range and back" onClick={x.play} />
          </FeatureRow>
        )}
      </section>
      <section aria-label="Line-up" className="bc-fsection">
        <h3 className="bc-fsection-head">Line-up</h3>
        <div className="bc-fgrid">
          <NumberField label="Angle" unit="°" value={s.angle ?? 0} scope={scope} step={15} onCommit={(v) => x.change({ angle: v || undefined })} />
          <Button
            label="Turn 90°"
            title="Turn the part a quarter turn about the joint; Shift+Q turns it back"
            shortcut="Q"
            onClick={() => x.change({ angle: (((((s.angle ?? 0) + 270) % 360) + 360) % 360) - 180 || undefined })}
          />
          <NumberField label="Gap" value={s.gap ?? 0} scope={scope} onCommit={(v) => x.change({ gap: v || undefined })} />
          {XYZ.map((a, i) => (
            <NumberField
              key={a}
              label={`${a} offset`}
              value={offset[i]!}
              scope={scope}
              onCommit={(v) => {
                const o: [number, number, number] = [...offset];
                o[i] = v;
                x.change({ offset: o.some((n) => n) ? o : undefined });
              }}
            />
          ))}
          <label className="bc-field bc-fgrid-check" data-tip="Turn the part over, onto the other side of the snap (W)">
            <span className="bc-frow-label">Flip</span>
            <input type="checkbox" checked={!!s.flip} onChange={(e) => x.change({ flip: e.currentTarget.checked || undefined })} />
          </label>
        </div>
      </section>
      {error && <PanelNote tone="error">{error}</PanelNote>}
    </FeaturePanel>
  );
}

/** What the editor needs to know of the Joint tool: what the next click picks, and what to tell you. */
export interface JointUi {
  stage: JointStage;
  help: string | null;
}

/**
 * The Joint tool with its panel, loaded when the tool is first picked so the shell stays small. It tells the editor
 * its stage and help, and gives it the session for Enter; `edit` opens a joint from the timeline.
 */
export function JointTool({
  deps,
  edit,
  onEdited,
  onState,
  api,
  failed,
  scope,
  onCancel,
}: {
  deps: JointDeps;
  edit: string | null;
  onEdited: () => void;
  onState: (s: JointUi | null) => void;
  api: MutableRefObject<JointSession | null>;
  failed: Map<string, string>;
  scope?: Record<string, number>;
  onCancel: () => void;
}) {
  const x = useJoint(deps);
  api.current = x;
  useEffect(() => {
    if (!edit) return;
    x.edit(edit);
    onEdited();
  }, [edit, x, onEdited]);
  useEffect(() => onState({ stage: x.stage, help: x.help }), [x.stage, x.help, onState]);
  useEffect(
    () => () => {
      onState(null);
      api.current = null;
    },
    [onState, api],
  );
  return (
    <>
      <JointPanel x={x} scope={scope} error={x.session ? failed.get(x.session.id) : undefined} onCancel={onCancel} />
      <JointLoupe x={x} />
    </>
  );
}

/** About where the top bar ends, in view pixels: the loupe opens below the pointer above this. */
const TOP_BAR_BOTTOM = 72;

/** The loupe over crowded snap points (#385), drawn in the 3D view, with how to close it above it (#386). */
function JointLoupe({ x }: { x: JointSession }) {
  const l = x.loupe;
  const host = document.getElementById("bc-view");
  if (!l || !host) return null;
  const box = loupeBox(l.anchor, { width: host.clientWidth, height: host.clientHeight, top: TOP_BAR_BOTTOM });
  const hint = loupeHint(l.why);
  return createPortal(
    <div className={cx("bc-loupe", box.below && "bc-below")} style={{ left: box.left, top: box.top }} aria-hidden="true" data-testid="joint-loupe">
      <canvas ref={x.loupeCanvas} />
      <span className="bc-loupe-zoom">{l.zoom}×</span>
      {hint && <span className="bc-loupe-hint">{hint}</span>}
    </div>,
    host,
  );
}
