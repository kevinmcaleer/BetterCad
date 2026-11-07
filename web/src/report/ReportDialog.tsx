import { useEffect, useState } from "react";
import { Banner, Button, Dialog } from "@bettercad/ui";
import { infoText, reportZip, sendReport, type ReportBody, type ReportInfo } from "./report";

/**
 * Help > Report a problem (#109). The person says what happened and chooses whether to attach the model; everything
 * else that goes is listed in the dialog before they send it. If it can't be sent, it can be downloaded as a .zip.
 */
export interface ReportDialogProps {
  open: boolean;
  onClose: () => void;
  /** The open model as .bcad text, or null when there's nothing to attach. */
  model: () => string | null;
  info: () => ReportInfo;
  /** An error the app caught, to start the description with. */
  prefill?: string;
  say: (text: string) => void;
  /** For tests. */
  send?: typeof sendReport;
}

export function ReportDialog(p: ReportDialogProps) {
  const [description, setDescription] = useState("");
  const [attach, setAttach] = useState(true);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [info, setInfo] = useState<ReportInfo | null>(null);
  const { open, prefill } = p;

  useEffect(() => {
    if (!open) return;
    setDescription(prefill ? `\n\n${prefill}` : "");
    setAttach(true);
    setFailed(null);
    setBusy(false);
    setInfo(p.info());
    // The collected info is read once, when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, prefill]);

  if (!open || !info) return null;
  const model = p.model();
  const body = (): ReportBody => ({ description, model: attach ? model : null, info });

  const send = async () => {
    setBusy(true);
    setFailed(null);
    const r = await (p.send ?? sendReport)(body());
    setBusy(false);
    if (r.ok) {
      p.say(`Sent. Report ${r.id}`);
      p.onClose();
    } else setFailed(r.error);
  };

  const download = () => {
    const blob = new Blob([reportZip(body())], { type: "application/zip" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bettercad-report-${new Date().toISOString().slice(0, 10)}.zip`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    p.say("Saved the report. Attach the .zip to a bug report on GitHub.");
  };

  return (
    <Dialog
      open
      modal
      title="Report a problem"
      icon="warning"
      width={480}
      onCancel={p.onClose}
      footer={
        <>
          {failed && <Button label="Download the report" title="Save it as a .zip to attach to a bug report" onClick={download} />}
          <span className="bc-grow" />
          <Button label="Cancel" onClick={p.onClose} />
          <Button variant="primary" label={busy ? "Sending…" : "Send"} disabled={busy} onClick={() => void send()} />
        </>
      }
    >
      <label className="bc-field-label" htmlFor="bc-report-what">
        What happened
      </label>
      <textarea
        id="bc-report-what"
        className="bc-text bc-report-what"
        rows={5}
        value={description}
        placeholder="What were you doing when it went wrong?"
        onChange={(e) => setDescription(e.target.value)}
      />
      <label className="bc-check">
        <input type="checkbox" checked={attach && !!model} disabled={!model} onChange={(e) => setAttach(e.target.checked)} />
        <span>{model ? "Attach my model" : "Attach my model (nothing is open)"}</span>
      </label>
      {attach && model && <p className="bc-note bc-micro">Your model goes with the report, so Kev can see what went wrong. It isn't shared anywhere else.</p>}
      <details className="bc-report-info">
        <summary>What else is sent</summary>
        <pre>{infoText(info)}</pre>
      </details>
      <p className="bc-note bc-micro">
        Only what's listed here is sent, and only when you press Send. See the <a href="#/privacy">privacy page</a>. For a question, try the kevsrobots Discord
        instead.
      </p>
      {failed && <Banner tone="warn">{failed} You can download the report and attach it to a bug report on GitHub instead.</Banner>}
    </Dialog>
  );
}
