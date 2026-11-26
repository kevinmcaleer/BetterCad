import { useId, useMemo, useState } from "react";
import { netlist, type ElectronicsDesign, type SchGroup } from "@bettercad/electronics";
import { joinI2c, joinPoint, pointsJoined, suggestTargets } from "@bettercad/electronics/connect";
import { renameGroup, setFolded, ungroupOnSheet } from "@bettercad/electronics/groups";
import { Button, PropsPanel, cx } from "@bettercad/ui";
import type { EEdit } from "./actions";
import { KIND_TEXT } from "./pointKinds";
import BlockUpdate from "./BlockUpdate";
import SaveBlock from "./SaveBlock";
import { eui } from "./ui";

/**
 * A picked group in the inspector (#766), and for a circuit block (#768, #770) what is inside it, which of its points
 * are joined, and Connect to… for each open one.
 */
export default function GroupProps({
  design,
  sheet,
  group,
  edit,
  readOnly,
}: {
  design: ElectronicsDesign;
  sheet: string;
  group: SchGroup;
  edit: EEdit;
  readOnly?: boolean;
}) {
  const ids = useId();
  const [open, setOpen] = useState<string | null>(null);
  const [said, setSaid] = useState("");
  const s = design.sheets.find((x) => x.id === sheet)!;
  const block = group.block;
  const state = useMemo(() => pointsJoined(s, group), [s, group]);
  const nl = useMemo(() => netlist(design), [design]);
  const joined = state.filter((p) => p.joined).length;
  const targets = useMemo(() => (open ? suggestTargets(design, sheet, group.id, open, 8, nl) : []), [design, sheet, group.id, open, nl]);
  const i2c = state.some((p) => !p.joined && (p.point.kind === "i2c-sda" || p.point.kind === "i2c-scl"));
  const parts = s.symbols.filter((y) => group.members.includes(y.id) && y.unit === 1).map((y) => design.parts.find((p) => p.id === y.part)!);
  return (
    <PropsPanel
      sections={[
        {
          id: "ec-group",
          title: block ? `${block.tag} · ${group.name}` : group.name,
          content: (
            <>
              <label className="bc-field-label" htmlFor={`${ids}n`}>
                {block ? "Block name" : "Group name"}
              </label>
              <input
                id={`${ids}n`}
                className="bc-text"
                defaultValue={group.name}
                key={group.name}
                disabled={readOnly}
                onBlur={(e) =>
                  e.target.value.trim() && e.target.value !== group.name && edit((d) => renameGroup(d, sheet, group.id, e.target.value), "Rename group")
                }
              />
              <p className="bc-note">{group.members.length} things. Drag the outline to move them together; double-click a part to change it on its own.</p>
              <Button
                size="dense"
                variant="secondary"
                label="Ungroup"
                title="Take the group apart and leave its parts where they are (Ctrl+Shift+G)"
                disabled={readOnly}
                onClick={() => {
                  edit((d) => ungroupOnSheet(d, sheet, group.id), "Ungroup");
                  eui.set({ inGroup: null });
                }}
              />
              {block && (
                <Button
                  size="dense"
                  variant="secondary"
                  label={group.folded ? "Unfold" : "Fold to a box"}
                  title={group.folded ? "Show the parts inside again" : "Show only the block's box and points. Its nets stay the same"}
                  disabled={readOnly}
                  onClick={() => edit((d) => setFolded(d, sheet, [group.id], !group.folded), group.folded ? "Unfold block" : "Fold block")}
                />
              )}
              {block && !readOnly && <BlockUpdate design={design} sheet={sheet} group={group} edit={edit} />}
              {!readOnly && <SaveBlock design={design} sheet={sheet} group={group} edit={edit} />}
            </>
          ),
        },
        ...(block && state.length
          ? [
              {
                id: "ec-points",
                title: "Connection points",
                content: (
                  <>
                    <p className="bc-note" role="status">
                      {joined} of {state.length} points joined.
                      {state.some((p) => !p.joined && p.point.required) ? " The ones marked Needed must be joined for the block to work." : ""}
                    </p>
                    {i2c && !readOnly && (
                      <Button
                        size="dense"
                        variant="secondary"
                        label="Join I2C"
                        title="Join SDA and SCL to the best pair of pins on one bus"
                        onClick={() =>
                          edit((d) => {
                            const r = joinI2c(d, sheet, group.id);
                            setSaid(r.joined.length ? `Joined ${r.joined.join(" and ")}.` : "Nothing to join I2C to yet. Place a microcontroller first.");
                            return r.design;
                          }, "Join I2C")
                        }
                      />
                    )}
                    {said && <p className="bc-note">{said}</p>}
                    <ul className="bc-ec-block-points" aria-label="Points">
                      {state.map(({ point: p, at, joined: on }) => (
                        <li key={p.label}>
                          <span className={cx("bc-ec-point-dot", `bc-ec-point-${p.kind}`)} aria-hidden="true" />
                          <strong>{p.name}</strong>
                          <span>
                            {on ? "Joined" : p.required ? "Needed" : "Open"}
                            {p.volts ? `, ${p.volts}` : ""}
                          </span>
                          <small>
                            {KIND_TEXT[p.kind]}
                            {p.note ? `. ${p.note}` : ""}
                          </small>
                          {!on && !readOnly && (
                            <Button
                              size="dense"
                              variant="secondary"
                              label="Connect to…"
                              aria-label={`Connect ${p.name} to…`}
                              aria-expanded={open === p.label}
                              onClick={() => setOpen(open === p.label ? null : p.label)}
                            />
                          )}
                          {open === p.label && (
                            <ul className="bc-ec-parts bc-ec-parts-short" aria-label={`Where ${p.name} can go`}>
                              {targets.length === 0 && (
                                <li className="bc-note">Nothing fits yet. Place the part it joins, then try again, or draw a wire (W).</li>
                              )}
                              {targets.map((t) => (
                                <li key={t.kind === "pin" ? `${t.part}:${t.pin}` : t.label}>
                                  <button
                                    type="button"
                                    className="bc-ec-part"
                                    onClick={() => {
                                      edit((d) => joinPoint(d, sheet, at, t.at), `Connect ${p.name}`);
                                      setOpen(null);
                                      setSaid(`Joined ${p.name} to ${t.text}.`);
                                    }}
                                  >
                                    <span>{t.text}</span>
                                    <small>{t.note}</small>
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                        </li>
                      ))}
                    </ul>
                  </>
                ),
              },
              {
                id: "ec-inside",
                title: "Inside",
                content: (
                  <ul className="bc-ec-block-inside" aria-label="Inside">
                    {parts.map((part) => (
                      <li key={part.id}>
                        <strong>{part.ref}</strong> {part.value}: {block.notes?.[part.id] ?? ""}
                      </li>
                    ))}
                  </ul>
                ),
              },
            ]
          : []),
      ]}
    />
  );
}
