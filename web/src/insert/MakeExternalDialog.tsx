import { useEffect, useMemo, useState } from "react";
import { Banner, Button, Dialog } from "@bettercad/ui";
import { BCAD_EXT, saveBcad } from "@bettercad/kernel/bcad";
import { makeExternal } from "@bettercad/kernel/insert-model";
import type { Api, Folder, Place, Project } from "../cloud/api";
import { stripBlobs } from "../cloud/cloudDoc";
import type { FileStore } from "../files/fileStore";
import type { ModelDoc, ModelSource } from "../state/document";

export interface MakeExternalDialogProps {
  api: Api;
  /** The component (a link step) to make external. */
  id: string;
  store: { get(): ModelDoc; edit(fn: (d: ModelDoc) => ModelDoc, label: string): void };
  signedIn: boolean;
  /** Where Sign in goes, when accounts can be reached here. */
  signinUrl?: string;
  /** The open model's id in your account, when it is saved there: the new model goes beside it. */
  modelId?: string;
  files: Pick<FileStore, "saveAs">;
  say: (text: string) => void;
  onClose: () => void;
}

/** The first of "Wheel", "Wheel 2", "Wheel 3"… that no model in `taken` has (case aside). */
export function freeName(name: string, taken: readonly string[]): string {
  const used = new Set(taken.map((n) => n.trim().toLowerCase()));
  let out = name;
  for (let n = 2; used.has(out.toLowerCase()); n += 1) out = `${name} ${n}`;
  return out;
}

/** Where the open model lives, for the new one to go beside it, and what that place is called. */
async function placeOf(api: Api, modelId?: string): Promise<{ place: Place; label: string; names: string[] }> {
  let place: Place = {};
  if (modelId) {
    const m = await api.get(modelId);
    place = { folder_id: m.folder_id ?? null, project_id: m.project_id ?? null };
  }
  let label = "My models";
  if (place.folder_id || place.project_id) {
    const { folders, projects } = await api.call<{ folders: Folder[]; projects: Project[] }>("GET", "places");
    const folder = folders.find((f) => f.id === place.folder_id);
    const project = projects.find((p) => p.id === (place.project_id ?? folder?.project_id));
    label = folder ? (project ? `${folder.name} in ${project.name}` : folder.name) : (project?.name ?? label);
  }
  const { models } = await api.list(place.folder_id ? { folder: place.folder_id } : place.project_id ? { project: place.project_id } : { top: true });
  return { place, label, names: models.filter((m) => !m.deleted_at).map((m) => m.name) };
}

/**
 * Make external (Fusion's): saves a component as a model of its own, beside this one in My models, and puts it back
 * here as a linked insert of that model. Signed out, it can be saved as a file and linked to that instead.
 */
export function MakeExternalDialog({ api, id, store, signedIn, signinUrl, modelId, files, say, onClose }: MakeExternalDialogProps) {
  const plan = useMemo(() => makeExternal(store.get(), id), [store, id]);
  const component = typeof plan === "string" ? "" : plan.model.name;
  const [where, setWhere] = useState<{ place: Place; label: string; names: string[] } | null>(null);
  const [name, setName] = useState(component);
  const [problem, setProblem] = useState<string | null>(typeof plan === "string" ? plan : null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!signedIn || typeof plan === "string") return;
    let gone = false;
    placeOf(api, modelId).then(
      (w) => {
        if (gone) return;
        setWhere(w);
        setName((n) => (n === component ? freeName(component, w.names) : n));
      },
      (e: Error) => !gone && setProblem(e.message),
    );
    return () => {
      gone = true;
    };
  }, [api, signedIn, modelId, plan, component]);

  const trimmed = name.trim();
  const clash = !!where && where.names.some((n) => n.trim().toLowerCase() === trimmed.toLowerCase());
  const ready = typeof plan !== "string" && !!trimmed && !busy && (!signedIn || (!!where && !clash));

  /** Swaps the component for an insert of what was just saved, from the model as it is now. */
  const link = (source: ModelSource) => {
    const now = makeExternal(store.get(), id);
    if (typeof now === "string") return setProblem(now);
    store.edit(() => now.link(source), `Make ${now.model.name} external`);
    onClose();
    return true;
  };

  const save = async () => {
    if (!ready || typeof plan === "string") return;
    setBusy(true);
    setProblem(null);
    const model = { ...plan.model, name: trimmed };
    try {
      if (signedIn && where) {
        const text = saveBcad(await stripBlobs(api, model));
        const made = await api.create(trimmed, text, `Made external from ${store.get().name}`, where.place);
        if (link({ kind: "account", id: made.id, version: made.version, name: made.name }))
          say(`Saved ${made.name} to ${where.label} and linked it here. Open it there to change it, then Update brings the change in.`);
      } else {
        const saved = await files.saveAs(saveBcad(model), trimmed);
        if (!saved) return;
        if (link({ kind: "file", name: trimmed })) say(`Saved ${trimmed} as a file and linked it here.`);
      }
    } catch (e) {
      setProblem((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const signedOut = !signedIn && typeof plan !== "string";
  return (
    <Dialog
      open
      modal
      title="Make external"
      icon="link"
      width={440}
      onCancel={onClose}
      onDone={() => void save()}
      footer={
        <>
          <span className="bc-grow" />
          <Button kind="cancel" label={typeof plan === "string" ? "Close" : "Cancel"} shortcut="Esc" onClick={onClose} />
          {typeof plan !== "string" && (
            <Button
              kind="done"
              label={signedIn ? "Save and link" : "Save as a file"}
              shortcut="Enter"
              busy={busy}
              disabled={!ready}
              title={clash ? "Pick a name no other model here has" : undefined}
              onClick={() => void save()}
            />
          )}
        </>
      }
    >
      {problem && <Banner tone="danger">{problem}</Banner>}
      {typeof plan !== "string" && (
        <>
          <p className="bc-note">
            {signedIn
              ? `${component} becomes a model of its own in ${where?.label ?? "My models"}, with its ${plan.steps === 1 ? "step" : `${plan.steps} steps`}. Here it stays where it is, linked to that model, joints and all.`
              : `Sign in to save ${component} to My models and link it here, or save it as a ${BCAD_EXT} file and link that.`}{" "}
            {signedOut && signinUrl && <a href={signinUrl}>Sign in</a>}
          </p>
          <label className="bc-dialog-field">
            <span>Name</span>
            <input
              className="bc-text"
              autoFocus
              value={name}
              aria-invalid={clash || undefined}
              aria-describedby={clash ? "bc-external-clash" : undefined}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          {clash && (
            <p className="bc-note" id="bc-external-clash" role="alert">
              A model called {trimmed} is already there. Pick another name.
            </p>
          )}
          {signedIn && !where && !problem && <p className="bc-note">Finding where this model lives…</p>}
        </>
      )}
    </Dialog>
  );
}
