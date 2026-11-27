import type { ElectronicsDesign, Sheet } from "@bettercad/electronics";
import { STARTER_VERSIONS } from "@bettercad/electronics/library/blockVersions";

const KEY = "bettercad.electronics.library";

/**
 * The newest version of every block this browser knows (#773): the starter blocks' and Your blocks'. Read straight
 * from storage, so the schematic can badge an old copy without loading Your library or the Blocks shelf.
 */
export function latestVersions(): Map<string, number> {
  const out = new Map(Object.entries(STARTER_VERSIONS));
  try {
    const lib = JSON.parse(localStorage.getItem(KEY) ?? "null") as { blocks?: { spec?: { id?: unknown; version?: unknown } }[] } | null;
    for (const b of lib?.blocks ?? [])
      if (typeof b?.spec?.id === "string" && typeof b.spec.version === "number") out.set(b.spec.id, Math.max(out.get(b.spec.id) ?? 0, b.spec.version));
  } catch {
    // Nothing kept, or storage is off: the starter blocks still count.
  }
  return out;
}

/** The groups on a sheet whose block has a newer version. */
export function staleBlocks(_d: ElectronicsDesign, sheet: Sheet, latest = latestVersions()): Set<string> {
  return new Set((sheet.groups ?? []).filter((g) => g.block && (latest.get(g.block.def) ?? 0) > g.block.version).map((g) => g.id));
}
