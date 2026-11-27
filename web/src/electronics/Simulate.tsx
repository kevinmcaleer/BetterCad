import { useId, useMemo, useState } from "react";
import { byRef, eid, netlist, type ElectronicsDesign, type SimDrive, type SimSettings } from "@bettercad/electronics";
import { SIM_STOP, isGround, railVolts, railsOf, spiceDeck, tracesOf, type SimResult } from "@bettercad/electronics/sim";
import { Button, ESC, FeaturePanel, NumberField, PanelNote, useEscape } from "@bettercad/ui";
import type { EEdit } from "./actions";
import type { SpiceAnswer } from "./simRun";
import { useEui } from "./useEui";

/** Up to six probes, each drawn in its own colour (`.bc-ec-sim-trace-N`). */
export const MAX_PROBES = 6;
const WAVES: [SimDrive["wave"], string][] = [
  ["pulse", "Square wave"],
  ["sine", "Sine wave"],
  ["dc", "Steady"],
];

const volts = (v: number) => `${Math.abs(v) < 1e-6 ? 0 : Number(v.toPrecision(3))} V`;
const ms = (s: number) => `${Number((s * 1000).toPrecision(3))} ms`;

/** Runs a netlist on the simulator. The app's runs ngspice in a worker; a test hands in its own. */
export type RunSpice = (text: string) => Promise<SpiceAnswer>;
const engine: RunSpice = (text) => import("./simClient").then((m) => m.runSpice(text));

/**
 * Simulate (#761): runs the schematic on ngspice and draws each probed net's voltage over time. Rails take their
 * voltage from their name, or one you give; a net can be driven with a square or sine wave. Settings are saved with
 * the design, as one undo step each.
 */
export default function Simulate({
  design,
  edit,
  readOnly,
  onClose,
  run = engine,
}: {
  design: ElectronicsDesign;
  edit: EEdit;
  readOnly?: boolean;
  onClose: () => void;
  run?: RunSpice;
}) {
  const ids = useId();
  const ui = useEui();
  useEscape(true, onClose, ESC.panel);
  const settings: SimSettings = useMemo(() => design.sim ?? {}, [design.sim]);
  const probes = settings.probes ?? [];
  const nets = useMemo(
    () =>
      netlist(design)
        .nets.map((n) => n.name)
        .filter((n) => !isGround(n))
        .sort(byRef),
    [design],
  );
  const rails = useMemo(() => railsOf(design), [design]);
  const deck = useMemo(() => spiceDeck(design, settings), [design, settings]);
  const [state, setState] = useState<{ busy: boolean; result?: SimResult; errors?: string[] }>({ busy: false });

  const change = (next: SimSettings, label: string) =>
    edit((d) => {
      const sim = { ...d.sim, ...next };
      for (const k of Object.keys(sim) as (keyof SimSettings)[]) if (sim[k] === undefined) delete sim[k];
      return { ...d, sim };
    }, label);
  const addProbe = (net: string) => {
    if (!net || probes.includes(net) || probes.length >= MAX_PROBES) return;
    change({ probes: [...probes, net] }, `Probe ${net}`);
  };
  const drives = settings.drives ?? [];
  const setDrive = (id: string, patch: Partial<SimDrive>) =>
    change({ drives: drives.map((x) => (x.id === id ? { ...x, ...patch } : x)) }, "Change a driven net");

  const go = async () => {
    setState({ busy: true });
    const answer = await run(deck.text);
    const result = tracesOf(deck, answer.vectors, probes);
    setState({ busy: false, result, errors: answer.errors });
  };
  const blocked = deck.unknownRails.length > 0 ? `Give ${deck.unknownRails.join(", ")} a voltage first` : probes.length === 0 ? "Probe a net first" : null;
  const selected = ui.net && !isGround(ui.net) && !probes.includes(ui.net) ? ui.net : null;
  const free = nets.filter((n) => !probes.includes(n));

  return (
    <FeaturePanel
      title="Simulate"
      icon="waveform"
      className="bc-ec-card bc-ec-sim"
      cancel={{ label: "Close", title: "Close the simulation (Esc)", onClick: onClose }}
    >
      <NumberField
        label="Run for (ms)"
        unit="none"
        value={(settings.stop ?? SIM_STOP) * 1000}
        min={0.001}
        max={10_000}
        step={1}
        precision={3}
        onCommit={(v) => !readOnly && change({ stop: v / 1000 }, "Set how long the simulation runs")}
      />

      <h3 className="bc-ec-sim-head">Probes</h3>
      {probes.length === 0 && <PanelNote>A probe draws a net's voltage over the run. Pick a net, or select one on the schematic.</PanelNote>}
      <ul className="bc-ec-sim-list" aria-label="Probes">
        {probes.map((net, i) => (
          <li key={net}>
            <span className={`bc-ec-sim-swatch bc-ec-sim-trace-${i}`} aria-hidden="true" />
            <span className="bc-ec-sim-name">{net}</span>
            <Button
              size="dense"
              variant="quiet"
              label="Remove"
              title={`Stop probing ${net}`}
              disabled={readOnly}
              onClick={() => change({ probes: probes.filter((p) => p !== net) }, `Stop probing ${net}`)}
            />
          </li>
        ))}
      </ul>
      {probes.length < MAX_PROBES && (
        <div className="bc-ec-set-row">
          <span>
            <label className="bc-field-label" htmlFor={`${ids}p`}>
              Add a probe
            </label>
            <select id={`${ids}p`} className="bc-select" value="" disabled={readOnly || !free.length} onChange={(e) => addProbe(e.target.value)}>
              <option value="">{free.length ? "Pick a net" : "No nets to probe"}</option>
              {free.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </span>
          {selected && (
            <Button
              size="dense"
              variant="secondary"
              label={`Probe ${selected}`}
              title="Probe the net selected on the schematic"
              disabled={readOnly}
              onClick={() => addProbe(selected)}
            />
          )}
        </div>
      )}

      {rails.length > 0 && (
        <>
          <h3 className="bc-ec-sim-head">Rails</h3>
          <div className="bc-ec-set-row bc-ec-sim-rails">
            {rails.map((r) => (
              <NumberField
                key={r}
                label={`${r} (V)`}
                unit="none"
                value={settings.rails?.[r] ?? railVolts(r)}
                min={-100}
                max={100}
                step={0.1}
                precision={3}
                onCommit={(v) => !readOnly && change({ rails: { ...settings.rails, [r]: v } }, `Set ${r} to ${volts(v)}`)}
              />
            ))}
          </div>
        </>
      )}

      <h3 className="bc-ec-sim-head">Driven nets</h3>
      {drives.length === 0 && (
        <PanelNote>Put a square or sine wave on a net, such as a switch's or a sensor's, to see what the circuit does with it.</PanelNote>
      )}
      {drives.map((x) => (
        <fieldset key={x.id} className="bc-ec-sim-drive">
          <legend>{x.net}</legend>
          <div className="bc-ec-set-row">
            <span>
              <label className="bc-field-label" htmlFor={`${ids}${x.id}n`}>
                Net
              </label>
              <select id={`${ids}${x.id}n`} className="bc-select" value={x.net} disabled={readOnly} onChange={(e) => setDrive(x.id, { net: e.target.value })}>
                {nets.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </span>
            <span>
              <label className="bc-field-label" htmlFor={`${ids}${x.id}w`}>
                Signal
              </label>
              <select
                id={`${ids}${x.id}w`}
                className="bc-select"
                value={x.wave}
                disabled={readOnly}
                onChange={(e) => setDrive(x.id, { wave: e.target.value as SimDrive["wave"] })}
              >
                {WAVES.map(([w, label]) => (
                  <option key={w} value={w}>
                    {label}
                  </option>
                ))}
              </select>
            </span>
          </div>
          <div className="bc-ec-set-row">
            {x.wave !== "dc" && (
              <NumberField
                label="Low (V)"
                unit="none"
                value={x.low}
                min={-100}
                max={100}
                step={0.1}
                precision={3}
                onCommit={(v) => !readOnly && setDrive(x.id, { low: v })}
              />
            )}
            <NumberField
              label={x.wave === "dc" ? "Voltage (V)" : "High (V)"}
              unit="none"
              value={x.high}
              min={-100}
              max={100}
              step={0.1}
              precision={3}
              onCommit={(v) => !readOnly && setDrive(x.id, { high: v })}
            />
            {x.wave !== "dc" && (
              <NumberField
                label="Frequency (Hz)"
                unit="none"
                value={x.freq ?? 1000}
                min={0.001}
                max={1e9}
                step={10}
                precision={3}
                onCommit={(v) => !readOnly && setDrive(x.id, { freq: v })}
              />
            )}
          </div>
          <Button
            size="dense"
            variant="quiet"
            label="Remove"
            title={`Stop driving ${x.net}`}
            disabled={readOnly}
            onClick={() => change({ drives: drives.filter((y) => y.id !== x.id) }, `Stop driving ${x.net}`)}
          />
        </fieldset>
      ))}
      <Button
        size="dense"
        variant="secondary"
        label="Drive a net"
        title="Put a signal on a net for the run"
        disabled={readOnly || !nets.length}
        onClick={() =>
          change(
            { drives: [...drives, { id: eid("dr"), net: selected ?? nets[0]!, wave: "pulse", low: 0, high: railVolts(rails[0] ?? "") ?? 5, freq: 1000 }] },
            "Drive a net",
          )
        }
      />

      {deck.skipped.length > 0 && (
        <details className="bc-ec-sim-skipped">
          <summary>
            Left out of the run: {deck.skipped.length} {deck.skipped.length === 1 ? "part" : "parts"}
          </summary>
          <ul>
            {deck.skipped.map((s) => (
              <li key={s.ref}>
                {s.ref}: {s.why}
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="bc-ec-set-row">
        <Button
          variant="primary"
          label={state.busy ? "Running…" : "Run"}
          title={blocked ?? "Run the circuit and draw the probed nets"}
          disabled={!!blocked || state.busy}
          onClick={() => void go()}
        />
        {state.busy && <Button variant="secondary" label="Stop" title="Stop the run" onClick={() => void import("./simClient").then((m) => m.stopSim())} />}
      </div>
      {blocked && <PanelNote>{blocked}.</PanelNote>}
      {state.busy && <PanelNote live>Running. The first run loads the simulator, about 5 MB.</PanelNote>}
      {!!state.errors?.length && <PanelNote tone="error">{state.errors.join(" ")}</PanelNote>}
      {state.result && !state.errors?.length && <Plot result={state.result} />}
    </FeaturePanel>
  );
}

const W = 320;
const H = 160;
const PAD = { left: 40, right: 8, top: 8, bottom: 24 };

/** The probed nets' voltages over the run, one line each, with the time and voltage scales. */
export function Plot({ result }: { result: SimResult }) {
  const { time, traces } = result;
  const t1 = time.at(-1) ?? 0;
  const all = traces.flatMap((t) => t.volts);
  let lo = Math.min(0, ...all);
  let hi = Math.max(0, ...all);
  if (hi - lo < 1e-9) hi = lo + 1;
  const pad = (hi - lo) * 0.05;
  lo -= pad;
  hi += pad;
  const x = (t: number) => PAD.left + (t1 > 0 ? (t / t1) * (W - PAD.left - PAD.right) : 0);
  const y = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo)) * (H - PAD.top - PAD.bottom);
  const ticks = [lo + pad, (lo + hi) / 2, hi - pad];
  const summary = traces
    .map((t) => (t.volts.length ? `${t.net} from ${volts(Math.min(...t.volts))} to ${volts(Math.max(...t.volts))}` : `${t.net}: no voltage`))
    .join("; ");
  return (
    <figure className="bc-ec-sim-plot">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Voltages over ${ms(t1)}: ${summary}`}>
        <rect className="bc-ec-sim-frame" x={PAD.left} y={PAD.top} width={W - PAD.left - PAD.right} height={H - PAD.top - PAD.bottom} />
        {ticks.map((v) => (
          <g key={v}>
            <line className="bc-ec-sim-grid" x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} />
            <text className="bc-ec-sim-tick" x={PAD.left - 4} y={y(v) + 3} textAnchor="end">
              {volts(v)}
            </text>
          </g>
        ))}
        <text className="bc-ec-sim-tick" x={PAD.left} y={H - 8}>
          0
        </text>
        <text className="bc-ec-sim-tick" x={W - PAD.right} y={H - 8} textAnchor="end">
          {ms(t1)}
        </text>
        {traces.map((t, i) =>
          t.volts.length ? (
            <polyline
              key={t.net}
              className={`bc-ec-sim-line bc-ec-sim-trace-${i}`}
              points={t.volts.map((v, k) => `${x(time[k]!).toFixed(1)},${y(v).toFixed(1)}`).join(" ")}
            />
          ) : null,
        )}
      </svg>
      <figcaption>
        <ul className="bc-ec-sim-list" aria-label="Probed nets">
          {traces.map((t, i) => (
            <li key={t.net}>
              <span className={`bc-ec-sim-swatch bc-ec-sim-trace-${i}`} aria-hidden="true" />
              <span className="bc-ec-sim-name">{t.net}</span>
              <span className="bc-ec-sim-range">{t.volts.length ? `${volts(Math.min(...t.volts))} to ${volts(Math.max(...t.volts))}` : "no voltage"}</span>
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}
