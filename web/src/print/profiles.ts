import { useCallback, useEffect, useState } from "react";
import { readProfile, type PrinterProfile } from "../state/document";
import type { Account, Api } from "../cloud/api";

/**
 * Printer profiles (#180) kept in this browser and, when signed in, in the account. The browser copy means they work
 * offline and without an account; signing in merges the two, so a profile made on one machine shows on the next.
 */
const KEY = "bettercad.printers";

export function loadLocal(): PrinterProfile[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown;
    return Array.isArray(raw) ? raw.map(readProfile).filter((p): p is PrinterProfile => !!p) : [];
  } catch {
    return [];
  }
}

export function saveLocal(list: PrinterProfile[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Private windows and full storage: the profiles still live for this session and in the account.
  }
}

const dataOf = ({ id: _id, name: _name, modified: _m, ...data }: PrinterProfile) => data as Record<string, unknown>;

/** The account's profiles and this browser's, by id; the account's copy wins when both have one. */
export function merge(local: PrinterProfile[], remote: PrinterProfile[]): PrinterProfile[] {
  const byId = new Map(local.map((p) => [p.id, p]));
  for (const p of remote) byId.set(p.id, p);
  return [...byId.values()];
}

export const newProfileId = () => `pr_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;

export interface Profiles {
  profiles: PrinterProfile[];
  save: (p: PrinterProfile) => void;
  remove: (id: string) => void;
}

export function usePrinterProfiles(api: Api, account: Account | null): Profiles {
  const [profiles, setProfiles] = useState<PrinterProfile[]>(loadLocal);

  useEffect(() => {
    if (!account) return;
    let live = true;
    api
      .printers()
      .then(async (r) => {
        const remote = r.printers.map(readProfile).filter((p): p is PrinterProfile => !!p);
        const local = loadLocal();
        // Profiles made in this browser before signing in go up to the account.
        const ids = new Set(remote.map((p) => p.id));
        await Promise.all(local.filter((p) => !ids.has(p.id)).map((p) => api.savePrinter(p.id, p.name, dataOf(p)).catch(() => null)));
        if (!live) return;
        const list = merge(local, remote);
        saveLocal(list);
        setProfiles(list);
      })
      .catch(() => {
        // Offline or no server: the browser's copy stands.
      });
    return () => {
      live = false;
    };
  }, [api, account]);

  const save = useCallback(
    (p: PrinterProfile) => {
      setProfiles((list) => {
        const next = list.some((x) => x.id === p.id) ? list.map((x) => (x.id === p.id ? p : x)) : [...list, p];
        saveLocal(next);
        return next;
      });
      if (account) api.savePrinter(p.id, p.name, dataOf(p)).catch(() => null);
    },
    [api, account],
  );

  const remove = useCallback(
    (id: string) => {
      setProfiles((list) => {
        const next = list.filter((x) => x.id !== id);
        saveLocal(next);
        return next;
      });
      if (account) api.deletePrinter(id).catch(() => null);
    },
    [api, account],
  );

  return { profiles, save, remove };
}
