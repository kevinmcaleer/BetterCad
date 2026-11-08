import { useId, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { applyCompletion, completeAt, type Completion, type Scope } from "./expr";

export interface NameComplete {
  /**
   * Props for the input while there are names to offer. It stays a textbox (aria-autocomplete, aria-controls and
   * aria-activedescendant are all allowed on one), so fields are found by the same role with or without parameters.
   */
  inputProps: {
    "aria-autocomplete"?: "list";
    "aria-controls"?: string;
    "aria-activedescendant"?: string;
  };
  /** Call after the text or the caret changes. */
  update: (text: string, caret: number | null) => void;
  /** Call first in the input's keydown. True when the list used the key, so the field should not. */
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => boolean;
  close: () => void;
  /** The list, to render beside the input. */
  list: ReactNode;
}

/**
 * Offers the names in a scope (parameters, #75) as the user types one into an expression field. Down and Up move
 * through the list, Enter or Tab puts the name in, Esc closes the list before it backs out of the field.
 */
export function useNameComplete(scope: Scope | undefined, input: RefObject<HTMLInputElement | null>, setText: (text: string) => void): NameComplete {
  const listId = useId();
  const [comp, setComp] = useState<Completion | null>(null);
  const [active, setActive] = useState(0);
  const names = Object.keys(scope ?? {});
  const has = names.length > 0;
  const last = useRef("");

  const update = (text: string, caret: number | null) => {
    last.current = text;
    const next = has && caret !== null ? completeAt(text, caret, names) : null;
    setComp(next);
    setActive(0);
  };
  const close = () => setComp(null);

  const pick = (name: string) => {
    if (!comp) return;
    const out = applyCompletion(last.current, comp, name);
    last.current = out.text;
    setText(out.text);
    setComp(null);
    // After React has put the new text in.
    setTimeout(() => input.current?.setSelectionRange(out.caret, out.caret), 0);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): boolean => {
    if (!comp) return false;
    const n = comp.names.length;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (a + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
      return true;
    }
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation();
      pick(comp.names[active] ?? comp.names[0]!);
      return true;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setComp(null);
      return true;
    }
    return false;
  };

  const optionId = (i: number) => `${listId}-${i}`;
  const open = !!comp;
  const list = comp ? (
    <ul id={listId} className="bc-complete" role="listbox" aria-label="Parameters">
      {comp.names.map((name, i) => (
        <li
          key={name}
          id={optionId(i)}
          role="option"
          aria-selected={i === active}
          className={i === active ? "bc-on" : undefined}
          // Keep focus in the field.
          onMouseDown={(e) => {
            e.preventDefault();
            pick(name);
          }}
          onMouseEnter={() => setActive(i)}
        >
          <span>{name}</span>
          <em>{fmt(scope![name]!)}</em>
        </li>
      ))}
    </ul>
  ) : null;

  return {
    inputProps: has
      ? {
          "aria-autocomplete": "list",
          "aria-controls": open ? listId : undefined,
          "aria-activedescendant": open ? optionId(active) : undefined,
        }
      : {},
    update,
    onKeyDown,
    close,
    list,
  };
}

function fmt(v: number): string {
  return String(Math.round(v * 100) / 100);
}
