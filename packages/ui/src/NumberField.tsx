import { useId, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { cx } from "./cx";
import { evaluate, ExprError, isExpression, type Scope } from "./expr";
import { useNameComplete } from "./useNameComplete";

export type Unit = "mm" | "deg" | "%" | "none";

export interface NumberFieldProps {
  /** X, Y, Z, W, Depth…: shown above the field as a scrub handle. */
  label: string;
  /** The committed value. `null` means several selected things differ (shown as "–"). */
  value: number | null;
  /** Live changes while scrubbing or stepping. */
  onChange?: (value: number) => void;
  /** The final value: on Enter, blur, an arrow step or the end of a scrub. */
  onCommit?: (value: number, expression?: string) => void;
  unit?: Unit | "°";
  step?: number;
  min?: number;
  max?: number;
  /** Decimal places; 2 for mm, 1 for degrees by default. */
  precision?: number;
  /** Names an expression can use, such as parameters (#7). */
  scope?: Scope;
  /** Held by the geometry: disabled at 45%. */
  locked?: boolean;
  id?: string;
}

/** Step size for a key or drag: Shift x10, Alt x0.1. */
export function stepFor(step: number, e: { shiftKey: boolean; altKey: boolean }): number {
  if (e.shiftKey) return step * 10;
  if (e.altKey) return step / 10;
  return step;
}

export function clamp(v: number, min?: number, max?: number): number {
  if (min !== undefined && v < min) return min;
  if (max !== undefined && v > max) return max;
  return v;
}

export function roundTo(v: number, precision: number): number {
  const f = 10 ** precision;
  return Math.round(v * f) / f;
}

/** The scrub: one step for every 4px dragged. */
export function scrubValue(start: number, dx: number, step: number): number {
  return start + Math.trunc(dx / 4) * step;
}

const UNIT_TEXT: Record<string, string> = { mm: "mm", deg: "°", "°": "°", "%": "%", none: "" };

/**
 * A measurement field. Type a number or an expression ("45/2", "width + 3"), drag the label to scrub, or use the arrow
 * keys (Shift x10, Alt x0.1). Enter commits and keeps focus, Esc puts back the last committed value.
 */
export function NumberField({ label, value, onChange, onCommit, unit = "mm", step = 1, min, max, precision, scope, locked, id }: NumberFieldProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const places = precision ?? (unit === "deg" || unit === "°" ? 1 : 2);
  const format = (v: number | null) => (v === null || !Number.isFinite(v) ? "" : String(roundTo(v, places)));
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expression, setExpression] = useState<string | undefined>();
  const drag = useRef<{ x: number; start: number; last: number } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const names = useNameComplete(scope, input, (text) => {
    setDraft(text);
    setError(null);
  });

  const finish = (v: number, expr?: string) => {
    const next = clamp(roundTo(v, places), min, max);
    setDraft(null);
    setError(null);
    setExpression(expr);
    onChange?.(next);
    onCommit?.(next, expr);
    return next;
  };

  const commitDraft = () => {
    if (draft === null) return;
    try {
      const v = evaluate(draft, scope);
      finish(v, isExpression(draft) ? draft.trim() : undefined);
    } catch (e) {
      setError(e instanceof ExprError ? e.message : `Can't read ${draft}`);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (names.onKeyDown(e)) return;
    if (e.key === "Enter") {
      e.preventDefault();
      commitDraft();
    } else if (e.key === "Escape" && (draft !== null || error)) {
      e.preventDefault();
      e.stopPropagation();
      setDraft(null);
      setError(null);
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const base = draft !== null ? (safeEval(draft, scope) ?? value ?? 0) : (value ?? 0);
      finish(base + stepFor(step, e) * (e.key === "ArrowUp" ? 1 : -1));
    }
  };

  const onPointerDown = (e: PointerEvent<HTMLSpanElement>) => {
    if (locked || value === null) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, start: value, last: value };
  };
  const onPointerMove = (e: PointerEvent<HTMLSpanElement>) => {
    const d = drag.current;
    if (!d) return;
    const v = clamp(roundTo(scrubValue(d.start, e.clientX - d.x, stepFor(step, e)), places), min, max);
    if (v !== d.last) {
      d.last = v;
      onChange?.(v);
    }
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d && d.last !== d.start) finish(d.last);
  };

  const shown = draft ?? format(value);
  const tip = expression && draft === null ? `= ${expression}` : undefined;
  const unitText = UNIT_TEXT[unit] ?? unit;

  return (
    <div className={cx("bc-field", locked && "bc-locked", error && "bc-invalid")}>
      <label
        htmlFor={fieldId}
        className="bc-scrub"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {label}
      </label>
      <input
        ref={input}
        id={fieldId}
        className="bc-num"
        type="text"
        inputMode="decimal"
        enterKeyHint="done"
        autoComplete="off"
        spellCheck={false}
        aria-label={unitText ? `${label} (${unitText})` : label}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${fieldId}-err` : undefined}
        data-tip={tip}
        placeholder={value === null ? "–" : undefined}
        value={shown}
        disabled={locked}
        {...names.inputProps}
        onChange={(e) => {
          setDraft(e.currentTarget.value);
          setError(null);
          names.update(e.currentTarget.value, e.currentTarget.selectionStart);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => {
          names.close();
          commitDraft();
        }}
        onFocus={(e) => e.currentTarget.select()}
      />
      {unitText && <em>{unitText}</em>}
      {names.list}
      {error && (
        <span id={`${fieldId}-err`} className="bc-field-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

function safeEval(src: string, scope?: Scope): number | undefined {
  try {
    return evaluate(src, scope);
  } catch {
    return undefined;
  }
}

/** Three fields side by side: X Y Z, W D H. Tab moves between them in order. */
export function Fields({ children }: { children: ReactNode }) {
  return <div className="bc-fields">{children}</div>;
}
