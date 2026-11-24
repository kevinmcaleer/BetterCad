import { useEffect, useId, useMemo, useState } from "react";
import type { CheckLevel, ElectronicsDesign } from "@bettercad/electronics";
import { RULES, check, levelOf, setLevel, tally, tallyText, waive, type CheckResult } from "@bettercad/electronics/erc";
import type { ReactNode } from "react";
import { Button, ESC, FeaturePanel, PanelNote, cx, useEscape } from "@bettercad/ui";
import type { EEdit } from "./actions";
import { eui } from "./ui";

let shown = 0;

type Result = CheckResult<string>;

/** Goes to a result: its sheet, its parts picked, its spot ringed in the middle of the view. */
export function showResult(design: ElectronicsDesign, r: Result): void {
  if (r.board || eui.get().view === "pcb") {
    eui.set({ selected: r.parts, net: null, spot: r.at ? { sheet: "board", at: r.at, n: (shown += 1) } : null });
    return;
  }
  const parts = new Set(r.parts);
  const sheet = design.sheets.find((s) => s.id === r.sheet) ?? design.sheets.find((s) => s.symbols.some((y) => parts.has(y.part)));
  eui.set({
    ...(sheet ? { sheet: sheet.id } : {}),
    selected: sheet?.symbols.filter((y) => parts.has(y.part)).map((y) => y.id) ?? [],
    spot: sheet && r.at ? { sheet: sheet.id, at: r.at, n: (shown += 1) } : null,
  });
}

const LEVELS: { id: CheckLevel; label: string }[] = [
  { id: "error", label: "Error" },
  { id: "warning", label: "Warning" },
  { id: "ignore", label: "Ignore" },
];

export interface ChecksPanelProps {
  design: ElectronicsDesign;
  edit: EEdit;
  readOnly?: boolean;
  onClose: () => void;
  title: string;
  results: Result[];
  rules: { id: string; label: string; level: Exclude<CheckLevel, "ignore"> }[];
  /** What to say when nothing is found. */
  clean: string;
  onWaive: (d: ElectronicsDesign, key: string, note?: string) => ElectronicsDesign;
  children?: ReactNode;
}

/**
 * The rules check (#634): what is wrong with the schematic, each with what to do about it. Click one to go to it.
 * A result can be waived with a note, and each rule can be made an error, a warning or left out.
 */
export default function ChecksCard(p: { design: ElectronicsDesign; edit: EEdit; readOnly?: boolean; onClose: () => void }) {
  const results = useMemo(() => check(p.design), [p.design]);
  return (
    <ChecksPanel
      {...p}
      title="Rules check"
      results={results}
      rules={RULES}
      clean={p.design.parts.length ? "No problems found." : "Nothing to check yet. Place some parts first."}
      onWaive={waive}
    />
  );
}

/** The card both checks share: the schematic's rules and the board's (#644) list, waive and set levels the same way. */
export function ChecksPanel({ design, edit, readOnly, onClose, title, results, rules: ruleList, clean, onWaive, children }: ChecksPanelProps) {
  const id = useId();
  const live = results.filter((r) => r.waived === undefined);
  const waived = results.filter((r) => r.waived !== undefined);
  const count = tally(results);
  const [at, setAt] = useState<string | null>(null);
  const [waiving, setWaiving] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [rules, setRules] = useState(false);
  const close = () => {
    eui.set({ spot: null });
    onClose();
  };
  useEscape(true, close, ESC.panel);
  // The spot's ring goes when the card does, however it is closed.
  useEffect(() => () => eui.set({ spot: null }), []);

  const go = (r: Result) => {
    setAt(r.key);
    showResult(design, r);
  };
  const step = (by: number) => {
    if (!live.length) return;
    const i = live.findIndex((r) => r.key === at);
    go(live[(i < 0 ? (by > 0 ? 0 : live.length - 1) : i + by + live.length) % live.length]!);
  };

  const row = (r: Result) => (
    <li key={r.key} className={cx(`bc-ec-check-${r.waived !== undefined ? "waived" : r.level}`, at === r.key && "bc-on")}>
      <button type="button" className="bc-ec-check-go" aria-current={at === r.key || undefined} onClick={() => go(r)}>
        <span className="bc-ec-check-level">{r.waived !== undefined ? "Waived" : r.level === "error" ? "Error" : "Warning"}</span>
        <span className="bc-ec-check-text">{r.text}</span>
        <span className="bc-note">{r.waived !== undefined ? r.waived || "No note" : r.fix}</span>
      </button>
      {!readOnly &&
        (r.waived !== undefined ? (
          <Button
            size="dense"
            variant="secondary"
            label="Bring back"
            title="Count this result again"
            onClick={() => edit((d) => onWaive(d, r.key), "Bring a check back")}
          />
        ) : waiving === r.key ? (
          <form
            className="bc-ec-check-waive"
            onSubmit={(e) => {
              e.preventDefault();
              edit((d) => onWaive(d, r.key, note), "Waive a check");
              setWaiving(null);
            }}
          >
            <input
              className="bc-text"
              aria-label="Why it is fine"
              placeholder="Why it is fine"
              autoFocus
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <Button size="dense" variant="secondary" type="submit" label="Waive" />
            <Button size="dense" variant="secondary" label="Keep" title="Leave the result as it is" onClick={() => setWaiving(null)} />
          </form>
        ) : (
          <Button
            size="dense"
            variant="secondary"
            label="Waive"
            title="This one is fine: stop counting it, with a note saying why"
            onClick={() => {
              setNote("");
              setWaiving(r.key);
            }}
          />
        ))}
    </li>
  );

  return (
    <FeaturePanel
      title={title}
      icon="rulesCheck"
      className="bc-ec-card bc-ec-checks"
      cancel={{ label: "Close", title: "Close the rules check (Esc)", onClick: close }}
    >
      <p className="bc-ec-check-sum" role="status">
        {live.length ? `${tallyText(count)} to look at.` : clean}
        {count.waived > 0 && ` ${count.waived} waived.`}
      </p>
      {live.length > 1 && (
        <div className="bc-ec-library-tools">
          <Button size="dense" variant="secondary" label="Previous" title="Go to the result before" onClick={() => step(-1)} />
          <Button size="dense" variant="secondary" label="Next" title="Go to the next result" onClick={() => step(1)} />
        </div>
      )}
      {children}
      {results.length > 0 && (
        <ul className="bc-ec-check-list" aria-label="Results">
          {live.map(row)}
          {waived.map(row)}
        </ul>
      )}
      <button type="button" className="bc-ec-check-rules" aria-expanded={rules} aria-controls={`${id}r`} onClick={() => setRules(!rules)}>
        {rules ? "Hide the rules" : "Choose the rules"}
      </button>
      {rules && (
        <div id={`${id}r`} className="bc-ec-rule-list">
          {ruleList.map((r) => (
            <label key={r.id}>
              <span>{r.label}</span>
              <select
                className="bc-select"
                value={levelOf(design, r)}
                disabled={readOnly}
                onChange={(e) => edit((d) => setLevel(d, r.id, e.target.value as CheckLevel, ruleList), "Change a rule")}
              >
                {LEVELS.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <PanelNote>The rules are kept with the model.</PanelNote>
        </div>
      )}
    </FeaturePanel>
  );
}
