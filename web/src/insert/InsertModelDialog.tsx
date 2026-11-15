import { useEffect, useRef, useState } from "react";
import { Banner, Button, Dialog, Icon } from "@bettercad/ui";
import { BCAD_EXT, BcadError, loadBcad, nameFromFile } from "@bettercad/kernel/bcad";
import type { Api, ModelSummary } from "../cloud/api";
import { fillBlobs } from "../cloud/cloudDoc";
import { insertModel } from "@bettercad/kernel/insert-model";
import { build, insertedId, type ModelDoc, type ModelSource } from "../state/document";
import type { Placeable } from "../catalogue/usePlacePart";

/** A model picked to insert: where it came from, and the model itself with its files. */
export interface PickedModel {
  source: ModelSource;
  doc: ModelDoc;
}

/** A picked model as something to place: an Insert model step, its bodies selected once it's in. */
export function modelItem({ source, doc }: PickedModel): Placeable {
  const bodies = build(doc).parts.map((p) => p.id);
  return {
    id: `model:${source.kind === "account" ? source.id : source.name}`,
    name: source.name,
    step: true,
    put: (d, place, id, at) => insertModel(d, source, doc, place, id, at),
    selects: (id) => bodies.map((b) => insertedId(id, b)),
    done: `Inserted ${source.name} as a component. Use Joint to connect it.`,
  };
}

export interface InsertModelDialogProps {
  api: Api;
  signedIn: boolean;
  /** The model open now, which can't go inside itself. */
  current?: string;
  onPick: (m: Placeable) => void;
  onCancel: () => void;
}

/**
 * Insert model (#484): your saved models with their pictures and a search, or a .bcad file. Picking one reads it,
 * with its imported files, ready to place.
 */
export function InsertModelDialog({ api, signedIn, current, onPick, onCancel }: InsertModelDialogProps) {
  const [q, setQ] = useState("");
  const [models, setModels] = useState<ModelSummary[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!signedIn) return;
    let gone = false;
    const t = setTimeout(
      () =>
        api.list({ q: q.trim() || undefined, sort: "modified" }).then(
          (r) => !gone && setModels(r.models.filter((m) => m.id !== current && !m.deleted_at)),
          (e: Error) => !gone && setProblem(e.message),
        ),
      q ? 200 : 0,
    );
    return () => {
      gone = true;
      clearTimeout(t);
    };
  }, [api, signedIn, q, current]);

  const read = (text: string): ModelDoc | null => {
    const r = loadBcad(text);
    if (r instanceof BcadError) {
      setProblem(r.message);
      return null;
    }
    return r.doc;
  };

  const pickSaved = async (m: ModelSummary) => {
    setBusy(m.id);
    setProblem(null);
    try {
      const got = await api.get(m.id);
      const doc = read(got.bcad);
      if (doc)
        onPick(
          modelItem({ source: { kind: "account", id: m.id, version: got.version, name: got.name }, doc: await fillBlobs(api, { ...doc, name: got.name }) }),
        );
    } catch (e) {
      setProblem((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const pickFile = async (f: File) => {
    setProblem(null);
    const doc = read(await f.text());
    const name = nameFromFile(f.name);
    if (doc) onPick(modelItem({ source: { kind: "file", name }, doc: { ...doc, name } }));
  };

  return (
    <Dialog
      open
      title="Insert model"
      icon="insertModel"
      width={560}
      onCancel={onCancel}
      footer={
        <>
          <Button label="From a file…" icon="upload" title={`Insert a ${BCAD_EXT} file from your computer`} onClick={() => file.current?.click()} />
          <span className="bc-grow" />
          <Button kind="cancel" label="Cancel" shortcut="Esc" onClick={onCancel} />
        </>
      }
    >
      <input
        ref={file}
        type="file"
        accept={`${BCAD_EXT},application/json`}
        hidden
        aria-label="BetterCad file to insert"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void pickFile(f);
        }}
      />
      <p className="bc-note">Pick a model, then click a face or the ground to place it. It comes in as one component you can joint.</p>
      {problem && <Banner tone="danger">{problem}</Banner>}
      {!signedIn ? (
        <p className="bc-note">Sign in to insert models from My models. You can still insert a {BCAD_EXT} file.</p>
      ) : (
        <>
          <input
            className="bc-text"
            type="search"
            aria-label="Search your models"
            placeholder="Search your models"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {models === null ? (
            !problem && <p className="bc-note">Finding your models…</p>
          ) : models.length === 0 ? (
            <p className="bc-note">{q ? "No models match that." : "No other saved models yet. Save one to your account and it shows here."}</p>
          ) : (
            <div className="bc-model-tiles" role="list" aria-label="Your models">
              {models.map((m) => (
                <div role="listitem" key={m.id}>
                  <button
                    type="button"
                    className="bc-model-tile"
                    aria-label={`Insert ${m.name}`}
                    aria-busy={busy === m.id}
                    disabled={!!busy}
                    onClick={() => void pickSaved(m)}
                  >
                    <span className="bc-thumb">
                      {m.thumbnail ? <img src={api.url(m.thumbnail)} alt="" loading="lazy" /> : <Icon name="component" size={28} />}
                    </span>
                    <span className="bc-model-tile-name">{m.name}</span>
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Dialog>
  );
}
