import { BCAD_EXT, BCAD_MIME } from "@bettercad/kernel/bcad";
import { idbKV, type KV } from "./idb";

/**
 * Open and save on disk (#83). Where the browser has the File System Access API (Chrome, Edge) files open and save
 * in place and are remembered in Recent files; elsewhere Open asks for a file and Save downloads one.
 */

/** The parts of the File System Access API we use (not yet in TypeScript's DOM types). */
export interface FileHandle {
  readonly kind: "file";
  readonly name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: BlobPart): Promise<void>; close(): Promise<void> }>;
  isSameEntry?(other: FileHandle): Promise<boolean>;
  queryPermission?(o: { mode: "read" | "readwrite" }): Promise<PermissionState>;
  requestPermission?(o: { mode: "read" | "readwrite" }): Promise<PermissionState>;
}

interface PickerType {
  description: string;
  accept: Record<string, string[]>;
}

export interface PickerWindow {
  showOpenFilePicker?(o: { types?: PickerType[]; multiple?: boolean; excludeAcceptAllOption?: boolean }): Promise<FileHandle[]>;
  showSaveFilePicker?(o: { suggestedName?: string; types?: PickerType[] }): Promise<FileHandle>;
}

export interface Opened {
  name: string;
  file: File;
  handle?: FileHandle;
}

export interface Saved {
  name: string;
  /** True when the file was written in place; false when it was downloaded. */
  inPlace: boolean;
  handle?: FileHandle;
}

export interface OutFile {
  name: string;
  /**
   * The bytes, or bytes still being made (a render): the browser only lets a page ask where to save straight after a
   * click, so the picker opens first and the file is written when its bytes arrive.
   */
  data: ArrayBuffer | Promise<ArrayBuffer>;
  mime: string;
}

export interface Recent {
  id: string;
  name: string;
  thumbnail?: string;
  date: number;
  handle: FileHandle;
}

export interface FileStore {
  readonly kind: "disk" | "download";
  /** Asks for a file. Undefined if the person cancels. */
  open(): Promise<Opened | undefined>;
  /** Writes to the handle if there is one, otherwise asks where (or downloads). Undefined if the person cancels. */
  save(text: string, name: string, handle?: FileHandle): Promise<Saved | undefined>;
  saveAs(text: string, name: string): Promise<Saved | undefined>;
  recent(): Promise<Recent[]>;
  openRecent(id: string): Promise<Opened>;
  /**
   * Writes exported files (#86): asks where where it can, otherwise downloads them. Several files go into one .zip
   * named `zipName`, because Chrome won't let a page pick Downloads or Documents as a folder. Undefined if the person
   * cancels.
   */
  saveFiles(files: OutFile[], zipName?: string): Promise<{ names: string[]; inPlace: boolean } | undefined>;
  /** Puts a file at the top of Recent files. */
  remember(handle: FileHandle, info: { name: string; thumbnail?: string }): Promise<void>;
}

export const OPEN_ACCEPT = [BCAD_EXT, ".json", ".stl", ".step", ".stp", ".3mf"];
const TYPES: PickerType[] = [{ description: "BetterCad model", accept: { [BCAD_MIME]: [BCAD_EXT], "application/json": [".json"] } }];
/** Open also takes files to import (#82). */
const OPEN_TYPES: PickerType[] = [
  {
    description: "BetterCad models, STL, STEP and 3MF",
    accept: { [BCAD_MIME]: [BCAD_EXT], "application/json": [".json"], "model/stl": [".stl"], "model/step": [".step", ".stp"], "model/3mf": [".3mf"] },
  },
];
const MAX_RECENT = 10;

const isAbort = (e: unknown) => (e as { name?: string })?.name === "AbortError";

export function createFileStore(win: PickerWindow & Window = window, recentKV: KV<Recent> = idbKV<Recent>("recent")): FileStore {
  return win.showSaveFilePicker && win.showOpenFilePicker ? diskStore(win, recentKV) : downloadStore(win);
}

const extOf = (name: string) => name.slice(name.lastIndexOf("."));

/**
 * Several files become one .zip, so they save with one ordinary save dialog (any folder, Downloads included) or one
 * download. The zip writer loads on first use.
 */
function bundle(files: OutFile[], zipName = "Export.zip"): OutFile[] {
  if (files.length < 2) return files;
  const data = Promise.all([import("@bettercad/kernel/zip"), ...files.map((f) => f.data)]).then(([{ zip }, ...bytes]) => {
    const out = zip(files.map((f, i) => ({ name: f.name, data: new Uint8Array(bytes[i] as ArrayBuffer) })));
    return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
  });
  return [{ name: zipName.endsWith(".zip") ? zipName : `${zipName}.zip`, data, mime: "application/zip" }];
}

function download(win: Window, data: BlobPart, name: string, mime: string) {
  const doc = win.document;
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  const a = doc.createElement("a");
  a.href = url;
  a.download = name;
  doc.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function diskStore(win: PickerWindow & Window, kv: KV<Recent>): FileStore {
  const write = async (handle: FileHandle, data: BlobPart, mime = BCAD_MIME) => {
    const w = await handle.createWritable();
    await w.write(new Blob([data], { type: mime }));
    await w.close();
  };
  const store: FileStore = {
    kind: "disk",
    async open() {
      try {
        const [handle] = await win.showOpenFilePicker!({ types: OPEN_TYPES });
        if (!handle) return undefined;
        return { name: handle.name, file: await handle.getFile(), handle };
      } catch (e) {
        if (isAbort(e)) return undefined;
        throw e;
      }
    },
    async save(text, name, handle) {
      if (!handle) return store.saveAs(text, name);
      if (handle.queryPermission && (await handle.queryPermission({ mode: "readwrite" })) !== "granted") {
        if ((await handle.requestPermission?.({ mode: "readwrite" })) !== "granted") throw new Error(`BetterCad needs your permission to save ${handle.name}.`);
      }
      await write(handle, text);
      return { name: handle.name, inPlace: true, handle };
    },
    async saveAs(text, name) {
      let handle: FileHandle;
      try {
        handle = await win.showSaveFilePicker!({ suggestedName: name, types: TYPES });
      } catch (e) {
        if (isAbort(e)) return undefined;
        throw e;
      }
      await write(handle, text);
      return { name: handle.name, inPlace: true, handle };
    },
    async recent() {
      return (await kv.entries()).map(([, r]) => r).sort((a, b) => b.date - a.date);
    },
    async openRecent(id) {
      const r = await kv.get(id);
      if (!r) throw new Error("That file is no longer in your recent files.");
      const h = r.handle;
      if (h.queryPermission && (await h.queryPermission({ mode: "read" })) !== "granted") {
        if ((await h.requestPermission?.({ mode: "read" })) !== "granted") throw new Error(`BetterCad needs your permission to open ${r.name}.`);
      }
      try {
        const file = await h.getFile();
        await kv.set(id, { ...r, date: Date.now() });
        return { name: h.name, file, handle: h };
      } catch {
        await kv.del(id);
        throw new Error(`${h.name} has moved or been deleted.`);
      }
    },
    async saveFiles(files, zipName) {
      const f = bundle(files, zipName)[0];
      if (!f) return { names: [], inPlace: false };
      let handle: FileHandle;
      try {
        handle = await win.showSaveFilePicker!({ suggestedName: f.name, types: [{ description: f.name, accept: { [f.mime]: [extOf(f.name)] } }] });
      } catch (e) {
        if (isAbort(e)) return undefined;
        throw e;
      }
      await write(handle, await f.data, f.mime);
      return { names: [handle.name], inPlace: true };
    },
    async remember(handle, info) {
      const all = await store.recent();
      let id: string | undefined;
      for (const r of all) {
        if (r.handle === handle || (handle.isSameEntry && (await handle.isSameEntry(r.handle).catch(() => false)))) id = r.id;
      }
      id ??= `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      await kv.set(id, { id, name: info.name, thumbnail: info.thumbnail, date: Date.now(), handle });
      const after = await store.recent();
      for (const old of after.slice(MAX_RECENT)) await kv.del(old.id);
    },
  };
  return store;
}

function downloadStore(win: Window): FileStore {
  return {
    kind: "download",
    open() {
      return new Promise((resolve) => {
        const input = win.document.createElement("input");
        input.type = "file";
        input.accept = OPEN_ACCEPT.join(",");
        input.onchange = () => {
          const file = input.files?.[0];
          resolve(file ? { name: file.name, file } : undefined);
        };
        input.addEventListener("cancel", () => resolve(undefined));
        input.click();
      });
    },
    async save(text, name) {
      download(win, text, name, BCAD_MIME);
      return { name, inPlace: false };
    },
    async saveAs(text, name) {
      download(win, text, name, BCAD_MIME);
      return { name, inPlace: false };
    },
    async saveFiles(files, zipName) {
      const out = bundle(files, zipName);
      for (const f of out) download(win, await f.data, f.name, f.mime);
      return { names: out.map((f) => f.name), inPlace: false };
    },
    recent: async () => [],
    openRecent: async () => {
      throw new Error("Your browser can't reopen recent files.");
    },
    remember: async () => {},
  };
}
