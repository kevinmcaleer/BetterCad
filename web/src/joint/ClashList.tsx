import { useCallback, useEffect, useRef, useState } from "react";
import { Button, ESC, NumberField, useEscape } from "@bettercad/ui";
import type { Call, Clash, SweepLimit, SweepResult } from "@bettercad/kernel";
import { updateJoint, type JointKind, type ModelDoc, type Pose } from "../state/document";
import type { Store } from "../state/store";

export interface ClashListProps {
  /** Whether the check is on: it runs now and again after each change. */
  on: boolean;
  onToggle: (on: boolean) => void;
  sameLink: boolean;
  references: boolean;
  onOptions: (change: { sameLink?: boolean; references?: boolean }) => void;
  /** Named poses (#177) to check at instead of the pose now, Home first; left out when there are no joints. */
  poses?: { id: string; name: string }[];
  /** The pose checked: null for the pose now. */
  at?: string | null;
  onAt?: (id: string | null) => void;
  /** How far the check has got, 0 to 1, while it runs. */
  progress: number | null;
  /** The last answer, biggest overlap first; null before there is one. */
  clashes: Clash[] | null;
  nameOf: (id: string) => string;
  onShow: (c: Clash) => void;
  onStop: () => void;
  /** The clash sweep (#179); left out when there are no joints to move. */
  sweep?: ClashSweepProps;
}

/** What a sweep is asked to do: "each", "together" or one joint's id; steps in degrees and mm; poses to try together. */
export interface SweepAsk {
  joint: string;
  step: { hinge: number; slider: number };
  samples: number;
}

/** The clash sweep (#179): each joint through its range, or all of them together. Lazy, so it keeps its own state. */
export interface ClashSweepProps {
  /** Joints a sweep can move: not fixed, not driven by another. */
  joints: { id: string; name: string; kind: JointKind }[];
  /** Runs the sweep in the kernel; null when the kernel is off. */
  run: (ask: SweepAsk, progress: (fraction: number) => void) => Call<SweepResult> | null;
  /** The model the answer is for: a new one clears it. */
  model: unknown;
  /** Bumped to start a sweep from the command palette. */
  start: number;
  /** The document's history: Show poses the arm and a suggested limit is set as one undo step each. */
  store: Store<ModelDoc>;
  /** After Show has posed the arm (or, on a read-only model, to show the pose without keeping it). */
  onShow: (at: Pose) => void;
  /** Says how it went, in the status line. */
  say: (text: string) => void;
}

const valueText = (kind: JointKind | undefined, v: number) => `${Math.round(v * 10) / 10}${kind === "prismatic" ? " mm" : "°"}`;

/** "Set the upper limit to 70°", "Set the limits to −10° and 70°". */
export function limitText(l: SweepLimit, kind: JointKind | undefined): string {
  if (l.lower !== undefined && l.upper !== undefined) return `Set the limits to ${valueText(kind, l.lower)} and ${valueText(kind, l.upper)}`;
  if (l.upper !== undefined) return `Set the upper limit to ${valueText(kind, l.upper)}`;
  return `Set the lower limit to ${valueText(kind, l.lower ?? 0)}`;
}

/** The sweep's controls and its answer, under the clash check. */
export function ClashSweep({ joints, run, model, start, store, onShow, say, nameOf }: ClashSweepProps & { nameOf: (id: string) => string }) {
  const [ask, setAsk] = useState<SweepAsk>({ joint: "each", step: { hinge: 5, slider: 1 }, samples: 200 });
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<SweepResult | null>(null);
  const call = useRef<Call<SweepResult> | null>(null);
  const onOptions = (change: Partial<Omit<SweepAsk, "step">> & { step?: Partial<SweepAsk["step"]> }) =>
    setAsk((o) => ({ ...o, ...change, step: { ...o.step, ...change.step } }));
  const stop = useCallback(() => {
    call.current?.cancel();
    call.current = null;
    setProgress(null);
  }, []);
  const onRun = useCallback(() => {
    call.current?.cancel();
    const c = run(ask, (f) => call.current === c && setProgress(f));
    call.current = c;
    if (!c) return;
    setProgress(0);
    setResult(null);
    c.then(
      (r) => {
        if (call.current !== c) return;
        setResult(r);
        const n = r.ranges.length + r.together.length;
        say(n ? `Found ${n === 1 ? "1 clash" : `${n} clashes`} while sweeping` : "Nothing hits while sweeping");
      },
      () => undefined,
    );
    void c.finally(() => {
      if (call.current !== c) return;
      call.current = null;
      setProgress(null);
    });
  }, [run, ask, say]);
  const onStop = () => {
    stop();
    say("Stopped sweeping");
  };
  useEscape(progress !== null, onStop, ESC.tool);
  useEffect(() => stop, [stop]);
  useEffect(() => setResult(null), [model]);
  const started = useRef(start);
  useEffect(() => {
    if (start === started.current) return;
    started.current = start;
    onRun();
  }, [start, onRun]);
  const { joint, step, samples } = ask;
  const show = (pose: Pose) => {
    if (!store.isLocked()) {
      store.edit((d) => ({ ...d, pose: Object.keys(pose).length ? pose : undefined }), "Show the clash");
      store.seal();
    }
    onShow(pose);
  };
  const onLimit = (l: SweepLimit) => {
    const name = joints.find((j) => j.id === l.joint)?.name ?? "the joint";
    store.edit(
      (d) => updateJoint(d, l.joint, { ...(l.lower !== undefined && { lower: l.lower }), ...(l.upper !== undefined && { upper: l.upper }) }),
      `Set the limits of ${name}`,
    );
    store.seal();
    say(`Set the limits of ${name}`);
  };
  const one = joints.find((j) => j.id === joint);
  const moving = joint === "together" || !one ? joints : [one];
  const hinges = moving.some((j) => j.kind !== "prismatic");
  const sliders = moving.some((j) => j.kind === "prismatic");
  const jointOf = (id: string) => joints.find((j) => j.id === id);
  return (
    <div className="bc-clash-sweep">
      <h3 className="bc-clash-head">Sweep the joints</h3>
      <label className="bc-clash-at">
        <span className="bc-field-label">Move</span>
        <select className="bc-select" value={one || joint === "together" ? joint : "each"} onChange={(e) => onOptions({ joint: e.target.value })}>
          <option value="each">Each joint in turn</option>
          {joints.length > 1 && <option value="together">All joints together</option>}
          {joints.map((j) => (
            <option key={j.id} value={j.id}>
              {j.name}
            </option>
          ))}
        </select>
      </label>
      {joint === "together" ? (
        <NumberField label="Poses" value={samples} min={10} max={5000} step={50} precision={0} onCommit={(v) => onOptions({ samples: Math.round(v) })} />
      ) : (
        <>
          {hinges && <NumberField label="Step" value={step.hinge} unit="°" min={0.5} max={90} step={1} onCommit={(v) => onOptions({ step: { hinge: v } })} />}
          {sliders && (
            <NumberField
              label={hinges ? "Slider step" : "Step"}
              value={step.slider}
              unit="mm"
              min={0.1}
              max={100}
              step={0.5}
              onCommit={(v) => onOptions({ step: { slider: v } })}
            />
          )}
        </>
      )}
      {progress !== null ? (
        <p className="bc-note" role="status">
          {`Sweeping, ${Math.round(progress * 100)}%`} <Button size="dense" label="Stop" title="Stop sweeping (Esc)" onClick={onStop} />
        </p>
      ) : (
        <Button
          icon="joint"
          label="Sweep"
          title={
            joint === "together" ? `Try ${samples} poses of every joint at once` : "Move each joint from end to end, the others held, and find where bodies hit"
          }
          onClick={onRun}
        />
      )}
      {progress === null && result && (
        <>
          {!result.ranges.length && !result.together.length && (
            <p className="bc-note" role="status">
              {result.samples && joint === "together" ? `Nothing hits in ${result.samples} poses.` : "Nothing hits from end to end."}
            </p>
          )}
          {result.ranges.length > 0 && (
            <ul className="bc-clash-list" aria-label="Hits">
              {result.ranges.map((r) => {
                const j = jointOf(r.joint);
                return (
                  <li key={`${r.joint}-${r.a}-${r.b}-${r.from}`} className="bc-clash">
                    <span>{`${nameOf(r.b)} hits ${nameOf(r.a)} from ${valueText(j?.kind, r.from)} to ${valueText(j?.kind, r.to)} on ${j?.name ?? "a joint"}`}</span>
                    <Button size="dense" label="Show" title="Pose the arm at the first clash" onClick={() => show(r.at)} />
                  </li>
                );
              })}
            </ul>
          )}
          {result.together.length > 0 && (
            <ul className="bc-clash-list" aria-label="Hits">
              {result.together.map((r) => (
                <li key={`${r.a}-${r.b}`} className="bc-clash">
                  <span>{`${nameOf(r.b)} hits ${nameOf(r.a)} in ${r.count} of ${result.samples} poses`}</span>
                  <Button size="dense" label="Show" title="Pose the arm at the clash nearest the pose now" onClick={() => show(r.at)} />
                </li>
              ))}
            </ul>
          )}
          {result.limits.map((l) => (
            <Button
              key={l.joint}
              label={limitText(l, jointOf(l.joint)?.kind)}
              title={`Keep ${jointOf(l.joint)?.name ?? "the joint"} clear of the clash`}
              onClick={() => onLimit(l)}
            />
          ))}
        </>
      )}
    </div>
  );
}

/** An overlap's volume: cm³ from 0.1 cm³, mm³ below that. */
export function volumeText(mm3: number): string {
  if (mm3 >= 100) return `${(Math.round(mm3 / 100) / 10).toLocaleString("en-GB", { maximumFractionDigits: 1 })} cm³`;
  return `${(Math.round(mm3 * 10) / 10).toLocaleString("en-GB", { maximumFractionDigits: 1 })} mm³`;
}

/**
 * The clash check (#178): which bodies overlap at this pose, and by how much, and which only touch (printed parts that
 * touch fuse or bind). Show frames each one.
 */
export function ClashList({
  on,
  onToggle,
  sameLink,
  references,
  onOptions,
  poses,
  at = null,
  onAt,
  progress,
  clashes,
  nameOf,
  onShow,
  onStop,
  sweep,
}: ClashListProps) {
  const overlaps = clashes?.filter((c) => c.kind === "overlap") ?? [];
  const touches = clashes?.filter((c) => c.kind === "touch") ?? [];
  const row = (c: Clash, text: string) => (
    <li key={`${c.a}-${c.b}`} className="bc-clash">
      <span>{text}</span>
      <Button size="dense" label="Show" title="Frame it in the view" onClick={() => onShow(c)} />
    </li>
  );
  return (
    <div className="bc-clashes">
      <Button icon="warning" label="Check clashes" title="Find bodies that overlap or touch at this pose" on={on} onClick={() => onToggle(!on)} />
      {on && (
        <>
          {poses && onAt && (
            <label className="bc-clash-at">
              <span className="bc-field-label">At</span>
              <select className="bc-select" value={at ?? ""} onChange={(e) => onAt(e.target.value || null)}>
                <option value="">The pose now</option>
                {poses.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="bc-check">
            <input type="checkbox" checked={sameLink} onChange={(e) => onOptions({ sameLink: e.target.checked })} />
            <span>Bodies in the same link</span>
          </label>
          <label className="bc-check">
            <input type="checkbox" checked={references} onChange={(e) => onOptions({ references: e.target.checked })} />
            <span>Reference bodies</span>
          </label>
          {progress !== null ? (
            <p className="bc-note" role="status">
              {`Checking, ${Math.round(progress * 100)}%`} <Button size="dense" label="Stop" title="Stop checking (Esc)" onClick={onStop} />
            </p>
          ) : clashes && !clashes.length ? (
            <p className="bc-note" role="status">
              {at ? `No clashes at ${poses?.find((p) => p.id === at)?.name ?? "that pose"}.` : "No clashes at this pose."}
            </p>
          ) : null}
          {overlaps.length > 0 && (
            <ul className="bc-clash-list" aria-label="Overlaps">
              {overlaps.map((c) => row(c, `${nameOf(c.a)} and ${nameOf(c.b)} overlap by ${volumeText(c.volume)}`))}
            </ul>
          )}
          {touches.length > 0 && (
            <>
              <h3 className="bc-clash-head">Touching</h3>
              <ul className="bc-clash-list" aria-label="Touching">
                {touches.map((c) => row(c, `${nameOf(c.a)} and ${nameOf(c.b)} touch`))}
              </ul>
            </>
          )}
        </>
      )}
      {sweep && <ClashSweep {...sweep} nameOf={nameOf} />}
    </div>
  );
}
