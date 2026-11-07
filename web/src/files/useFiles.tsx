import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Banner, Button, Dialog, type MenuEntry } from "@bettercad/ui";
import { BcadError, fileName, loadBcad, nameFromFile, saveBcad } from "@bettercad/kernel/bcad";
import { newDoc, newId, type ModelDoc } from "../state/document";
import type { View3DHandle } from "../viewport/View3D";
import { ago, createAutosave, recoverable, type Autosave, type AutosaveRecord } from "./autosave";
import { createFileStore, type FileHandle, type FileStore, type Opened, type Recent } from "./fileStore";

/**
 * The model's life on disk (#79, #83, #84): Open, Save, Save as and Recent files, the unsaved dot in the title,
 * autosave to the browser and the Recover banner.
 */
export interface FilesDeps {
  store: {
    get(): ModelDoc;
    edit(fn: (d: ModelDoc) => ModelDoc, label: string, coalesceKey?: string): void;
  };
  doc: ModelDoc;
  view: RefObject<View3DHandle>;
  say: (text: string, bad?: boolean, quiet?: boolean) => void;
  /** A different model is open: reset the marker and the selection. */
  onSwitched: () => void;
  /** For tests. */
  fileStore?: FileStore;
  autosave?: Autosave;
}

const MB = 1024 * 1024;

/** The next frame, so the thumbnail is rendered after the click has painted. */
const nextFrame = () => new Promise<void>((r) => (typeof requestAnimationFrame === "undefined" ? setTimeout(r, 0) : requestAnimationFrame(() => r())));

export function useFiles(d: FilesDeps) {
  const deps = useRef(d);
  deps.current = d;
  const { store, doc } = d;
  const [files] = useState(() => d.fileStore ?? createFileStore());
  const [auto] = useState(() => d.autosave ?? createAutosave({ onWrite: () => deps.current.say("Autosaved", false, true) }));

  // Which model this is: kept in the file's header so autosave and Recent files recognise it.
  const meta = useRef<{ id: string; created?: string; handle?: FileHandle; file: string | null; savedAt: number | null }>({
    id: newId("m"),
    file: null,
    savedAt: null,
  });
  const [baseline, setBaseline] = useState<ModelDoc | null>(() => store.get());
  const dirty = doc !== baseline;
  const [recover, setRecover] = useState<AutosaveRecord[]>([]);
  const [recent, setRecent] = useState<Recent[]>([]);
  const [askNew, setAskNew] = useState(false);
  const warnedStorage = useRef(false);

  const refreshRecent = useCallback(() => {
    files.recent().then(setRecent, () => undefined);
  }, [files]);

  // On the first visit, autosaves of models that were never saved, or changed after their last save.
  useEffect(() => {
    let gone = false;
    auto.list().then(
      (all) => !gone && setRecover(recoverable(all, null)),
      () => undefined,
    );
    refreshRecent();
    return () => {
      gone = true;
    };
  }, [auto, refreshRecent]);

  // Autosave every change, 3 seconds after they stop.
  useEffect(() => {
    if (!dirty) return;
    const m = meta.current;
    const now = doc;
    auto.schedule(() => ({ id: m.id, name: now.name, json: saveBcad(now, { id: m.id, created: m.created }), savedAt: m.savedAt, source: m.file }));
    if (!warnedStorage.current && typeof navigator !== "undefined" && navigator.storage?.estimate) {
      warnedStorage.current = true;
      navigator.storage.estimate().then(
        (e) => {
          if (e.quota !== undefined && e.usage !== undefined && e.quota - e.usage < 50 * MB) {
            deps.current.say("Your browser is low on storage, so autosave may stop. Save to disk to be safe.", true);
          }
        },
        () => undefined,
      );
    }
  }, [doc, dirty, auto]);

  // Write at once when the page is hidden or closed; ask before closing with unsaved changes.
  const dirtyNow = useRef(dirty);
  dirtyNow.current = dirty;
  useEffect(() => {
    const flush = () => void auto.flush();
    const hidden = () => document.visibilityState === "hidden" && flush();
    const unload = (e: BeforeUnloadEvent) => {
      flush();
      if (dirtyNow.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", unload);
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", unload);
    };
  }, [auto]);

  // The tab title shows a dot while there are unsaved changes.
  useEffect(() => {
    document.title = `${dirty ? "• " : ""}${doc.name} · BetterCad`;
  }, [dirty, doc.name]);

  const thumbnail = useCallback(async () => {
    await nextFrame();
    return deps.current.view.current?.engine()?.thumbnail() ?? undefined;
  }, []);

  const write = useCallback(
    async (as: boolean) => {
      const m = meta.current;
      await auto.flush();
      let current = store.get();
      const thumb = await thumbnail();
      const text = (x: ModelDoc) => saveBcad(x, { id: m.id, created: m.created ?? new Date().toISOString(), thumbnail: thumb });
      try {
        let saved = as ? await files.saveAs(text(current), fileName(current.name)) : await files.save(text(current), fileName(current.name), m.handle);
        if (!saved) return false;
        // Save as names the model after the file.
        const named = nameFromFile(saved.name);
        if (saved.inPlace && saved.handle && named !== current.name) {
          store.edit((x) => ({ ...x, name: named }), "Rename model");
          current = store.get();
          saved = (await files.save(text(current), saved.name, saved.handle)) ?? saved;
        }
        m.created ??= new Date().toISOString();
        m.handle = saved.handle;
        m.file = saved.name;
        m.savedAt = Date.now();
        setBaseline(current);
        await auto.markSaved(m.id, m.savedAt, saved.name);
        if (saved.handle) await files.remember(saved.handle, { name: saved.name, thumbnail: thumb }).catch(() => undefined);
        refreshRecent();
        deps.current.say(saved.inPlace ? `Saved to ${saved.name}` : `Downloaded ${saved.name}. Your browser can't save in place.`);
        return true;
      } catch (e) {
        deps.current.say((e as Error).message || "That didn't save.", true);
        return false;
      }
    },
    [auto, files, store, thumbnail, refreshRecent],
  );

  const save = useCallback(() => write(false), [write]);
  const saveAs = useCallback(() => write(true), [write]);

  /** Shows a model that was just read from a file. */
  const show = useCallback(
    async (opened: Opened) => {
      const r = loadBcad(await opened.file.text());
      if (r instanceof BcadError) {
        deps.current.say(r.message, true);
        return false;
      }
      await auto.flush();
      auto.cancel();
      const id = r.meta.id ?? newId("m");
      meta.current = { id, created: r.meta.created, handle: opened.handle, file: opened.name, savedAt: Date.now() };
      store.edit(() => r.doc, `Open ${r.doc.name}`);
      setBaseline(r.doc);
      deps.current.onSwitched();
      if (opened.handle) await files.remember(opened.handle, { name: opened.name, thumbnail: r.meta.thumbnail }).catch(() => undefined);
      refreshRecent();
      // An autosave of this model newer than the file: offer it.
      const fileTime = Date.parse(r.meta.modified) || 0;
      const a = await auto.get(id).catch(() => undefined);
      setRecover((list) => {
        const rest = list.filter((x) => x.id !== id);
        return a && a.modified > fileTime + 1000 && (a.savedAt === null || a.modified > a.savedAt) ? [a, ...rest] : rest;
      });
      deps.current.say(r.warning ?? `Opened ${opened.name}`, !!r.warning);
      return true;
    },
    [auto, files, store, refreshRecent],
  );

  const open = useCallback(async () => {
    try {
      const opened = await files.open();
      if (opened) await show(opened);
    } catch (e) {
      deps.current.say((e as Error).message || "That file didn't open.", true);
    }
  }, [files, show]);

  const openRecent = useCallback(
    async (id: string) => {
      try {
        await show(await files.openRecent(id));
      } catch (e) {
        deps.current.say((e as Error).message, true);
        refreshRecent();
      }
    },
    [files, show, refreshRecent],
  );

  const startNew = useCallback(async () => {
    setAskNew(false);
    await auto.flush();
    auto.cancel();
    const fresh = newDoc();
    meta.current = { id: newId("m"), file: null, savedAt: null };
    store.edit(() => fresh, "New model");
    setBaseline(fresh);
    deps.current.onSwitched();
  }, [auto, store]);

  const newModel = useCallback(() => {
    if (dirtyNow.current) setAskNew(true);
    else void startNew();
  }, [startNew]);

  const recoverOne = useCallback(
    (rec: AutosaveRecord) => {
      const r = loadBcad(rec.json);
      if (r instanceof BcadError) {
        deps.current.say(r.message, true);
        return;
      }
      auto.cancel();
      meta.current = { id: rec.id, created: r.meta.created, file: rec.source, savedAt: rec.savedAt };
      store.edit(() => r.doc, `Recover ${rec.name}`);
      // Recovered work is not in a file yet.
      setBaseline(null);
      setRecover((l) => l.filter((x) => x.id !== rec.id));
      deps.current.onSwitched();
      deps.current.say(`Recovered ${rec.name}. Save it to keep it in a file.`);
    },
    [auto, store],
  );

  const discardOne = useCallback(
    (rec: AutosaveRecord) => {
      void auto.discard(rec.id);
      setRecover((l) => l.filter((x) => x.id !== rec.id));
    },
    [auto],
  );

  const banners = recover.length ? (
    <div className="bc-recover">
      {recover.slice(0, 3).map((r) => (
        <Banner
          key={r.id}
          tone="warn"
          action={
            <span className="bc-actions">
              <Button size="dense" label="Recover" title={`Open what was autosaved of ${r.name}`} onClick={() => recoverOne(r)} />
              <Button size="dense" label="Discard" title="Forget this autosave" onClick={() => discardOne(r)} />
            </span>
          }
        >
          Recover ‘{r.name}’ from {ago(Date.now() - r.modified)}
        </Banner>
      ))}
    </div>
  ) : null;

  const dialog = askNew ? (
    <Dialog
      open
      title={`Save changes to ${doc.name}?`}
      icon="save"
      onCancel={() => setAskNew(false)}
      footer={
        <>
          <Button kind="cancel" label="Cancel" onClick={() => setAskNew(false)} />
          <Button label="Don't save" onClick={() => void startNew()} />
          <Button
            variant="primary"
            label="Save"
            onClick={async () => {
              if (await save()) await startNew();
            }}
          />
        </>
      }
    >
      <p>Your changes to {doc.name} aren't in a file yet. Autosave keeps a copy in this browser either way.</p>
    </Dialog>
  ) : null;

  const recentEntries = useMemo<MenuEntry[]>(
    () =>
      recent.length
        ? [
            { kind: "title", id: "recent", label: "Recent files" },
            ...recent.slice(0, 5).map((r) => ({ id: `recent:${r.id}`, label: r.name, icon: "folder" as const, onSelect: () => void openRecent(r.id) })),
          ]
        : [],
    [recent, openRecent],
  );

  return { save, saveAs, open, openRecent, newModel, dirty, banners, dialog, recentEntries, inPlace: files.kind === "disk", show, store: files };
}

export type Files = ReturnType<typeof useFiles>;
