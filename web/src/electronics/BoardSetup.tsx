import { useId, useMemo, useRef, useState } from "react";
import { boardSize, netlist, type Board, type ElectronicsDesign, type NetClass } from "@bettercad/electronics";
import {
  followFace,
  followSketch,
  holesFromCutouts,
  outlineBehind,
  roundCutouts,
  takeShape,
  unfollowSketch,
  type OutlineShape,
} from "@bettercad/electronics/pcb/outline";
import { outlineRadius, roundedOutline, setBoard } from "@bettercad/electronics/pcb/route";
import { STACKS, buildOf, layerName, setStack, stackLoses, stackOf } from "@bettercad/electronics/pcb/stack";
import { PRESETS, RULE_FIELDS, applyPreset, keepRules, matchesPreset, presetChanges, presetOf, setRule } from "@bettercad/electronics/pcb/rules";
import type { Sketch } from "@bettercad/sketch";
import { Button, ESC, FeaturePanel, FeatureRow, NumberField, PanelNote, useEscape } from "@bettercad/ui";
import type { EEdit } from "./actions";
import { boardFaces, type ModelFaces } from "./faceOutline";
import { textOf } from "./fileText";
import { sketchShape } from "./follow";

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
/** A sketch in the model the board can take its shape from. */
export interface OutlineSketch {
  id: string;
  name: string;
  sketch: Sketch;
}

export default function BoardSetup({
  design,
  edit,
  readOnly,
  onClose,
  sketches = [],
  model,
  inModel,
  onAddBoard,
}: {
  design: ElectronicsDesign;
  edit: EEdit;
  readOnly?: boolean;
  onClose: () => void;
  /** The model's sketches, for a board that takes its shape from one. */
  sketches?: OutlineSketch[];
  /** The model's bodies and what is picked on them, for a board that takes its shape from a flat face. */
  model?: ModelFaces;
  /** Whether the model has its Board step, and how to add it. */
  inModel?: boolean;
  onAddBoard?: () => void;
}) {
  const id = useId();
  const board = design.board!;
  const size = boardSize(board);
  const radius = outlineRadius(board.outline);
  const plain = radius > 0 || (board.outline.length === 4 && board.outline.every((c) => !c.bulge));
  const preset = presetOf(board.rules);
  const newer = presetChanges(board.rules);
  const own = !newer && !matchesPreset(board.rules);
  const [numbers, setNumbers] = useState(false);
  const nets = useMemo(
    () =>
      netlist(design)
        .nets.filter((n) => n.pins.length > 0)
        .map((n) => n.name),
    [design],
  );
  useEscape(true, onClose, ESC.panel);
  // What the board can take its shape from: the model's sketches, then the face it follows and any face picked in 3D.
  const onFace = board.outlineFrom?.face;
  const shapes = useMemo(
    () => [
      ...sketches.flatMap((s) => (sketchShape(s.sketch) ? [{ id: s.id, name: s.name, shape: sketchShape(s.sketch)!, face: "", frame: undefined }] : [])),
      ...boardFaces(model, onFace).map((f) => ({ id: `face:${f.id}`, name: f.name, shape: f.shape as OutlineShape, face: f.id, frame: f.shape.frame })),
    ],
    [sketches, model?.bodies, model?.picks, model?.names, onFace], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const followed = board.outlineFrom?.sketch ?? (onFace ? `face:${onFace}` : undefined);
  const source = shapes.find((s) => s.id === followed);
  const follow = (to: (typeof shapes)[number], label: string) =>
    edit((d) => (to.face ? followFace(d, to.face, to.shape, to.frame) : followSketch(d, to.id, to.shape)), label);
  const round = useMemo(() => roundCutouts(board.cutouts ?? []).length, [board.cutouts]);
  const dxfFile = useRef<HTMLInputElement>(null);
  const [said, setSaid] = useState("");
  /** A DXF file's biggest closed shape becomes the board's edge (#638). Its reader loads when a file is picked. */
  const fromDxf = async (file: File | undefined) => {
    if (!file) return;
    try {
      const { dxfOutline } = await import("@bettercad/electronics/pcb/dxf");
      const { shape: found, notes } = dxfOutline(await textOf(file));
      if (!found) return setSaid(["That file has no closed shape to make a board from.", ...notes].join(" "));
      edit((d) => takeShape(d, found), "Shape the board from a DXF file");
      setSaid(["The board took its shape from the file.", ...notes].join(" "));
    } catch {
      setSaid("That file could not be read.");
    }
  };
  const behind = !!source && outlineBehind(board, source.shape);

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
        {(shapes.length > 0 || followed) && (
          <FeatureRow label="Shape">
            <select
              className="bc-select"
              aria-label="Board shape"
              value={followed ?? ""}
              onChange={({ target: { value } }) => {
                const to = shapes.find((s) => s.id === value);
                if (to) follow(to, `Shape the board from ${to.name}`);
                else edit(unfollowSketch, onFace ? "Stop following the face" : "Stop following the sketch");
              }}
            >
              <option value="">Set here</option>
              {followed && !source && <option value={followed}>{onFace ? "A face that is gone" : "A sketch that is gone"}</option>}
              {shapes.map((s) => (
                <option key={s.id} value={s.id}>
                  From {s.name}
                </option>
              ))}
            </select>
          </FeatureRow>
        )}
        {followed ? (
          <>
            <PanelNote>
              {source
                ? `The outline follows ${source.name}: ${size.w} × ${size.h} mm, and changes when it does. ${onFace ? "Holes through it" : "Shapes inside it"} are cut out.`
                : onFace
                  ? "The face the outline followed is gone, or is no longer flat. The outline stays as it was."
                  : "The sketch the outline followed is gone, or has no closed shape. The outline stays as it was."}
            </PanelNote>
            {behind && source && (
              <>
                <PanelNote live>{cap(source.name)} has changed since the board took its shape.</PanelNote>
                <Button
                  size="dense"
                  variant="primary"
                  label="Update the outline"
                  title={onFace ? "Take the face's shape as it is now" : "Take the sketch's shape as it is now"}
                  onClick={() => follow(source, "Update the board's outline")}
                />
              </>
            )}
          </>
        ) : plain ? (
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
        <input
          ref={dxfFile}
          type="file"
          accept=".dxf,image/vnd.dxf,application/dxf"
          hidden
          aria-label="A DXF file for the board's shape"
          onChange={(e) => {
            void fromDxf(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <Button
          size="dense"
          variant="secondary"
          label="Shape from a DXF file"
          title="Take the board's edge and cut-outs from a drawing's closed shapes"
          onClick={() => dxfFile.current?.click()}
        />
        {said && <PanelNote live>{said}</PanelNote>}
        {round > 0 && (
          <>
            <PanelNote>{round === 1 ? "1 round cut-out could be a mounting hole." : `${round} round cut-outs could be mounting holes.`}</PanelNote>
            <Button
              size="dense"
              variant="secondary"
              label={round === 1 ? "Make it a mounting hole" : "Make them mounting holes"}
              title="Drill them as holes, so each can be sized for a screw"
              onClick={() => edit(holesFromCutouts, "Make mounting holes from cut-outs")}
            />
          </>
        )}
        <FeatureRow label="Layers">
          <select
            className="bc-select"
            aria-label="Copper layers"
            value={stackOf(board).id}
            onChange={({ target: { value } }) => {
              const lost = stackLoses(board, value);
              edit((d) => setStack(d, value), "Change the board's layers");
              const gone = [
                lost.tracks ? `${lost.tracks} ${lost.tracks === 1 ? "track" : "tracks"}` : "",
                lost.pours ? `${lost.pours} ${lost.pours === 1 ? "pour" : "pours"}` : "",
              ].filter(Boolean);
              setSaid(gone.length ? `${gone.join(" and ")} on the inner layers went with them. Undo puts them back.` : "");
            }}
          >
            {STACKS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.name}
              </option>
            ))}
          </select>
        </FeatureRow>
        {board.copperLayers > 2 && (
          <>
            <table className="bc-ec-table" aria-label="The build, top to bottom">
              <tbody>
                {buildOf(board).map((ply, i) => (
                  <tr key={i}>
                    <th scope="row">{ply.layer ? layerName(ply.layer) : ply.kind === "core" ? "Core" : "Prepreg"}</th>
                    <td>{ply.thickness} mm</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <PanelNote>
              {stackOf(board).note} This is a usual build, not a board house's own: ask yours for its sheet thicknesses if they matter. Draw a pour over the
              whole board on an inner layer to make it a plane.
            </PanelNote>
          </>
        )}
        <FeatureRow label="Thickness">
          <select
            className="bc-select"
            aria-label="Thickness"
            value={board.thickness}
            onChange={({ target: { value } }) => edit((d) => setBoard(d, { thickness: Number(value) }), "Change the board's thickness")}
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
            onChange={({ target: { value } }) => edit((d) => setBoard(d, { mask: value as Board["mask"] }), "Change the board's colour")}
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
            onChange={({ target: { value } }) => edit((d) => setBoard(d, { silk: value as Board["silk"] }), "Change the silkscreen's colour")}
          >
            <option value="white">White</option>
            <option value="black">Black</option>
          </select>
        </FeatureRow>
      </fieldset>

      {onAddBoard && !inModel && (
        <fieldset className="bc-ec-set" disabled={readOnly}>
          <legend>In the model</legend>
          <PanelNote>The board is not in the 3D model yet. Add it to see it with its parts, and to design a case round it.</PanelNote>
          <Button
            size="dense"
            variant="secondary"
            icon="cube"
            label="Add the board to the model"
            title="Add a Board step to the timeline"
            onClick={onAddBoard}
          />
        </fieldset>
      )}

      <fieldset className="bc-ec-set" disabled={readOnly}>
        <legend>Rules</legend>
        <FeatureRow label="Made by">
          <select
            className="bc-select"
            aria-label="Made by"
            value={preset?.id ?? "safe"}
            onChange={({ target: { value } }) => edit((d) => applyPreset(d, value), "Change the board's rules")}
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
        {newer && (
          <PanelNote>
            {newer.preset.name} has been checked again since this board took its rules, and{" "}
            {newer.fields.length === 1 ? "one number differs" : `${newer.fields.length} numbers differ`}:{" "}
            {newer.fields
              .map((f) => `${f.label} ${f.yours === undefined ? "not set" : `${f.yours} mm`}, now ${f.theirs === undefined ? "not set" : `${f.theirs} mm`}`)
              .join("; ")}
            .{" "}
            <Button
              size="dense"
              variant="secondary"
              label="Update the rules"
              title={`Use ${newer.preset.name} as it is now`}
              onClick={() => edit((d) => applyPreset(d, newer.preset.id), "Update the board's rules")}
            />{" "}
            <Button
              size="dense"
              variant="secondary"
              label="Keep these"
              title="Keep the numbers this board has"
              onClick={() => edit(keepRules, "Keep the board's rules")}
            />
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
