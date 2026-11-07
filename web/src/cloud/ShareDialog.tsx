import { useEffect, useState } from "react";
import { Button, Dialog } from "@bettercad/ui";
import type { Api } from "./api";

/** Share a model with a view-only link (#92). The link opens /view/<token>, which previews and then shows the model. */
export interface ShareDialogProps {
  api: Api;
  modelId: string;
  name: string;
  onClose: () => void;
  say: (text: string, bad?: boolean) => void;
}

export const shareLink = (token: string, origin = window.location.origin) => `${origin}/view/${token}`;

export function ShareDialog(p: ShareDialogProps) {
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { api, modelId } = p;

  useEffect(() => {
    let gone = false;
    api.share(modelId).then(
      (r) => !gone && setLink(shareLink(r.token)),
      (e: Error) => !gone && setError(e.message),
    );
    return () => {
      gone = true;
    };
  }, [api, modelId]);

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      p.say("Link copied");
    } catch {
      p.say("Your browser didn't let the link be copied. Select it and copy it instead.", true);
    }
  };

  const revoke = async () => {
    try {
      await api.unshare(modelId);
      p.say("The link is off. Anyone who has it sees that it isn't active.");
      p.onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Dialog
      open
      title={`Share ${p.name}`}
      icon="share"
      onCancel={p.onClose}
      width={460}
      footer={
        <>
          <Button variant="danger" label="Turn off the link" disabled={!link} onClick={() => void revoke()} />
          <span className="bc-grow" />
          <Button kind="cancel" label="Close" onClick={p.onClose} />
        </>
      }
    >
      {error ? (
        <p className="bc-page-error" role="alert">
          {error}
        </p>
      ) : (
        <>
          <label className="bc-field-label" htmlFor="bc-share-link">
            Link
          </label>
          <span className="bc-version-note-row">
            <input id="bc-share-link" className="bc-text" readOnly value={link ?? "Making the link…"} onFocus={(e) => e.target.select()} />
            <Button size="dense" icon="copy" label="Copy" disabled={!link} onClick={() => void copy()} />
          </span>
          <p className="bc-note">Anyone with the link can view the model, measure it and download it. They can&rsquo;t change yours.</p>
        </>
      )}
    </Dialog>
  );
}
