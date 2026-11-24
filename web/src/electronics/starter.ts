import { BASICS, packOf, type LibraryPack } from "@bettercad/electronics";
import url from "@bettercad/electronics/library/starter.json?url";

let asked: Promise<LibraryPack> | null = null;

/**
 * The starter library (#624): one file of a couple of hundred parts, fetched the first time the Components panel
 * opens and kept by the service worker after that, so it is there offline.
 */
export function loadStarter(): Promise<LibraryPack> {
  asked ??= fetch(url)
    .then((r) => {
      if (!r.ok) throw new Error(`The parts library did not load (${r.status}).`);
      return r.json() as Promise<LibraryPack>;
    })
    .catch((e: unknown) => {
      asked = null;
      throw e;
    });
  return asked;
}

/** The few parts built into the app, as a pack: what the panel shows when the library cannot be fetched. */
export function basicsPack(): LibraryPack {
  return packOf(
    "BetterCad basics",
    "MIT",
    [{ name: "BetterCad basics", licence: "MIT", url: "https://bettercad.kevsrobots.com" }],
    Object.entries(BASICS).map(([id, make]) => {
      const def = make();
      return {
        id,
        name: def.name,
        category: def.symbol.power ? "Power symbols" : "Basics",
        ...(def.description ? { description: def.description } : {}),
        prefix: def.prefix,
        ...(def.value ? { value: def.value } : {}),
        ...(def.keywords ? { keywords: def.keywords } : {}),
        from: 0,
        def,
      };
    }),
  );
}
