import { useEffect, useState } from "react";
import { Button, Dialog } from "@bettercad/ui";
import type { Part } from "../state/document";

export function RenameDialog({ part, onClose, onRename }: { part: Part | null; onClose: () => void; onRename: (name: string) => void }) {
  const [name, setName] = useState("");
  useEffect(() => setName(part?.name ?? ""), [part]);
  return (
    <Dialog
      open={!!part}
      onClose={onClose}
      title="Rename part"
      icon="pencil"
      width={340}
      footer={
        <>
          <Button kind="cancel" label="Cancel" onClick={onClose} />
          <Button kind="done" label="Done" onClick={() => onRename(name)} />
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onRename(name);
        }}
      >
        <label className="bc-namebox">
          Name
          <input className="bc-text" value={name} onChange={(e) => setName(e.currentTarget.value)} />
        </label>
      </form>
    </Dialog>
  );
}
