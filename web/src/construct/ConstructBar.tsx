import { FeaturePanel, NumberField, PanelNote } from "@bettercad/ui";
import { constructIcon } from "../editor/Timeline";
import type { ConstructSession } from "./useConstruct";

/**
 * The panel for the Construct tool (#265): the kind, what has been picked so far and what to pick next; once made, its
 * distance, angle or "along" value, then OK.
 */
export function ConstructBar({ x, error, scope, onCancel }: { x: ConstructSession; error?: string; scope?: Record<string, number>; onCancel: () => void }) {
  if (!x.info) return null;
  const v = x.info.value;
  const f = x.feature;
  return (
    <FeaturePanel
      title={f?.name ?? x.info.label}
      icon={constructIcon(x.info.what)}
      onFieldEnter={() => x.done()}
      cancel={{ title: f ? `Take ${f.name} back` : "Put the tool down", onClick: f ? x.cancel : onCancel }}
      ok={f ? { title: `Keep ${f.name}`, onClick: x.done } : undefined}
    >
      {x.picks.map((p, i) => (
        <PanelNote key={i}>{p.text}</PanelNote>
      ))}
      {x.help && <PanelNote>{x.help}</PanelNote>}
      {f && v && (
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
      )}
      {error && <PanelNote tone="error">{error}</PanelNote>}
    </FeaturePanel>
  );
}
