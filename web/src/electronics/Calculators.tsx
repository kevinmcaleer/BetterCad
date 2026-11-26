import { useId, useState } from "react";
import type { ElectronicsDesign } from "@bettercad/electronics";
import {
  BAND_PAINT,
  DIGITS,
  TOLERANCE,
  bandsFor,
  ledResistor,
  ohmsFromBands,
  ohmsText,
  trackWidth,
  viaCurrent,
  type BandColour,
} from "@bettercad/electronics/calc";
import { addNetClass, changeNetClass } from "@bettercad/electronics/pcb/netclass";
import { Button, ESC, FeaturePanel, NumberField, PanelNote, useEscape } from "@bettercad/ui";
import type { EEdit } from "./actions";

type Which = "track" | "via" | "led" | "bands";
const WHICH: [Which, string][] = [
  ["track", "Track width for a current"],
  ["via", "Current a via carries"],
  ["led", "Resistor for an LED"],
  ["bands", "Resistor colour bands"],
];
const NEW = "\u0000new";
const fix = (n: number, places = 2) => String(Number(n.toFixed(places)));
const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);

/** Calculators (#739): track width, via current, an LED's resistor and colour bands. Pure sums; nothing is changed until asked. */
export default function Calculators({ design, edit, readOnly, onClose }: { design: ElectronicsDesign; edit: EEdit; readOnly?: boolean; onClose: () => void }) {
  const ids = useId();
  const [which, setWhich] = useState<Which>("track");
  useEscape(true, onClose, ESC.panel);
  return (
    <FeaturePanel
      title="Calculators"
      icon="calculator"
      className="bc-ec-card bc-ec-calc"
      cancel={{ label: "Close", title: "Close the calculators (Esc)", onClick: onClose }}
    >
      <label className="bc-field-label" htmlFor={`${ids}w`}>
        Work out
      </label>
      <select id={`${ids}w`} className="bc-select" value={which} onChange={(e) => setWhich(e.target.value as Which)}>
        {WHICH.map(([id, label]) => (
          <option key={id} value={id}>
            {label}
          </option>
        ))}
      </select>
      {which === "track" && <Track design={design} edit={edit} readOnly={readOnly} />}
      {which === "via" && <Via design={design} />}
      {which === "led" && <Led />}
      {which === "bands" && <Bands />}
    </FeaturePanel>
  );
}

function Track({ design, edit, readOnly }: { design: ElectronicsDesign; edit: EEdit; readOnly?: boolean }) {
  const ids = useId();
  const [current, setCurrent] = useState(1);
  const [rise, setRise] = useState(10);
  const [oz, setOz] = useState(1);
  const [outer, setOuter] = useState(true);
  const board = design.board;
  const [cls, setCls] = useState<string>(board?.classes[0]?.id ?? NEW);
  const width = trackWidth({ current, rise, oz, outer });
  // Tracks are drawn to a hundredth of a millimetre; round up so the track is never narrower than it needs.
  const use = Math.ceil(width * 100 - 1e-9) / 100;
  const set = () =>
    edit((d) => {
      if (cls !== NEW) return changeNetClass(d, cls, { trackWidth: use });
      const made = addNetClass(d);
      return changeNetClass(made.design, made.id, { trackWidth: use });
    }, "Set a net class's width from the calculator");
  return (
    <>
      <div className="bc-ec-set-row">
        <NumberField label="Current (A)" unit="none" value={current} min={0.01} max={35} step={0.1} precision={2} onCommit={setCurrent} />
        <NumberField label="Temperature rise (°C)" unit="none" value={rise} min={1} max={100} step={1} precision={0} onCommit={setRise} />
      </div>
      <div className="bc-ec-set-row">
        <span>
          <label className="bc-field-label" htmlFor={`${ids}oz`}>
            Copper
          </label>
          <select id={`${ids}oz`} className="bc-select" value={oz} onChange={(e) => setOz(Number(e.target.value))}>
            <option value={0.5}>0.5 oz (18 µm)</option>
            <option value={1}>1 oz (35 µm)</option>
            <option value={2}>2 oz (70 µm)</option>
          </select>
        </span>
        <span>
          <label className="bc-field-label" htmlFor={`${ids}l`}>
            Layer
          </label>
          <select id={`${ids}l`} className="bc-select" value={outer ? "outer" : "inner"} onChange={(e) => setOuter(e.target.value === "outer")}>
            <option value="outer">Top or bottom</option>
            <option value="inner">Inside the board</option>
          </select>
        </span>
      </div>
      <dl className="bc-facts" aria-label="Answer">
        <dt>Width</dt>
        <dd>{width ? `${fix(width, 3)} mm (${fix(width / 0.0254, 1)} mil)` : "–"}</dd>
      </dl>
      <PanelNote>From IPC-2221. Wider tracks run cooler; give power tracks room to spare.</PanelNote>
      {board && width > 0 && (
        <div className="bc-ec-set-row">
          <span>
            <label className="bc-field-label" htmlFor={`${ids}c`}>
              Net class
            </label>
            <select id={`${ids}c`} className="bc-select" value={cls} disabled={readOnly} onChange={(e) => setCls(e.target.value)}>
              {board.classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
              <option value={NEW}>New class…</option>
            </select>
          </span>
          <Button
            size="dense"
            variant="secondary"
            label={`Use ${fix(use)} mm`}
            title="Make this the class's track width; its tracks at the old width follow"
            disabled={readOnly}
            onClick={set}
          />
        </div>
      )}
    </>
  );
}

function Via({ design }: { design: ElectronicsDesign }) {
  const [drill, setDrill] = useState(design.board?.rules.viaDrill ?? 0.3);
  const [plating, setPlating] = useState(25);
  const [rise, setRise] = useState(10);
  const amps = viaCurrent({ drill, plating: plating / 1000, rise });
  return (
    <>
      <div className="bc-ec-set-row">
        <NumberField label="Hole (mm)" unit="none" value={drill} min={0.1} max={6} step={0.05} precision={2} onCommit={setDrill} />
        <NumberField label="Plating (µm)" unit="none" value={plating} min={5} max={100} step={5} precision={0} onCommit={setPlating} />
        <NumberField label="Temperature rise (°C)" unit="none" value={rise} min={1} max={100} step={1} precision={0} onCommit={setRise} />
      </div>
      <dl className="bc-facts" aria-label="Answer">
        <dt>Current</dt>
        <dd>{amps ? `${fix(amps)} A` : "–"}</dd>
      </dl>
      <PanelNote>From IPC-2221, with the plating round the hole as the copper. Use two vias where one is close.</PanelNote>
    </>
  );
}

function Led() {
  const [supply, setSupply] = useState(5);
  const [forward, setForward] = useState(2);
  const [ma, setMa] = useState(10);
  const r = ledResistor({ supply, forward, current: ma / 1000 });
  return (
    <>
      <div className="bc-ec-set-row">
        <NumberField label="Supply (V)" unit="none" value={supply} min={0.5} max={60} step={0.1} precision={2} onCommit={setSupply} />
        <NumberField label="LED forward (V)" unit="none" value={forward} min={0.5} max={10} step={0.1} precision={2} onCommit={setForward} />
        <NumberField label="Current (mA)" unit="none" value={ma} min={0.1} max={1000} step={1} precision={1} onCommit={setMa} />
      </div>
      {r ? (
        <dl className="bc-facts" aria-label="Answer">
          <dt>Resistor</dt>
          <dd>{ohmsText(r.fit)}</dd>
          <dt>Exactly</dt>
          <dd>{ohmsText(r.exact)}</dd>
          <dt>Current then</dt>
          <dd>{fix(r.current * 1000, 1)} mA</dd>
          <dt>It burns</dt>
          <dd>{r.power < 0.1 ? `${fix(r.power * 1000, 1)} mW` : `${fix(r.power, 2)} W`}</dd>
        </dl>
      ) : (
        <PanelNote>The supply has to be more than the LED's forward voltage.</PanelNote>
      )}
      <PanelNote>Red LEDs drop about 2 V, blue and white about 3 V. The resistor is rounded up to the next E24 value.</PanelNote>
    </>
  );
}

const TOLS = Object.keys(TOLERANCE) as BandColour[];

function Bands() {
  const ids = useId();
  const [bands, setBands] = useState<BandColour[]>(["yellow", "violet", "red", "gold"]);
  const [ohms, setOhms] = useState(4700);
  const read = ohmsFromBands(bands);
  const count = bands.length;
  const choices = (i: number): BandColour[] => (i < count - 2 ? [...DIGITS] : i === count - 2 ? [...DIGITS, "gold", "silver"] : TOLS);
  const setBand = (i: number, c: BandColour) => setBands(bands.map((b, k) => (k === i ? c : b)));
  const written = bandsFor(ohms, read?.tolerance ?? 5);
  return (
    <>
      <div className="bc-ec-set-row">
        <span>
          <label className="bc-field-label" htmlFor={`${ids}n`}>
            Bands
          </label>
          <select
            id={`${ids}n`}
            className="bc-select"
            value={count}
            onChange={(e) => setBands(Number(e.target.value) === 5 ? ["brown", "black", "black", "brown", "brown"] : ["yellow", "violet", "red", "gold"])}
          >
            <option value={4}>Four</option>
            <option value={5}>Five</option>
          </select>
        </span>
      </div>
      <div className="bc-ec-bands" role="group" aria-label="Colour bands">
        {bands.map((b, i) => (
          <span key={i}>
            <span className="bc-ec-band" style={{ background: BAND_PAINT[b] }} aria-hidden />
            <select aria-label={`Band ${i + 1}`} className="bc-select" value={b} onChange={(e) => setBand(i, e.target.value as BandColour)}>
              {choices(i).map((c) => (
                <option key={c} value={c}>
                  {cap(c)}
                </option>
              ))}
            </select>
          </span>
        ))}
      </div>
      <dl className="bc-facts" aria-label="Answer">
        <dt>Value</dt>
        <dd>{read ? `${ohmsText(read.ohms)} ±${read.tolerance}%` : "–"}</dd>
      </dl>
      <NumberField label="Or type a value (Ω)" unit="none" value={ohms} min={0.1} max={1e9} step={1} precision={2} onCommit={setOhms} />
      {written ? (
        <PanelNote>
          {ohmsText(ohms)} is {written.map(cap).join(", ")}.{" "}
          <Button size="dense" variant="secondary" label="Show these bands" onClick={() => setBands(written)} />
        </PanelNote>
      ) : (
        <PanelNote>Bands can show only two or three figures.</PanelNote>
      )}
    </>
  );
}
