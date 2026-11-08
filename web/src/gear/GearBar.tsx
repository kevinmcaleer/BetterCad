import { useState } from "react";
import { Button, FeatureCheck, FeaturePanel, FeatureRow, MenuButton, NumberField, PanelNote, type MenuEntry } from "@bettercad/ui";
import {
  GT2_BELTS,
  beltedTo,
  centreForBelt,
  gearCircles,
  gt2Pitch,
  meshedWith,
  ratioText,
  undercutWarning,
  type GearBore,
  type GearFeature,
  type GearParams,
} from "../state/document";
import type { GearSession } from "./useGear";

const BORES: { id: GearBore["kind"]; label: string; title: string; diameter: number }[] = [
  { id: "none", label: "None", title: "No hole in the middle", diameter: 0 },
  { id: "round", label: "Round", title: "A round hole for a shaft or bearing pin", diameter: 5 },
  { id: "dflat", label: "D-flat", title: "A round hole with a flat, for a motor's D shaft", diameter: 3 },
  { id: "horn", label: "Servo horn", title: "A hub hole and four arm holes, to bolt to a servo horn", diameter: 7 },
];

type Form = NonNullable<GearFeature["form"]>;
const FORMS: { id: Form; label: string; title: string }[] = [
  { id: "spur", label: "Spur gear", title: "An involute spur gear" },
  { id: "rack", label: "Rack", title: "A straight rack to run against a spur gear" },
  { id: "gt2", label: "GT2 pulley", title: "A timing pulley for 2 mm pitch GT2 belt" },
];
/** What each form starts with when you switch to it. */
const FORM_START: Record<Form, Partial<GearFeature>> = {
  spur: { width: 5, bore: { kind: "round", diameter: 5 } },
  rack: { width: 5, rack: { length: 60, height: 5 }, bore: { kind: "none", diameter: 0 }, hub: undefined },
  gt2: { width: 7, flanges: true, bore: { kind: "round", diameter: 5 } },
};

const round = (v: number) => Math.round(v * 100) / 100;

/**
 * The panel for the Gear tool: a spur gear (#191), a rack or a GT2 pulley (#193). Teeth, size and bore up front, the
 * finer settings under More, and the partner it meshes with or the belt it's on (#192, #193).
 */
export function GearBar({ x, error, onCancel }: { x: GearSession; error?: string; onCancel: () => void }) {
  const [more, setMore] = useState(false);
  const f = x.feature;
  if (!f) {
    return (
      <FeaturePanel title="Gear" icon="gear" cancel={{ title: "Put the tool down", onClick: onCancel }}>
        <PanelNote>{x.help}</PanelNote>
      </FeaturePanel>
    );
  }
  const form: Form = f.form ?? "spur";
  const g = f.gear;
  const set = (c: Partial<GearParams>) => x.change({ gear: { ...g, ...c } });
  const b = f.bore;
  const mate = f.mesh ? x.partner : null;
  const belt = f.belt && x.partner?.form === "gt2" ? { on: f.belt, from: x.partner } : null;
  const title = FORMS.find((o) => o.id === form)!.label;
  const what = form === "rack" ? "rack" : form === "gt2" ? "pulley" : "gear";

  const pitchNote =
    form === "gt2"
      ? `Pitch diameter ${round(gt2Pitch(g.teeth))} mm`
      : form === "spur"
        ? `Pitch diameter ${round(2 * gearCircles(g).pitch)} mm`
        : `Tooth pitch ${round(Math.PI * g.module)} mm`;

  const belts: MenuEntry[] = belt
    ? GT2_BELTS.filter((l) => centreForBelt(l, belt.from.gear.teeth, g.teeth) !== null).map((l) => ({
        id: String(l),
        label: `${l} mm, ${l / 2} teeth`,
        checked: belt.on.length === l,
        onSelect: () => x.change({ belt: { ...belt.on, length: l } }),
      }))
    : [];

  return (
    <FeaturePanel
      title={title}
      icon="gear"
      onFieldEnter={() => x.done()}
      cancel={{ title: `Take the ${what} back`, onClick: x.cancel }}
      ok={{ title: `Keep the ${what}`, onClick: x.done }}
    >
      {!mate && !belt && (
        <FeatureRow label="Form">
          <span role="group" aria-label="Form" className="bc-segmented">
            {FORMS.map((o) => (
              <Button
                key={o.id}
                label={o.label}
                title={o.title}
                on={form === o.id}
                onClick={() => form !== o.id && x.change({ form: o.id, ...FORM_START[o.id] })}
              />
            ))}
          </span>
        </FeatureRow>
      )}
      {form !== "rack" && (
        <NumberField
          label="Teeth"
          value={g.teeth}
          min={form === "gt2" ? 10 : 6}
          max={400}
          step={1}
          precision={0}
          onCommit={(v) => set({ teeth: Math.round(v) })}
        />
      )}
      {mate || belt ? (
        <NumberField
          label="Angle"
          unit="°"
          value={(f.mesh ?? f.belt)!.angle}
          onCommit={(v) => x.change(f.mesh ? { mesh: { ...f.mesh, angle: v } } : { belt: { ...f.belt!, angle: v } })}
        />
      ) : (
        form !== "gt2" && <NumberField label="Module" unit="mm" value={g.module} min={0.1} step={0.1} onCommit={(v) => set({ module: v })} />
      )}
      {form === "rack" && f.rack && (
        <>
          <NumberField label="Length" unit="mm" value={f.rack.length} min={1} onCommit={(v) => x.change({ rack: { ...f.rack!, length: v } })} />
          <NumberField label="Height" unit="mm" value={f.rack.height} min={0.1} onCommit={(v) => x.change({ rack: { ...f.rack!, height: v } })} />
        </>
      )}
      {form !== "gt2" && <NumberField label="Width" unit="mm" value={f.width} min={0.1} onCommit={(v) => x.change({ width: v })} />}
      {form === "gt2" && (
        <>
          <FeatureRow label="Belt width">
            <span role="group" aria-label="Belt width" className="bc-segmented">
              {[6, 9].map((w) => (
                <Button
                  key={w}
                  label={`${w} mm belt`}
                  title={`Teeth ${w + 1} mm wide, for ${w} mm belt`}
                  on={f.width === w + 1}
                  onClick={() => x.change({ width: w + 1 })}
                />
              ))}
            </span>
          </FeatureRow>
          <FeatureCheck label="Flanges" title="Discs either side to keep the belt on" on={!!f.flanges} onChange={(flanges) => x.change({ flanges })} />
        </>
      )}
      <PanelNote>{pitchNote}</PanelNote>
      {mate && (
        <>
          <PanelNote>
            {form === "rack"
              ? `Runs against ${mate.name}, module ${mate.gear.module}. ${round(Math.PI * mate.gear.module * mate.gear.teeth)} mm a turn.`
              : `Meshes with ${mate.name}, module ${mate.gear.module}. ${ratioText(mate.gear.teeth, g.teeth)}.`}
          </PanelNote>
          <FeatureRow label="Meshed">
            <Button
              label="Unmesh"
              title="Leave it where it is, free of the other gear"
              onClick={() => {
                const at = meshedWith(mate, f);
                x.change({ mesh: undefined, frame: at.frame, turn: at.turn, gear: at.gear });
              }}
            />
          </FeatureRow>
        </>
      )}
      {belt && (
        <>
          <FeatureRow label="Belt">
            <MenuButton
              label="Belt"
              entries={belts}
              trigger={(p) => <Button {...p} label={`${belt.on.length} mm belt`} title="Pick a stock GT2 belt: the pulley moves to fit it" />}
            />
          </FeatureRow>
          <PanelNote>{`Round ${belt.from.name}, ${belt.on.length / 2} teeth. ${ratioText(belt.from.gear.teeth, g.teeth, "pulley")}.`}</PanelNote>
          <FeatureRow label="On a belt">
            <Button
              label="Take off belt"
              title="Leave the pulley where it is, free of the belt"
              onClick={() => {
                const at = beltedTo(belt.from, f);
                x.change({ belt: undefined, ...(at ? { frame: at.frame } : {}) });
              }}
            />
          </FeatureRow>
        </>
      )}
      {form !== "rack" && (
        <>
          <FeatureRow label="Bore">
            <span role="group" aria-label="Bore" className="bc-segmented">
              {BORES.map((o) => (
                <Button
                  key={o.id}
                  label={o.label}
                  title={o.title}
                  on={b.kind === o.id}
                  onClick={() =>
                    x.change({ bore: { kind: o.id, diameter: o.diameter, ...(o.id === "dflat" ? { flat: 1.2 } : o.id === "horn" ? { arm: 7 } : {}) } })
                  }
                />
              ))}
            </span>
          </FeatureRow>
          {b.kind !== "none" && (
            <>
              <NumberField
                label={b.kind === "horn" ? "Horn hub" : "Bore"}
                unit="mm"
                value={b.diameter}
                min={0.1}
                onCommit={(v) => x.change({ bore: { ...b, diameter: v } })}
              />
              {b.kind === "dflat" && (
                <NumberField
                  label="Flat from centre"
                  unit="mm"
                  value={b.flat ?? round(b.diameter * 0.4)}
                  min={0}
                  onCommit={(v) => x.change({ bore: { ...b, flat: v } })}
                />
              )}
              {b.kind === "horn" && (
                <NumberField label="Arm holes" unit="mm" value={b.arm ?? 7} min={0.1} onCommit={(v) => x.change({ bore: { ...b, arm: v } })} />
              )}
            </>
          )}
        </>
      )}
      <Button
        className="bc-fpanel-more"
        icon="chevronDown"
        label="More settings"
        title={form === "gt2" ? "A hub on the pulley" : "Pressure angle, backlash, clearance, profile shift and hub"}
        aria-expanded={more}
        onClick={() => setMore((m) => !m)}
      />
      {more && (
        <>
          {form !== "gt2" && (
            <>
              {!mate && <NumberField label="Pressure angle" unit="°" value={g.pressure} min={10} max={35} onCommit={(v) => set({ pressure: v })} />}
              <NumberField label="Backlash" unit="mm" value={g.backlash} min={0} step={0.05} onCommit={(v) => set({ backlash: v })} />
              <NumberField label="Tip clearance" value={g.clearance} min={0} step={0.05} onCommit={(v) => set({ clearance: v })} />
              {form === "spur" && <NumberField label="Profile shift" value={g.shift} step={0.05} onCommit={(v) => set({ shift: v })} />}
            </>
          )}
          {form !== "rack" && (
            <>
              <NumberField
                label="Hub"
                unit="mm"
                value={f.hub?.diameter ?? 0}
                min={0}
                onCommit={(v) => x.change({ hub: v > 0 ? { diameter: v, length: f.hub?.length || 4 } : undefined })}
              />
              {f.hub && <NumberField label="Hub length" unit="mm" value={f.hub.length} min={0} onCommit={(v) => x.change({ hub: { ...f.hub!, length: v } })} />}
            </>
          )}
        </>
      )}
      {form === "spur" && !error && undercutWarning(g) && <PanelNote>{undercutWarning(g)}</PanelNote>}
      {more && form !== "gt2" && <PanelNote>Backlash starts at your printer's press fit. Clearance and shift are shares of the module.</PanelNote>}
      {belt && !error && <PanelNote>{`Centres ${round(centreForBelt(belt.on.length, belt.from.gear.teeth, g.teeth) ?? 0)} mm apart.`}</PanelNote>}
      {error && <PanelNote tone="error">{error}</PanelNote>}
    </FeaturePanel>
  );
}
