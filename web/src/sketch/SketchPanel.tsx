import { useEffect, useRef } from "react";
import { Banner, Button, NumberField, PropRow, PropsPanel, type PropsSection } from "@bettercad/ui";
import { CONSTRAINT_LABEL } from "@bettercad/sketch";
import { formatCombo } from "../state/commands";
import { OPTION_ROWS } from "./options";
import { DIM_LABEL } from "./SketchUI";
import { FONTS } from "./text/fonts";
import type { SketchSession } from "./useSketch";

/**
 * The sketch palette, floating on the right while a sketch is open, after Fusion's: how constrained the sketch is,
 * its plane, what the view shows (the grid, snapping, profiles, points, sizes, constraint marks, projected and
 * construction geometry), Look at, the sizes and constraints, and Finish sketch at the foot.
 */
export function SketchPanel({ s }: { s: SketchSession }) {
  if (!s.sketch || !s.feature) return null;
  if (s.textEdit) return <TextPanel s={s} />;
  const sk = s.sketch;
  const pickedText = sk.texts?.find((t) => s.sel.length === 1 && s.sel[0] === t.id);
  const conflicting = new Set(s.result?.conflicting ?? []);
  const redundant = new Set(s.result?.redundant ?? []);
  const plane = sk.plane.kind === "world" ? `${sk.plane.plane} plane` : sk.plane.kind === "construct" ? "A construction plane" : "A face";
  const state = conflicting.size > 0 ? "bad" : s.result?.dof === 0 ? "done" : "free";
  const sections: PropsSection[] = [
    {
      id: "sketch",
      title: s.feature.name,
      content: (
        <>
          <p className={`bc-sk-status bc-sk-${state}`} role="status">
            <span className="bc-sk-dot" aria-hidden="true" />
            {s.status}
          </p>
          <PropRow label="On">{plane}</PropRow>
          <NumberField label="Offset" value={sk.plane.offset} step={1} onCommit={(v) => s.setOffset(v)} />
          {conflicting.size > 0 && <Banner tone="danger">Some constraints fight each other. Delete one of the ones in red.</Banner>}
          {s.finishWarn && (
            <Banner
              tone="warn"
              action={
                <span className="bc-row-actions">
                  <Button label="Finish anyway" variant="secondary" onClick={() => s.finish(true)} />
                  <Button label="Keep drawing" onClick={() => s.setFinishWarn(false)} />
                </span>
              }
            >
              This sketch has no closed shape yet, so it can't be extruded.
            </Banner>
          )}
        </>
      ),
    },
    ...(pickedText
      ? [
          {
            id: "sketch-text",
            title: "Text",
            content: (
              <>
                <p className="bc-note bc-text-quote">{pickedText.text}</p>
                <div className="bc-row-actions">
                  <Button icon="text" label="Edit text" variant="secondary" title="Change the words, font and size" onClick={() => s.editText(pickedText.id)} />
                </div>
              </>
            ),
          },
        ]
      : []),
    {
      id: "sketch-options",
      title: "Options",
      content: (
        <>
          <div className="bc-check-row">
            <span>Look at</span>
            <Button icon="camera" size="dense" title="Look straight at the sketch" onClick={s.lookAtSketch} />
          </div>
          {OPTION_ROWS.map((o) => (
            <label key={o.id} className="bc-check-row" title={o.title}>
              <span>{o.label}</span>
              <input type="checkbox" checked={s.options[o.id]} onChange={(e) => s.setOption(o.id, e.currentTarget.checked)} />
            </label>
          ))}
        </>
      ),
    },
    {
      id: "sketch-sizes",
      title: "Sizes",
      content: sk.dimensions.length ? (
        <>
          {sk.dimensions.map((d, i) => (
            <NumberField
              key={d.id}
              label={`${DIM_LABEL[d.kind]} ${i + 1}`}
              value={Math.round(d.value * 1000) / 1000}
              unit={d.kind === "angle" ? "°" : "mm"}
              locked={!d.driving}
              scope={s.scope}
              onCommit={(v, expr) => s.setDimension(d.id, expr ?? String(v))}
            />
          ))}
        </>
      ) : (
        <p className="bc-note">Press {formatCombo("d")} and click a line or circle to give it a size.</p>
      ),
    },
    {
      id: "sketch-constraints",
      title: `Constraints (${sk.constraints.length})`,
      content: sk.constraints.length ? (
        <ul className="bc-sk-list" aria-label="Constraints">
          {sk.constraints.map((c) => (
            <li key={c.id} className={conflicting.has(c.id) ? "bc-bad" : undefined}>
              <button type="button" className="bc-sk-item" aria-pressed={s.sel.includes(c.id)} onClick={() => s.setSel([c.id])}>
                {CONSTRAINT_LABEL[c.type]}
                {conflicting.has(c.id) ? " (fights)" : redundant.has(c.id) ? " (repeats)" : ""}
              </button>
              <Button
                icon="trash"
                size="dense"
                title={`Delete the ${CONSTRAINT_LABEL[c.type].toLowerCase()} constraint`}
                onClick={() => {
                  s.setSel([c.id]);
                  setTimeout(s.removeSelected, 0);
                }}
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="bc-note">Pick lines or points, then choose Constrain.</p>
      ),
    },
  ];
  return (
    <PropsPanel
      label="Sketch palette"
      sections={sections}
      footer={<Button kind="done" icon="finish" label="Finish sketch" title="Finish the sketch" shortcut="Enter" onClick={() => s.finish()} />}
    />
  );
}

/**
 * The Text card, in the palette's place while a text is being set: its words, font, height, turn, and the space
 * between letters and lines. The view shows the text as it will go in; Add text (or Done) puts it in the sketch.
 */
function TextPanel({ s }: { s: SketchSession }) {
  const t = s.textEdit!;
  const st = t.style;
  const isNew = !t.id;
  const words = useRef<HTMLTextAreaElement>(null);
  // Ready to type over: after the click that placed the text has finished moving focus to the view.
  useEffect(() => {
    const id = setTimeout(() => {
      words.current?.focus();
      words.current?.select();
    }, 0);
    return () => clearTimeout(id);
  }, [t.id]);
  const sections: PropsSection[] = [
    {
      id: "text",
      title: isNew ? "Text" : "Edit text",
      content: (
        <>
          <label className="bc-field-label" htmlFor="bc-text-words">
            Text
          </label>
          <textarea
            id="bc-text-words"
            className="bc-text bc-text-words"
            rows={2}
            ref={words}
            value={st.text}
            spellCheck={false}
            onChange={(e) => s.setTextStyle({ text: e.currentTarget.value })}
            onKeyDown={(e) => {
              // Enter starts a new line; Ctrl or Cmd with Enter puts the text in.
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                void s.commitText();
              }
            }}
          />
          <label className="bc-field-label" htmlFor="bc-text-font">
            Font
          </label>
          <select id="bc-text-font" className="bc-select bc-text-font" value={st.font} onChange={(e) => s.setTextStyle({ font: e.currentTarget.value })}>
            {FONTS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
          <NumberField label="Height" value={st.height} min={0.5} max={1000} step={1} scope={s.scope} onCommit={(v) => s.setTextStyle({ height: v })} />
          <NumberField
            label="Rotation"
            unit="°"
            value={st.angle}
            min={-360}
            max={360}
            step={15}
            scope={s.scope}
            onCommit={(v) => s.setTextStyle({ angle: v })}
          />
          <NumberField
            label="Letter spacing"
            value={st.letterSpacing}
            min={-100}
            max={100}
            step={0.5}
            scope={s.scope}
            onCommit={(v) => s.setTextStyle({ letterSpacing: v })}
          />
          <NumberField
            label="Line spacing"
            unit="%"
            value={Math.round(st.lineSpacing * 100)}
            min={50}
            max={400}
            step={10}
            precision={0}
            scope={s.scope}
            onCommit={(v) => s.setTextStyle({ lineSpacing: v / 100 })}
          />
          <p className="bc-note" role="status">
            {t.loading ? "Loading the font" : isNew ? "Click in the view to move where the text starts." : "Drag the text with Select to move it."}
          </p>
        </>
      ),
    },
  ];
  return (
    <PropsPanel
      label="Text"
      sections={sections}
      footer={
        <span className="bc-row-actions">
          <Button kind="cancel" label="Cancel" title="Leave the text as it was" shortcut="Esc" onClick={s.cancelText} />
          <Button
            kind="done"
            icon="check"
            label={isNew ? "Add text" : "Done"}
            title={isNew ? "Put the text in the sketch" : "Keep the changes"}
            shortcut="Ctrl+Enter"
            disabled={!st.text.trim()}
            onClick={() => void s.commitText()}
          />
        </span>
      }
    />
  );
}
