import { useEffect, useState } from "react";
import { emptyPack, isPack, putPart, type ComponentDef, type LibraryPack } from "@bettercad/electronics";
import { toBase64 } from "@bettercad/kernel";
import { fileOf, keepFile, stepFiles } from "./partBlobs";

/**
 * The shared parts catalogue (#625, #629): parts other people published from their libraries, found by the server.
 * A published part is live at once, marked unreviewed until an admin has checked it.
 */
export type ShareStatus = "unreviewed" | "approved" | "rejected";

export interface SharedPart {
  id: number;
  name: string;
  licence: string;
  credit: string;
  /** Who published it. */
  by: string;
  status: ShareStatus;
  /** A library pack holding the one part. */
  pack: LibraryPack;
}

/** The licences a part can be published under: ones that let other people use it. The server has the same list. */
export const PUBLISH_LICENCES = ["CC0 1.0 (no rights kept)", "CC-BY 4.0", "CC-BY-SA 4.0", "CC-BY-SA 4.0 with the KiCad libraries exception", "MIT"];

/** The part of the account's API these calls need. */
export interface PartsApi {
  call<T>(method: string, path: string, body?: unknown): Promise<T>;
  url(path: string): string;
}

const sane = (v: unknown): SharedPart[] =>
  (Array.isArray((v as { parts?: unknown })?.parts) ? (v as { parts: SharedPart[] }).parts : []).filter(
    (p) => p && typeof p.id === "number" && isPack(p.pack) && p.pack.parts.length === 1,
  );

/**
 * Parts from the shared catalogue that match what is typed. It asks once typing pauses, and only for two letters or
 * more, so the starter set answers first and offline nothing is lost. `offline`: the server did not answer.
 */
export function useSharedParts(api: PartsApi | undefined, find: string, wait = 300): { parts: SharedPart[]; offline: boolean } {
  const [got, setGot] = useState<{ q: string; parts: SharedPart[]; offline: boolean }>({ q: "", parts: [], offline: false });
  const q = find.trim().toLowerCase();
  useEffect(() => {
    if (!api || q.length < 2) return;
    let live = true;
    const t = setTimeout(() => {
      api.call<unknown>("GET", `parts-catalogue?q=${encodeURIComponent(q)}`).then(
        (r) => live && setGot({ q, parts: sane(r), offline: false }),
        () => live && setGot({ q, parts: [], offline: true }),
      );
    }, wait);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [api, q, wait]);
  return q.length >= 2 && got.q === q ? got : { parts: [], offline: false };
}

/** A pack holding one part as it is published: under the licence chosen, credited to whoever it came from. */
export function publishPack(id: string, def: ComponentDef, category: string, licence: string, credit: string): LibraryPack {
  const source = { ...def.source, library: credit, licence };
  return putPart(emptyPack("Published"), id, { ...def, source }, category);
}

/** Whose name goes on a published part: where it came from, or you when you drew it. */
export const creditOf = (def: ComponentDef, you: string): string => (def.source?.library && def.source.library !== "You" ? def.source.library : you);

/** The token in a link to someone's library, or in the token on its own. */
export function shareToken(text: string): string | null {
  const t = text.trim();
  return /parts-library\/shared\/([A-Za-z0-9_-]{10,40})/.exec(t)?.[1] ?? (/^[A-Za-z0-9_-]{10,40}$/.test(t) ? t : null);
}

/** The link to a library: an address that answers with the library itself, which Add from a link reads. */
export const shareLink = (api: PartsApi, token: string): string => new URL(api.url(`parts-library/shared/${token}`), window.location.href).href;

/** Fetches the files a set of parts' 3D bodies need (#628) from where the parts came from, and keeps them here. */
export async function fetchPartFiles(api: PartsApi, from: string, defs: Iterable<ComponentDef>, f: typeof fetch = fetch): Promise<void> {
  await Promise.all(
    stepFiles(defs)
      .filter((h) => !fileOf(h))
      .map(async (h) => {
        try {
          const r = await f(api.url(`${from}/blobs/${h}`), { credentials: "same-origin" });
          if (r.ok) keepFile(h, toBase64(new Uint8Array(await r.arrayBuffer())));
        } catch {
          // Offline: the part still places, with a box for its body.
        }
      }),
  );
}
