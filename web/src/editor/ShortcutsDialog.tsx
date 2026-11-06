import { Dialog } from "@bettercad/ui";
import { formatCombo, type Command } from "../state/commands";

/** Every command that has a key, grouped. Read-only in v1. */
export function ShortcutsDialog({ open, onClose, commands }: { open: boolean; onClose: () => void; commands: Command[] }) {
  const groups = new Map<string, Command[]>();
  for (const c of commands) if (c.keys?.length) groups.set(c.group, [...(groups.get(c.group) ?? []), c]);
  return (
    <Dialog open={open} modal onCancel={onClose} onDone={onClose} title="Keyboard shortcuts" icon="keyboard" footer={null}>
      {[...groups].map(([group, list]) => (
        <section key={group}>
          <h3 className="bc-panel-title">{group}</h3>
          <dl className="bc-shortcuts">
            {list.map((c) => (
              <div key={c.id}>
                <dt>{c.label}</dt>
                <dd>
                  {c.keys!.map((k) => (
                    <kbd key={k}>{formatCombo(k)}</kbd>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
      <p className="bc-note">Esc backs out one step at a time: a menu, then the tool, then the selection.</p>
    </Dialog>
  );
}
