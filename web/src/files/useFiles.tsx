import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Banner, Button, Dialog, type MenuEntry } from "@bettercad/ui";
import { BcadError, fileName, loadBcad, nameFromFile, saveBcad } from "@bettercad/kernel/bcad";
import { newDoc, newId, type ModelDoc, type Vec3 } from "../state/document";
import { importFormat, isBcad } from "@bettercad/kernel";
import type { View3DHandle } from "../viewport/View3D";
import { ago, createAutosave, recoverable, type Autosave, type AutosaveRecord } from "./autosave";
import { createFileStore, type FileHandle, type FileStore, type Opened, type Recent } from "./fileStore";
import { useAccount } from "../cloud/account";
import { ApiError, serverTime } from "../cloud/api";
import { fillBlobs, stripBlobs } from "../cloud/cloudDoc";
import { offline } from "../cloud/offline";
import type { Store } from "../state/store";
import { sampleUrl } from "../samples/samples";
import type { History } from "../state/history";

/** Where a model saved to an account stands (#90): shown by the cloud icon in the title. */
export type CloudState = "saved" | "saving" | "dirty" | "offline" | "error";
export const CLOUD_AUTOSAVE = 30_000;

/** Changes the address without a new history entry, and tells the router. */
function setRoute(hash: string) {
  if (window.location.hash === hash) return;
  window.history.replaceState(null, "", hash);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}
/** A model that isn't the saved one any more: the address goes back to the plain editor. */
const leaveCloudRoute = () => (window.location.hash.startsWith("#/edit/") || window.location.hash.startsWith("#/sample/")) && setRoute("#/");

/**
 * The model's life on disk (#79, #83, #84): Open, Save, Save as and Recent files, the unsaved dot in the title,
 * autosave to the browser and the Recover banner.
 */
export interface FilesDeps {
  store: Store<ModelDoc>;
  doc: ModelDoc;
  view: RefObject<View3DHandle>;
  say: (text: string, bad?: boolean, toast?: boolean) => void;
  /** A different model is open: reset the marker and the selection. */
  onSwitched: () => void;
  /** STL, STEP and 3MF files go into the open model (#82), standing at `at` (the origin if left out). */
  onImport: (files: File[], at?: Vec3) => Promise<void>;
  /** For tests. */
  fileStore?: FileStore;
  autosave?: Autosave;
}

const MB = 1024 * 1024;

const IDENTITY = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

/** The next frame, so the thumbnail is rendered after the click has painted. */
const nextFrame = () => new Promise<void>((r) => (typeof requestAnimationFrame === "undefined" ? setTimeout(r, 0) : requestAnimationFrame(() => r())));

export function useFiles(d: FilesDeps) {
  const deps = useRef(d);
  deps.current = d;
  const { store, doc } = d;
  const [files] = useState(() => d.fileStore ?? createFileStore());
  const [auto] = useState(() => d.autosave ?? createAutosave({ onWrite: () => deps.current.say("Autosaved", false, true) }));

  // Which model this is: kept in the file's header so autosave and Recent files recognise it.
  const meta = useRef<{
    id: string;
    created?: string;
    handle?: FileHandle;
    file: string | null;
    savedAt: number | null;
    /** Set when the model came from, or was saved to, an account. */
    cloud?: { modelId: string; version: number };
  }>({
    id: newId("m"),
    file: null,
    savedAt: null,
  });
  const [baseline, setBaseline] = useState<ModelDoc | null>(() => store.get());
  const baselineNow = useRef(baseline);
  baselineNow.current = baseline;
  // Looking at an old version (#91) or a shared model (#92): read-only, with what to go back to.
  const [viewing, setViewing] = useState<{ number: number; created: string; back: { history: History<ModelDoc>; baseline: ModelDoc | null } } | null>(null);
  const [shared, setShared] = useState<{ token: string; name: string; owner: string } | null>(null);
  const dirty = doc !== baseline;
  const [recover, setRecover] = useState<AutosaveRecord[]>([]);
  const [recent, setRecent] = useState<Recent[]>([]);
  // A step that would replace unsaved work, waiting for Save or Don't save.
  const [ask, setAsk] = useState<{ run: () => Promise<unknown> } | null>(null);
  const warnedStorage = useRef(false);
  /** Out of a read-only look, before another model opens. */
  const unlock = useCallback(() => {
    store.lock(null);
    setViewing(null);
    setShared(null);
  }, [store]);
  const { api, account } = useAccount();
  const signedIn = !!account;
  const [cloud, setCloud] = useState<{ modelId: string; state: CloudState } | null>(null);
  // Another tab saved first: Save anyway or Reload.
  const [conflict, setConflict] = useState(false);
  // A model that isn't in the account yet: what to call it.
  const [naming, setNaming] = useState<string | null>(null);

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
    // Framed from the default view, so a save made zoomed in or mid-sketch still shows the whole model (#272).
    const engine = deps.current.view.current?.engine();
    return (engine?.posed(IDENTITY, 320, 200) ?? engine?.thumbnail()) || undefined;
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
        if (saved.inPlace) deps.current.say(`Saved to ${saved.name}`, false, true);
        else deps.current.say(`Downloaded ${saved.name}. Your browser can't save in place.`);
        return true;
      } catch (e) {
        deps.current.say((e as Error).message || "That didn't save.", true);
        return false;
      }
    },
    [auto, files, store, thumbnail, refreshRecent],
  );

  /** Saves to the account as a new version (#90). `force` replaces whatever another tab saved. */
  const saveCloud = useCallback(
    async (o: { note?: string; force?: boolean; name?: string } = {}): Promise<boolean> => {
      const m = meta.current;
      if (!account) {
        deps.current.say("Sign in to save to your account", true);
        return false;
      }
      if (!m.cloud && o.name === undefined) {
        setNaming(store.get().name);
        return false;
      }
      if (o.name !== undefined && o.name !== store.get().name) store.edit((x) => ({ ...x, name: o.name! }), "Rename model");
      const current = store.get();
      const modelId = m.cloud?.modelId;
      setCloud({ modelId: modelId ?? "", state: "saving" });
      let text: string | null = null;
      try {
        await auto.flush();
        const thumb = await thumbnail();
        text = saveBcad(await stripBlobs(api, current), { id: m.id, created: m.created ?? new Date().toISOString(), thumbnail: thumb });
        if (!m.cloud) {
          const made = await api.create(current.name, text, o.note);
          m.cloud = { modelId: made.id, version: made.version };
          // The address now names the model, so a reload opens it again.
          setRoute(`#/edit/${made.id}`);
        } else {
          const r = await api.save(m.cloud.modelId, text, { note: o.note, name: current.name, ifMatch: o.force ? undefined : m.cloud.version });
          m.cloud = { ...m.cloud, version: r.version };
        }
        m.created ??= new Date().toISOString();
        m.savedAt = Date.now();
        setBaseline(current);
        await auto.markSaved(m.id, m.savedAt);
        setCloud({ modelId: m.cloud.modelId, state: "saved" });
        if (o.note !== "autosave") deps.current.say(`Saved ${current.name} to your account`, false, true);
        return true;
      } catch (e) {
        const err = e as ApiError;
        if (err.status === 409) {
          setCloud({ modelId: modelId ?? "", state: "error" });
          setConflict(true);
          return false;
        }
        setCloud({ modelId: modelId ?? "", state: err.status === 0 ? "offline" : "error" });
        // Offline (#96): the newest save of this model waits in the browser and goes when you're back.
        if (err.status === 0 && m.cloud && text) {
          await offline()
            .queue({ modelId: m.cloud.modelId, name: current.name, bcad: text, note: o.note, version: m.cloud.version, at: Date.now() })
            .catch(() => undefined);
          if (o.note !== "autosave") deps.current.say("You're offline. This save waits and goes when you're back.");
          return false;
        }
        deps.current.say(err.status === 0 ? "Not saved: you're offline. Autosave keeps a copy in this browser." : err.message, true);
        return false;
      }
    },
    [account, api, auto, store, thumbnail],
  );

  /** Ctrl+S: to the account when the model lives there and you're signed in, otherwise to disk. */
  const save = useCallback(() => {
    if (store.isLocked()) {
      deps.current.say(shared ? "Open a copy to change and save it" : "Restore this version, or go back, to save", true);
      return Promise.resolve(false);
    }
    return meta.current.cloud && signedIn ? saveCloud() : write(false);
  }, [saveCloud, signedIn, write, store, shared]);
  const saveAs = useCallback(() => write(true), [write]);

  /** Runs a step that replaces the model, asking first to save unsaved changes. */
  const confirmThen = useCallback((run: () => Promise<unknown>) => {
    if (dirtyNow.current) setAsk({ run });
    else void run();
  }, []);

  /** Shows a model that was just read from a file. */
  const load = useCallback(
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
      setCloud(null);
      leaveCloudRoute();
      unlock();
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
    [auto, files, store, refreshRecent, unlock],
  );

  /** A chosen file: a model opens (after asking about unsaved changes); a mesh or STEP file is imported. */
  const show = useCallback(
    async (opened: Opened) => {
      if (importFormat(opened.name)) return deps.current.onImport([opened.file]);
      confirmThen(() => load(opened));
    },
    [confirmThen, load],
  );

  /** Files dropped on the view or pasted (#85): one model to open, or meshes and STEP files to add at `at`. */
  const openFiles = useCallback(
    async (list: File[], at?: Vec3) => {
      const models = list.filter((f) => isBcad(f.name));
      const imports = list.filter((f) => importFormat(f.name));
      if (models.length + imports.length < list.length) return deps.current.say("BetterCad opens .bcad, .stl, .step and .3mf files", true);
      if (models.length > 1 || (models.length && imports.length)) return deps.current.say("Drop one BetterCad file at a time", true);
      if (models[0]) return confirmThen(() => load({ name: models[0]!.name, file: models[0]! }));
      await deps.current.onImport(imports, at);
    },
    [confirmThen, load],
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
    await auto.flush();
    auto.cancel();
    const fresh = newDoc();
    meta.current = { id: newId("m"), file: null, savedAt: null };
    setCloud(null);
    leaveCloudRoute();
    unlock();
    store.edit(() => fresh, "New model");
    setBaseline(fresh);
    deps.current.onSwitched();
  }, [auto, store, unlock]);

  const newModel = useCallback(() => confirmThen(startNew), [confirmThen, startNew]);

  /** A sample model (#99), opened as a new, unsaved model to pull apart (after asking about unsaved changes). */
  const openSample = useCallback(
    (id: string) =>
      confirmThen(async () => {
        try {
          const res = await fetch(sampleUrl(id));
          if (!res.ok) throw new Error();
          const r = loadBcad(await res.text());
          if (r instanceof BcadError) throw r;
          await auto.flush();
          auto.cancel();
          meta.current = { id: newId("m"), file: null, savedAt: null };
          setCloud(null);
          leaveCloudRoute();
          unlock();
          store.edit(() => r.doc, `Open ${r.doc.name}`);
          setBaseline(r.doc);
          deps.current.onSwitched();
          deps.current.say(`Opened the ${r.doc.name.toLowerCase()} sample. Change it in Parameters.`);
        } catch {
          leaveCloudRoute();
          deps.current.say("That sample didn't open. Check your connection and try again.", true);
        }
      }),
    [confirmThen, auto, store, unlock],
  );

  /** Opens a model saved to the account (#89, #90), after asking about unsaved changes. */
  const loadCloud = useCallback(
    async (modelId: string) => {
      deps.current.say("Opening…", false, true);
      try {
        let cached = false;
        const got = await api.get(modelId).then(
          (g) => {
            void offline().rememberModel(g);
            return g;
          },
          async (e: ApiError) => {
            const copy = e.status === 0 ? await offline().lastModel(modelId) : null;
            if (!copy) throw e;
            cached = true;
            return copy;
          },
        );
        const r = loadBcad(got.bcad);
        if (r instanceof BcadError) {
          deps.current.say(r.message, true);
          return false;
        }
        const docIn = await fillBlobs(api, { ...r.doc, name: got.name });
        await auto.flush();
        auto.cancel();
        meta.current = { id: r.meta.id ?? newId("m"), created: r.meta.created, file: null, savedAt: Date.now(), cloud: { modelId, version: got.version } };
        unlock();
        store.edit(() => docIn, `Open ${got.name}`);
        setBaseline(docIn);
        setCloud({ modelId, state: "saved" });
        setRecover((list) => list.filter((x) => x.id !== meta.current.id));
        deps.current.onSwitched();
        if (cached) setCloud({ modelId, state: "offline" });
        deps.current.say(r.warning ?? (cached ? `You're offline. ${got.name} is the copy from your last visit.` : `Opened ${got.name}`), !!r.warning);
        return true;
      } catch (e) {
        deps.current.say((e as Error).message, true);
        return false;
      }
    },
    [api, auto, store, unlock],
  );
  const openCloud = useCallback(
    (modelId: string) => {
      if (meta.current.cloud?.modelId === modelId) return;
      confirmThen(() => loadCloud(modelId));
    },
    [confirmThen, loadCloud],
  );

  // Cloud autosave: every 30 seconds while there are changes, as a version noted "autosave".
  const cloudOn = !!cloud && signedIn;
  useEffect(() => {
    if (!cloudOn || !dirty || conflict) return;
    setCloud((c) => (c && c.state === "saved" ? { ...c, state: "dirty" } : c));
    const t = setTimeout(() => void saveCloud({ note: "autosave" }), CLOUD_AUTOSAVE);
    return () => clearTimeout(t);
  }, [cloudOn, dirty, conflict, doc, saveCloud]);

  // Back online (#96): send the saves that waited, and say how it went.
  useEffect(() => {
    if (!signedIn) return;
    const run = async () => {
      const r = await offline().flush(api);
      const cur = meta.current.cloud;
      for (const x of r.saved) {
        if (cur && x.modelId === cur.modelId) {
          cur.version = x.version;
          setCloud({ modelId: cur.modelId, state: dirtyNow.current ? "dirty" : "saved" });
        }
      }
      if (r.saved.length) deps.current.say(`Saved ${r.saved.length} queued ${r.saved.length === 1 ? "change" : "changes"}`, false, true);
      for (const c of r.conflicts) {
        if (cur && c.modelId === cur.modelId) setConflict(true);
        else deps.current.say(`A waiting save of ${c.name} met a newer version. Open it to check.`, true);
      }
    };
    const online = () => void run();
    const visible = () => document.visibilityState === "visible" && navigator.onLine && void run();
    const gone = () => setCloud((c) => (c ? { ...c, state: "offline" } : c));
    window.addEventListener("online", online);
    window.addEventListener("offline", gone);
    document.addEventListener("visibilitychange", visible);
    if (navigator.onLine) void run();
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", gone);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [signedIn, api]);

  const recoverOne = useCallback(
    (rec: AutosaveRecord) => {
      const r = loadBcad(rec.json);
      if (r instanceof BcadError) {
        deps.current.say(r.message, true);
        return;
      }
      auto.cancel();
      meta.current = { id: rec.id, created: r.meta.created, file: rec.source, savedAt: rec.savedAt };
      setCloud(null);
      leaveCloudRoute();
      unlock();
      store.edit(() => r.doc, `Recover ${rec.name}`);
      // Recovered work is not in a file yet.
      setBaseline(null);
      setRecover((l) => l.filter((x) => x.id !== rec.id));
      deps.current.onSwitched();
      deps.current.say(`Recovered ${rec.name}. Save it to keep it in a file.`);
    },
    [auto, store, unlock],
  );

  const discardOne = useCallback(
    (rec: AutosaveRecord) => {
      void auto.discard(rec.id);
      setRecover((l) => l.filter((x) => x.id !== rec.id));
    },
    [auto],
  );

  /** Shows an old version read-only (#91), keeping the current one to come back to. */
  const previewVersion = useCallback(
    async (n: number) => {
      const modelId = meta.current.cloud?.modelId;
      if (!modelId) return;
      try {
        const v = await api.version(modelId, n);
        const r = loadBcad(v.bcad);
        if (r instanceof BcadError) return deps.current.say(r.message, true);
        const old = await fillBlobs(api, { ...r.doc, name: v.name });
        const back = viewing?.back ?? { history: store.history(), baseline: baselineNow.current };
        store.lock(null);
        store.edit(() => old, `Version ${n}`);
        store.lock(() => deps.current.say("This is an old version. Restore it to change it.", true));
        setBaseline(store.get());
        setViewing({ number: n, created: v.created, back });
        deps.current.onSwitched();
      } catch (e) {
        deps.current.say((e as Error).message, true);
      }
    },
    [api, store, viewing],
  );

  /** Back from an old version to the current one, as it was. */
  const backToCurrent = useCallback(() => {
    if (!viewing) return;
    store.lock(null);
    store.reset(viewing.back.history);
    setBaseline(viewing.back.baseline);
    setViewing(null);
    deps.current.onSwitched();
  }, [store, viewing]);

  /** Makes the version on show the newest one, as a copy, and carries on editing it. */
  const restoreViewed = useCallback(async () => {
    const modelId = meta.current.cloud?.modelId;
    if (!viewing || !modelId) return;
    try {
      await api.restoreVersion(modelId, viewing.number);
      store.lock(null);
      store.reset(viewing.back.history);
      setViewing(null);
      meta.current.cloud = undefined;
      await loadCloud(modelId);
      deps.current.say(`Restored version ${viewing.number}`);
    } catch (e) {
      deps.current.say((e as Error).message, true);
    }
  }, [api, store, viewing, loadCloud]);

  /** A share link (#92): the model read-only, rebuilt here from its recipe. */
  const openShared = useCallback(
    async (token: string) => {
      try {
        const got = await api.shared(token);
        const r = loadBcad(got.bcad);
        if (r instanceof BcadError) throw r;
        const docIn = await fillBlobs(api, { ...r.doc, name: got.name }, token);
        store.lock(null);
        store.edit(() => docIn, `Open ${got.name}`);
        store.lock(() => deps.current.say("Open a copy to change this model", true));
        setBaseline(store.get());
        setShared({ token, name: got.name, owner: got.owner });
        setCloud(null);
        deps.current.onSwitched();
        return true;
      } catch (e) {
        setShared(null);
        throw e;
      }
    },
    [api, store],
  );

  /** "Open a copy in BetterCad": the shared model becomes a new, unsaved local one. */
  const openCopy = useCallback(() => {
    store.lock(null);
    const name = `${store.get().name} (copy)`;
    meta.current = { id: newId("m"), file: null, savedAt: null };
    store.edit((d) => ({ ...d, name }), "Open a copy");
    setBaseline(null);
    setShared(null);
    setRoute("#/");
    deps.current.say(`Opened ${name}. Save it to keep it.`);
  }, [store]);

  /** Leaves a share link without a copy: back to a fresh model. */
  const leaveShared = useCallback(() => {
    if (!store.isLocked()) return;
    store.lock(null);
    setShared(null);
    setViewing(null);
    const fresh = newDoc();
    meta.current = { id: newId("m"), file: null, savedAt: null };
    store.edit(() => fresh, "New model");
    setBaseline(fresh);
    deps.current.onSwitched();
  }, [store]);

  const viewingBar = viewing ? (
    <div className="bc-recover bc-viewing">
      <Banner
        tone="warn"
        action={
          <span className="bc-actions">
            <Button size="dense" variant="primary" label="Restore" title="Make this the newest version" onClick={() => void restoreViewed()} />
            <Button size="dense" label="Back" title="Back to the current version" onClick={backToCurrent} />
          </span>
        }
      >
        Viewing version {viewing.number} from {new Date(serverTime(viewing.created)).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
      </Banner>
    </div>
  ) : null;

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

  const dialog = ask ? (
    <Dialog
      open
      title={`Save changes to ${doc.name}?`}
      icon="save"
      onCancel={() => setAsk(null)}
      footer={
        <>
          <Button kind="cancel" label="Cancel" onClick={() => setAsk(null)} />
          <Button
            label="Don't save"
            onClick={() => {
              setAsk(null);
              void ask.run();
            }}
          />
          <Button
            variant="primary"
            label="Save"
            onClick={async () => {
              setAsk(null);
              if (await save()) await ask.run();
            }}
          />
        </>
      }
    >
      <p>Your changes to {doc.name} aren't in a file yet. Autosave keeps a copy in this browser either way.</p>
    </Dialog>
  ) : null;

  const conflictDialog = conflict ? (
    <Dialog
      open
      title="This model changed in another tab"
      icon="cloud"
      onCancel={() => setConflict(false)}
      footer={
        <>
          <Button kind="cancel" label="Cancel" onClick={() => setConflict(false)} />
          <Button
            label="Reload"
            title="Open the version the other tab saved; your changes here are dropped"
            onClick={() => {
              setConflict(false);
              const id = meta.current.cloud?.modelId;
              if (id) {
                meta.current.cloud = undefined;
                void loadCloud(id);
              }
            }}
          />
          <Button
            variant="primary"
            label="Save anyway"
            title="Save this as the newest version"
            onClick={() => {
              setConflict(false);
              void saveCloud({ force: true });
            }}
          />
        </>
      }
    >
      <p>Another tab or computer saved {doc.name} after you opened it. Save anyway makes yours the newest version; the other one stays in the history.</p>
    </Dialog>
  ) : null;

  const namingDialog =
    naming !== null ? (
      <Dialog
        open
        title="Save to your account"
        icon="cloud"
        onCancel={() => setNaming(null)}
        doneLabel="Save"
        onDone={() => {
          const name = naming.trim() || doc.name;
          setNaming(null);
          void saveCloud({ name });
        }}
      >
        <label className="bc-field-label" htmlFor="bc-cloud-name">
          Name
        </label>
        <input id="bc-cloud-name" className="bc-text" autoFocus value={naming} onChange={(e) => setNaming(e.target.value)} onFocus={(e) => e.target.select()} />
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

  return {
    save,
    saveAs,
    saveToDisk: () => write(false),
    saveCloud,
    openCloud,
    cloud,
    confirmThen,
    open,
    openRecent,
    newModel,
    openSample,
    dirty,
    banners: (
      <>
        {viewingBar}
        {!viewing && !shared && banners}
      </>
    ),
    viewing,
    previewVersion,
    backToCurrent,
    shared,
    openShared,
    openCopy,
    leaveShared,
    dialog: (
      <>
        {dialog}
        {conflictDialog}
        {namingDialog}
      </>
    ),
    recentEntries,
    inPlace: files.kind === "disk",
    show,
    openFiles,
    store: files,
  };
}

export type Files = ReturnType<typeof useFiles>;
