import { useCallback, useEffect, useRef, useState } from "react";
import { dropPart, emptyPack, freeId, isPack, mergePacks, putPart, type ComponentDef, type LibraryPack } from "@bettercad/electronics";

/**
 * Your own parts (#629): components you made or imported, as a library pack. Kept in this browser and, when you are
 * signed in, in your account, the way drawing templates are, so they work offline and follow you to the next machine.
 * `removed` lists parts you deleted, so one deleted here does not come back from another machine.
 */
export interface MyLibrary {
  pack: LibraryPack;
  removed: string[];
}

const KEY = "bettercad.electronics.library";
export const MY_PARTS = "Your parts";
const fresh = (): MyLibrary => ({ pack: emptyPack(MY_PARTS), removed: [] });

export function readLibrary(raw: unknown): MyLibrary | null {
  const v = raw as Partial<MyLibrary> | null;
  if (!v || !isPack(v.pack)) return null;
  return { pack: v.pack, removed: Array.isArray(v.removed) ? v.removed.filter((x): x is string => typeof x === "string") : [] };
}

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
  return { pack, removed };
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
}

export function useMyLibrary(api?: LibraryApi, signedIn = false): MyParts {
  const [lib, setLib] = useState<MyLibrary>(loadLocal);
  const [kept, setKept] = useState(true);
  const account = signedIn ? api : undefined;
  const now = useRef(lib);
  now.current = lib;

  const commit = useCallback(
    (next: MyLibrary) => {
      now.current = next;
      setKept(saveLocal(next));
      setLib(next);
      account?.call("PUT", "parts-library", next).catch(() => null);
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
        now.current = merged;
        saveLocal(merged);
        setLib(merged);
        // Parts made in this browser before signing in go up to the account.
        if (JSON.stringify(merged) !== JSON.stringify(remote)) account.call("PUT", "parts-library", merged).catch(() => null);
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
      commit({ pack: putPart(pack, as, def, shelf || MY_PARTS), removed: removed.filter((x) => x !== as) });
      return as;
    },
    [commit],
  );
  const remove = useCallback(
    (id: string) => {
      const { pack, removed } = now.current;
      commit({ pack: dropPart(pack, id), removed: [...new Set([...removed, id])] });
    },
    [commit],
  );
  const add = useCallback(
    (from: LibraryPack) => {
      const { pack, removed } = now.current;
      const merged = mergePacks(pack, from);
      const ids = new Set(merged.pack.parts.map((p) => p.id));
      commit({ pack: merged.pack, removed: removed.filter((x) => !ids.has(x)) });
      return merged.added;
    },
    [commit],
  );

  return { pack: lib.pack, save, remove, add, kept };
}

/**
 * The library as a file to keep or pass on: the pack itself, with every part's source and licence inside, and under
 * `files` the STEP files its parts' bodies come from (#628), so the file is whole on its own.
 */
export function libraryFile(pack: LibraryPack, files: Record<string, string> = {}): Blob {
  const whole = Object.keys(files).length ? { ...pack, files } : pack;
  return new Blob([`${JSON.stringify(whole, null, 1)}\n`], { type: "application/json" });
}
