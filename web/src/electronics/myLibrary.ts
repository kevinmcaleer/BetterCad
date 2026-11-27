import { useCallback, useEffect, useRef, useState } from "react";
import { dropPart, emptyPack, freeId, isPack, mergePacks, putPart, type ComponentDef, type LibraryPack } from "@bettercad/electronics";
import type { OwnBlock } from "@bettercad/electronics/ownBlocks";

/**
 * Your own parts (#629): components you made or imported, as a library pack. Kept in this browser and, when you are
 * signed in, in your account, the way drawing templates are, so they work offline and follow you to the next machine.
 * `removed` lists parts and blocks you deleted, so one deleted here does not come back from another machine. Your
 * blocks (#772) ride in the pack as `blocks`, so the account keeps them with the parts.
 */
export interface MyLibrary {
  pack: LibraryPack;
  removed: string[];
  blocks?: OwnBlock[];
}

const KEY = "bettercad.electronics.library";
export const MY_PARTS = "Your parts";
const fresh = (): MyLibrary => ({ pack: emptyPack(MY_PARTS), removed: [] });

export function readLibrary(raw: unknown): MyLibrary | null {
  const v = raw as Partial<MyLibrary> | null;
  if (!v || !isPack(v.pack)) return null;
  const { blocks: inPack, ...pack } = v.pack as LibraryPack & { blocks?: OwnBlock[] };
  const blocks = [...(Array.isArray(v.blocks) ? v.blocks : []), ...(Array.isArray(inPack) ? inPack : [])].filter((b) => b && b.spec && b.defs);
  return {
    pack: pack as LibraryPack,
    removed: Array.isArray(v.removed) ? v.removed.filter((x): x is string => typeof x === "string") : [],
    ...(blocks.length ? { blocks: newest(blocks) } : {}),
  };
}

/** One of each block, its newest version; on a tie the later one in the list. */
function newest(blocks: OwnBlock[]): OwnBlock[] {
  const by = new Map<string, OwnBlock>();
  for (const b of blocks) if ((by.get(b.spec.id)?.spec.version ?? -1) <= b.spec.version) by.set(b.spec.id, b);
  return [...by.values()];
}

/** What the account stores: the pack, with your blocks inside it. */
const forAccount = (lib: MyLibrary) => ({ pack: lib.blocks?.length ? { ...lib.pack, blocks: lib.blocks } : lib.pack, removed: lib.removed });

export function loadLocal(): MyLibrary {
  try {
    return readLibrary(JSON.parse(localStorage.getItem(KEY) ?? "null")) ?? fresh();
  } catch {
    return fresh();
  }
}

/** False when the browser would not keep it (a private window, or storage is full). */
export function saveLocal(lib: MyLibrary): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(lib));
    return true;
  } catch {
    return false;
  }
}

/** This browser's library and the account's, as one: the account's copy of a part wins, and deleted parts stay deleted. */
export function merge(local: MyLibrary, remote: MyLibrary): MyLibrary {
  const removed = [...new Set([...local.removed, ...remote.removed])];
  let pack = mergePacks(local.pack, remote.pack, { replace: true }).pack;
  for (const id of removed) if (pack.parts.some((p) => p.id === id)) pack = dropPart(pack, id);
  const blocks = newest([...(local.blocks ?? []), ...(remote.blocks ?? [])]).filter((b) => !removed.includes(b.spec.id));
  return { pack, removed, ...(blocks.length ? { blocks } : {}) };
}

/** The part of the account's API the library needs: any call, signed as the rest are. */
export interface LibraryApi {
  call<T>(method: string, path: string, body?: unknown): Promise<T>;
}

export interface MyParts {
  pack: LibraryPack;
  /** Saves a component as a part: a new one, or over the part with that id. Returns its id. */
  save: (def: ComponentDef, shelf: string, id?: string) => string;
  remove: (id: string) => void;
  /** Adds every part of another library. Returns how many came in. */
  add: (from: LibraryPack) => number;
  /** False when this browser would not keep the last change. */
  kept: boolean;
  /** Your blocks (#772). */
  blocks: OwnBlock[];
  /** Saves a block: a new one, or a newer version of one already here. */
  saveBlock: (b: OwnBlock) => void;
  removeBlock: (id: string) => void;
}

// One library for every panel that shows it, so a block saved from the inspector is on the Blocks shelf at once.
let shared: MyLibrary | null = null;
const listeners = new Set<(lib: MyLibrary) => void>();

export function useMyLibrary(api?: LibraryApi, signedIn = false): MyParts {
  const [lib, setLib] = useState<MyLibrary>(() => (shared ??= loadLocal()));
  const [kept, setKept] = useState(true);
  const account = signedIn ? api : undefined;
  const now = useRef(lib);
  now.current = lib;

  useEffect(() => {
    listeners.add(setLib);
    if (shared && shared !== now.current) setLib(shared);
    return () => {
      listeners.delete(setLib);
      // With no panel showing it, the next one reads this browser's copy again.
      if (!listeners.size) shared = null;
    };
  }, []);
  const share = (next: MyLibrary) => {
    now.current = next;
    shared = next;
    for (const l of listeners) l(next);
  };

  const commit = useCallback(
    (next: MyLibrary) => {
      share(next);
      setKept(saveLocal(next));
      account?.call("PUT", "parts-library", forAccount(next)).catch(() => null);
    },
    [account],
  );

  useEffect(() => {
    if (!account) return;
    let live = true;
    account
      .call<unknown>("GET", "parts-library")
      .then((r) => {
        if (!live) return;
        const remote = readLibrary(r);
        const local = now.current;
        const merged = remote ? merge(local, remote) : local;
        share(merged);
        saveLocal(merged);
        // Parts made in this browser before signing in go up to the account.
        if (JSON.stringify(merged) !== JSON.stringify(remote)) account.call("PUT", "parts-library", forAccount(merged)).catch(() => null);
      })
      .catch(() => {
        // Offline or no server: the browser's copy stands.
      });
    return () => {
      live = false;
    };
  }, [account]);

  const save = useCallback(
    (def: ComponentDef, shelf: string, id?: string) => {
      const { pack, removed } = now.current;
      const as = id ?? freeId(pack, def.name);
      commit({ ...now.current, pack: putPart(pack, as, def, shelf || MY_PARTS), removed: removed.filter((x) => x !== as) });
      return as;
    },
    [commit],
  );
  const remove = useCallback(
    (id: string) => {
      const { pack, removed } = now.current;
      commit({ ...now.current, pack: dropPart(pack, id), removed: [...new Set([...removed, id])] });
    },
    [commit],
  );
  const add = useCallback(
    (from: LibraryPack) => {
      const { pack, removed } = now.current;
      const merged = mergePacks(pack, from);
      const ids = new Set(merged.pack.parts.map((p) => p.id));
      commit({ ...now.current, pack: merged.pack, removed: removed.filter((x) => !ids.has(x)) });
      return merged.added;
    },
    [commit],
  );
  const saveBlock = useCallback(
    (b: OwnBlock) => {
      const { blocks = [], removed } = now.current;
      commit({ ...now.current, blocks: [...blocks.filter((x) => x.spec.id !== b.spec.id), b], removed: removed.filter((x) => x !== b.spec.id) });
    },
    [commit],
  );
  const removeBlock = useCallback(
    (id: string) => {
      const { blocks = [], removed } = now.current;
      commit({ ...now.current, blocks: blocks.filter((x) => x.spec.id !== id), removed: [...new Set([...removed, id])] });
    },
    [commit],
  );

  return { pack: lib.pack, save, remove, add, kept, blocks: lib.blocks ?? [], saveBlock, removeBlock };
}

/**
 * The library as a file to keep or pass on: the pack itself, with every part's source and licence inside, and under
 * `files` the STEP files its parts' bodies come from (#628), so the file is whole on its own.
 */
export function libraryFile(pack: LibraryPack, files: Record<string, string> = {}): Blob {
  const whole = Object.keys(files).length ? { ...pack, files } : pack;
  return new Blob([`${JSON.stringify(whole, null, 1)}\n`], { type: "application/json" });
}
