import { useEffect, useState } from "react";
import { Button, Dialog } from "@bettercad/ui";
import type { Call, Methods } from "@bettercad/kernel";
import type { ModelDoc } from "../state/document";
import { editorUrl, kevsrobots, titleProblem, type Kevsrobots, type KrLink, type KrProject } from "./kevsrobots";

/**
 * Send to kevsrobots: draws the build steps (with an STL of each part) and sends them to one of your kevsrobots
 * projects, or a new one. They wait there until you open the project and import them. The model remembers the
 * project, so the next send is an update.
 */
export interface SendDialogProps {
  doc: ModelDoc;
  upTo: number;
  call: <M extends keyof Methods>(method: M, params: Methods[M]["params"]) => Call<Methods[M]["result"]> | null;
  /** Signed in with a kevsrobots account. */
  signedIn: boolean;
  signinUrl?: string;
  /** Where the model opens in BetterCad, when it is saved to your account. */
  modelUrl?: string;
  onLinked: (link: KrLink) => void;
  onClose: () => void;
  say: (text: string, bad?: boolean) => void;
  /** Tests pass a stand-in. */
  client?: Kevsrobots;
}

const NEW = "new";

export function SendDialog(p: SendDialogProps) {
  const [client] = useState(() => p.client ?? kevsrobots());
  const linked = p.doc.kevsrobots;
  const [projects, setProjects] = useState<KrProject[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState<string>(linked ? String(linked.project) : NEW);
  const [title, setTitle] = useState(p.doc.name || "");
  const [busy, setBusy] = useState<string | null>(null);
  const [sent, setSent] = useState<{ project: number; title: string; update: boolean } | null>(null);

  useEffect(() => {
    if (!p.signedIn) return;
    let gone = false;
    client.projects().then(
      (list) => {
        if (gone) return;
        setProjects(list);
        // A linked project that has gone: start a new one instead.
        if (linked && !list.some((x) => x.id === linked.project)) setPick(list.length ? String(list[0]!.id) : NEW);
        else if (!linked && list.length && !title.trim()) setPick(String(list[0]!.id));
      },
      (e: Error) => !gone && setError(e.message),
    );
    return () => {
      gone = true;
    };
    // Once, when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, p.signedIn]);

  const isNew = pick === NEW;
  const problem = isNew ? titleProblem(title) : null;
  const update = !!linked && pick === String(linked.project);

  const send = async () => {
    if (busy || problem) return;
    setError(null);
    try {
      setBusy("Drawing the build steps…");
      const { exportSteps } = await import("./exportSteps");
      const made = await exportSteps({ doc: p.doc, upTo: p.upTo, call: p.call, parts: true, onProgress: (_, text) => setBusy(`${text}…`) });
      let project: KrProject | undefined;
      if (isNew) {
        setBusy("Making the project…");
        project = await client.create(title);
        // Picked from now on, so trying again sends to it rather than making another.
        const made = project;
        setProjects((list) => [made, ...(list ?? [])]);
        setPick(String(made.id));
      } else project = projects?.find((x) => String(x.id) === pick);
      if (!project) throw new Error("Pick a project to send to.");
      setBusy("Sending…");
      const r = await client.send(project.id, made.name, made.bytes, p.modelUrl);
      p.onLinked({ project: project.id, title: project.title, sent: new Date().toISOString() });
      setSent({ project: project.id, title: project.title, update: r.is_update });
      p.say(`Sent ${made.steps === 1 ? "1 step" : `${made.steps} steps`} to ${project.title} on kevsrobots`);
    } catch (e) {
      setError((e as { message?: string })?.message ?? "The build steps didn't send.");
    } finally {
      setBusy(null);
    }
  };

  const footer = sent ? (
    <>
      <span className="bc-grow" />
      <Button kind="cancel" label="Close" onClick={p.onClose} />
      <Button variant="primary" label="Open the project" onClick={() => window.open(editorUrl(sent.project), "_blank", "noopener")} />
    </>
  ) : (
    <>
      <span className="bc-grow" />
      <Button kind="cancel" label="Cancel" onClick={p.onClose} />
      <Button
        variant="primary"
        label={update ? "Update" : "Send"}
        disabled={!p.signedIn || !!busy || !!problem || (!isNew && !projects)}
        onClick={() => void send()}
      />
    </>
  );

  return (
    <Dialog
      open
      modal
      title={(sent ? sent.update : update) ? "Update on kevsrobots" : "Send to kevsrobots"}
      icon="upload"
      onCancel={p.onClose}
      width={460}
      footer={footer}
      busy={!!busy}
    >
      {!p.signedIn ? (
        <p className="bc-note">
          Sign in with your kevsrobots account to send this model to one of your projects. {p.signinUrl && <a href={p.signinUrl}>Sign in</a>}
        </p>
      ) : sent ? (
        <p className="bc-note" role="status">
          {sent.update ? "The update is" : "The model and its build steps are"} waiting in {sent.title}. Open the project on kevsrobots and choose{" "}
          {sent.update ? "Update" : "Import"} to bring {sent.update ? "it" : "them"} into the page.
        </p>
      ) : (
        <>
          <p className="bc-note">
            Sends the build steps, their pictures, the model with its joints, and an STL of each part to print. They wait in the project until you import them
            there.
          </p>
          <label className="bc-field-label" htmlFor="bc-send-project">
            Project
          </label>
          <select id="bc-send-project" className="bc-select" value={pick} disabled={!projects || !!busy} onChange={(e) => setPick(e.target.value)}>
            {!projects && !error && <option value={pick}>Finding your projects…</option>}
            <option value={NEW}>New project</option>
            {projects?.map((x) => (
              <option key={x.id} value={String(x.id)}>
                {x.title}
                {linked?.project === x.id ? " (sent before)" : ""}
              </option>
            ))}
          </select>
          {isNew && (
            <>
              <label className="bc-field-label" htmlFor="bc-send-title">
                Project name
              </label>
              <input
                id="bc-send-title"
                className="bc-text"
                value={title}
                disabled={!!busy}
                aria-invalid={!!problem}
                aria-describedby={problem ? "bc-send-title-problem" : undefined}
                onChange={(e) => setTitle(e.target.value)}
              />
              {problem && (
                <p id="bc-send-title-problem" className="bc-note">
                  {problem}
                </p>
              )}
            </>
          )}
          {busy && (
            <p className="bc-note" role="status">
              {busy}
            </p>
          )}
        </>
      )}
      {error && (
        <p className="bc-page-error" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}
