import type { KeyboardEvent } from "react";
import { ArmedBar, Button, NumberField } from "@bettercad/ui";
import { constructIcon } from "../editor/Timeline";
import type { ConstructSession } from "./useConstruct";

/**
 * The strip for the Construct tool (#265): the kind, what has been picked so far and what to pick next; once made, its
 * distance, angle or "along" value, then Done.
 */
export function ConstructBar({ x, error, scope, onCancel }: { x: ConstructSession; error?: string; scope?: Record<string, number>; onCancel: () => void }) {
  if (!x.info) return null;
  const v = x.info.value;
  const f = x.feature;
  const onFieldKey = (e: KeyboardEvent) => {
    if (e.key === "Enter") x.done();
  };
  return (
    <ArmedBar title={f?.name ?? x.info.label} icon={constructIcon(x.info.what)}>
      {x.picks.map((p, i) => (
        <span key={i} className="bc-armed-note">
          {p.text}
        </span>
      ))}
      {x.help && <span className="bc-armed-note">{x.help}</span>}
      {f && v && (
        <span className="bc-sk-fields" onKeyDown={onFieldKey}>
          <NumberField
            label={v.label}
            unit={v.unit}
            value={f.value}
            scope={scope}
            step={v.unit === "°" ? 5 : 1}
            min={v.unit === "%" ? 0 : undefined}
            max={v.unit === "%" ? 100 : undefined}
            onCommit={(n, expr) => x.setValue(n, expr)}
          />
        </span>
      )}
      {error && (
        <span className="bc-armed-note bc-armed-error" role="alert">
          {error}
        </span>
      )}
      <Button kind="cancel" label="Cancel" title={f ? `Take ${f.name} back` : "Put the tool down"} shortcut="Esc" onClick={f ? x.cancel : onCancel} />
      {f && <Button kind="done" label="Done" title={`Keep ${f.name}`} shortcut="Enter" onClick={x.done} />}
    </ArmedBar>
  );
}
