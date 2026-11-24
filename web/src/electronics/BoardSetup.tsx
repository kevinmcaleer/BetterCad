import { useId, useMemo, useState } from "react";
import { boardSize, netlist, type Board, type ElectronicsDesign, type NetClass } from "@bettercad/electronics";
import { outlineRadius, roundedOutline, setBoard } from "@bettercad/electronics/pcb/route";
import { PRESETS, RULE_FIELDS, applyPreset, matchesPreset, presetOf, setRule } from "@bettercad/electronics/pcb/rules";
import { Button, ESC, FeaturePanel, FeatureRow, NumberField, PanelNote, useEscape } from "@bettercad/ui";
import type { EEdit } from "./actions";

const THICKNESS = [0.8, 1, 1.2, 1.6, 2];
const MASKS: NonNullable<Board["mask"]>[] = ["green", "black", "blue", "red", "white", "purple", "yellow"];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
let made = 0;

/** A day as people write it: "24 November 2026". */
const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/**
 * Board setup (#637, #643): the board's size, thickness and colours, the rules it is checked against and the net
 * classes that give some nets wider tracks. Every change is one undo step.
 */
export default function BoardSetup({ design, edit, readOnly, onClose }: { design: ElectronicsDesign; edit: EEdit; readOnly?: boolean; onClose: () => void }) {
  const id = useId();
  const board = design.board!;
  const size = boardSize(board);
  const radius = outlineRadius(board.outline);
  const plain = radius > 0 || (board.outline.length === 4 && board.outline.every((c) => !c.bulge));
  const preset = presetOf(board.rules);
  const own = !matchesPreset(board.rules);
  const [numbers, setNumbers] = useState(false);
  const nets = useMemo(
    () =>
      netlist(design)
        .nets.filter((n) => n.pins.length > 0)
        .map((n) => n.name),
    [design],
  );
  useEscape(true, onClose, ESC.panel);

  const shape = (w: number, h: number, r: number) => edit((d) => setBoard(d, { outline: roundedOutline(w, h, r) }), "Change the board's size", "ec-board-size");
  const classes = (next: NetClass[], label: string, key?: string) => edit((d) => setBoard(d, { classes: next }), label, key);
  const setClass = (k: NetClass, change: Partial<NetClass>, label: string) =>
    classes(
      board.classes.map((x) => (x.id === k.id ? { ...x, ...change } : x)),
      label,
      `ec-class-${k.id}-${Object.keys(change).join()}`,
    );

  return (
    <FeaturePanel
      title="Board setup"
      icon="settings"
      className="bc-ec-card bc-ec-setup"
      cancel={{ label: "Close", title: "Close board setup (Esc)", onClick: onClose }}
    >
      <fieldset className="bc-ec-set" disabled={readOnly}>
        <legend>Size</legend>
        {plain ? (
          <div className="bc-ec-set-row">
            <NumberField label="Width" value={size.w} min={2} max={500} onCommit={(v) => shape(v, size.h, radius)} />
            <NumberField label="Height" value={size.h} min={2} max={500} onCommit={(v) => shape(size.w, v, radius)} />
            <NumberField label="Corners" value={radius} min={0} max={Math.min(size.w, size.h) / 2} step={0.5} onCommit={(v) => shape(size.w, size.h, v)} />
          </div>
        ) : (
          <>
            <PanelNote>
              The outline is a shape of its own, {size.w} × {size.h} mm.
            </PanelNote>
            <Button
              size="dense"
              variant="secondary"
              label="Make it a rectangle"
              title="Swap the outline for a rectangle of the same size"
              onClick={() => shape(size.w, size.h, 0)}
            />
          </>
        )}
        <FeatureRow label="Thickness">
          <select
            className="bc-select"
            aria-label="Thickness"
            value={board.thickness}
            onChange={(e) => edit((d) => setBoard(d, { thickness: Number(e.target.value) }), "Change the board's thickness")}
          >
            {[...new Set([...THICKNESS, board.thickness])].sort().map((t) => (
              <option key={t} value={t}>
                {t} mm
              </option>
            ))}
          </select>
        </FeatureRow>
        <FeatureRow label="Solder mask">
          <select
            className="bc-select"
            aria-label="Solder mask"
            value={board.mask ?? "green"}
            onChange={(e) => edit((d) => setBoard(d, { mask: e.target.value as Board["mask"] }), "Change the board's colour")}
          >
            {MASKS.map((m) => (
              <option key={m} value={m}>
                {cap(m)}
              </option>
            ))}
          </select>
        </FeatureRow>
        <FeatureRow label="Silkscreen">
          <select
            className="bc-select"
            aria-label="Silkscreen"
            value={board.silk ?? "white"}
            onChange={(e) => edit((d) => setBoard(d, { silk: e.target.value as Board["silk"] }), "Change the silkscreen's colour")}
          >
            <option value="white">White</option>
            <option value="black">Black</option>
          </select>
        </FeatureRow>
      </fieldset>

      <fieldset className="bc-ec-set" disabled={readOnly}>
        <legend>Rules</legend>
        <FeatureRow label="Made by">
          <select
            className="bc-select"
            aria-label="Made by"
            value={preset?.id ?? "safe"}
            onChange={(e) => edit((d) => applyPreset(d, e.target.value), "Change the board's rules")}
          >
            {PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </FeatureRow>
        {preset?.source && preset.checked && (
          <PanelNote>
            Limits from{" "}
            <a href={preset.source} target="_blank" rel="noreferrer">
              {new URL(preset.source).hostname.replace(/^www\./, "")}
            </a>
            , checked on {day(preset.checked)}. Check their page before you order.
          </PanelNote>
        )}
        {own && preset && (
          <PanelNote>
            You have changed some numbers.{" "}
            <Button
              size="dense"
              variant="secondary"
              label="Put them back"
              title={`Use ${preset.name} as it comes`}
              onClick={() => edit((d) => applyPreset(d, preset.id), "Put the rules back")}
            />
          </PanelNote>
        )}
        <button type="button" className="bc-ec-check-rules" aria-expanded={numbers} aria-controls={`${id}n`} onClick={() => setNumbers(!numbers)}>
          {numbers ? "Hide the numbers" : "Change the numbers"}
        </button>
        {numbers && (
          <div id={`${id}n`} className="bc-ec-set-grid">
            {RULE_FIELDS.map((f) => (
              <div key={f.id} data-tip={f.hint}>
                <NumberField
                  label={f.label}
                  value={board.rules[f.id] ?? board.rules.minRing}
                  min={0}
                  max={10}
                  step={0.05}
                  precision={3}
                  onCommit={(v) => edit((d) => setRule(d, f.id, v), "Change a rule", `ec-rule-${f.id}`)}
                />
              </div>
            ))}
          </div>
        )}
      </fieldset>

      <fieldset className="bc-ec-set" disabled={readOnly}>
        <legend>Net classes</legend>
        <PanelNote>Give some nets wider tracks or more room, such as power.</PanelNote>
        {board.classes.map((k) => (
          <div key={k.id} className="bc-ec-class">
            <div className="bc-ec-set-row">
              <input className="bc-text" aria-label="Class name" value={k.name} onChange={(e) => setClass(k, { name: e.target.value }, "Rename a net class")} />
              <Button
                size="dense"
                variant="secondary"
                icon="trash"
                aria-label={`Remove ${k.name}`}
                title="Remove this class. Its tracks keep their width."
                onClick={() =>
                  classes(
                    board.classes.filter((x) => x.id !== k.id),
                    "Remove a net class",
                  )
                }
              />
            </div>
            <div className="bc-ec-set-row">
              <NumberField
                label="Track width"
                value={k.trackWidth}
                min={0.05}
                max={10}
                step={0.05}
                precision={3}
                onCommit={(v) => setClass(k, { trackWidth: v }, "Change a net class")}
              />
              <NumberField
                label="Clearance"
                value={k.clearance}
                min={0.05}
                max={10}
                step={0.05}
                precision={3}
                onCommit={(v) => setClass(k, { clearance: v }, "Change a net class")}
              />
            </div>
            <ul className="bc-ec-class-nets" aria-label={`Nets in ${k.name}`}>
              {nets.map((n) => (
                <li key={n}>
                  <label>
                    <input
                      type="checkbox"
                      checked={k.nets.includes(n)}
                      onChange={(e) =>
                        classes(
                          // A net is in one class at a time.
                          board.classes.map((x) =>
                            x.id === k.id
                              ? { ...x, nets: e.target.checked ? [...x.nets, n] : x.nets.filter((y) => y !== n) }
                              : e.target.checked
                                ? { ...x, nets: x.nets.filter((y) => y !== n) }
                                : x,
                          ),
                          "Change a net class",
                        )
                      }
                    />
                    {n}
                  </label>
                </li>
              ))}
              {nets.length === 0 && <li className="bc-note">No nets yet.</li>}
            </ul>
          </div>
        ))}
        <Button
          size="dense"
          variant="secondary"
          icon="plus"
          label="Add a class"
          title="Add a net class"
          onClick={() =>
            classes(
              [
                ...board.classes,
                {
                  id: `nc${Date.now().toString(36)}${(made += 1)}`,
                  name: board.classes.length ? `Class ${board.classes.length + 1}` : "Power",
                  nets: [],
                  trackWidth: Math.max(0.5, board.rules.trackWidth * 2),
                  clearance: board.rules.clearance,
                },
              ],
              "Add a net class",
            )
          }
        />
      </fieldset>
    </FeaturePanel>
  );
}
