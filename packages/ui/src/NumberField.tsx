import { useId, useRef, type KeyboardEvent, type PointerEvent } from "react";
import { cx } from "./cx";

export interface NumberFieldProps {
  /** X, Y, Z, W, Depth…: shown above the field as a scrub handle. */
  label: string;
  value: number;
  onChange: (value: number) => void;
  /** mm, °, %. Always shown inside the field, never in the label. */
  unit?: string;
  step?: number;
  min?: number;
  max?: number;
  /** Decimal places shown. */
  precision?: number;
  /** Held by the geometry: disabled at 45%. */
  locked?: boolean;
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

function round(v: number, precision: number): number {
  const f = 10 ** precision;
  return Math.round(v * f) / f;
}

/** A measurement field with a scrub label and a unit. Arrow keys step by one, Shift by ten, Alt by a tenth. */
export function NumberField({ label, value, onChange, unit = "mm", step = 1, min, max, precision = 2, locked }: NumberFieldProps) {
  const id = useId();
  const drag = useRef<{ x: number; start: number } | null>(null);
  const commit = (v: number) => onChange(clamp(round(v, precision), min, max));

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const d = stepFor(step, e) * (e.key === "ArrowUp" ? 1 : -1);
    commit(value + d);
  };
  const onPointerDown = (e: PointerEvent<HTMLSpanElement>) => {
    if (locked) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, start: value };
  };
  const onPointerMove = (e: PointerEvent<HTMLSpanElement>) => {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.x;
    commit(drag.current.start + Math.round(dx / 2) * stepFor(step, e));
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  return (
    <div className={cx("bc-field", locked && "bc-locked")}>
      <span
        className="bc-scrub"
        title="Drag to change"
        aria-hidden="true"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {label}
      </span>
      <input
        id={id}
        className="bc-num"
        type="number"
        step="any"
        inputMode="decimal"
        aria-label={unit ? `${label} (${unit})` : label}
        value={Number.isFinite(value) ? round(value, precision) : ""}
        disabled={locked}
        onKeyDown={onKeyDown}
        onChange={(e) => {
          const v = e.currentTarget.valueAsNumber;
          if (Number.isFinite(v)) commit(v);
        }}
      />
      {unit && <em>{unit}</em>}
    </div>
  );
}

/** Three fields side by side: X Y Z, W D H. */
export function Fields({ children }: { children: React.ReactNode }) {
  return <div className="bc-fields">{children}</div>;
}
