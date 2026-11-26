import type { ImportFile, Imported } from "../kicad/import";
import { simpleBody } from "../library/body";
import { checkPinMap } from "../library/pack";
import { componentOf, libraryIn } from "./library";
import { kid, parseXml } from "./xml";

const stem = (file: string) => file.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "");

/**
 * Turns Eagle libraries (`.lbr`) into components (#665): each device set is a component, and each of its devices
 * that has a package is one of the packages it comes in. SparkFun and Adafruit publish their parts this way, and
 * Fusion Electronics exports it. What could not be read or paired is in `notes`.
 */
export function importEagleLibraries(files: ImportFile[], source: { licence: string; library?: string }): Imported {
  const out: Imported = { parts: [], found: { symbols: 0, footprints: 0 }, notes: [] };
  for (const f of files) {
    try {
      if (!/<eagle[\s>]/.test(f.text.slice(0, 4000))) {
        out.notes.push({
          name: f.name,
          why: /^\s*</.test(f.text)
            ? "Not an Eagle library"
            : "It was saved by an Eagle older than 6, which is not XML. Open and save it in a newer Eagle first",
        });
        continue;
      }
      const el = kid(kid(parseXml(f.text), "drawing"), "library");
      if (!el) {
        out.notes.push({ name: f.name, why: "An Eagle schematic or board, not a library. Open it from Open project" });
        continue;
      }
      const lib = libraryIn(el, undefined, el.attrs.name || stem(f.name));
      out.found.symbols += lib.symbols.size;
      out.found.footprints += lib.packages.size;
      const used = new Set<string>();
      for (const name of lib.sets.keys()) {
        const comp = componentOf(lib, name, { licence: source.licence, library: source.library ?? lib.name });
        if (!comp) continue;
        if (comp.supply) {
          out.notes.push({ name, why: "A power symbol. BetterCad has its own, so it was left out" });
          continue;
        }
        if (!comp.def.symbol.pins.length) {
          out.notes.push({ name, why: "It has no pins (a frame or a mark), so it was left out" });
          continue;
        }
        for (const pkg of comp.def.packages) {
          used.add(pkg.footprint.name);
          const model = simpleBody(comp.def.name, pkg.footprint);
          if (model) pkg.model = model;
        }
        for (const missing of comp.missing) out.notes.push({ name, why: `Its package ${missing} is not in the library, so that choice was left out` });
        // A package that leaves a pin with no pad is not a choice for this part.
        for (const bad of checkPinMap(comp.def)) {
          const n = bad.missing.length;
          out.notes.push({ name, why: `${bad.package} has no pad for ${n > 4 ? `${n} pins` : `pin ${bad.missing.join(", ")}`}, so that choice was left out` });
          comp.def.packages = comp.def.packages.filter((k) => k.footprint.name !== bad.package);
        }
        if (!comp.def.packages.length) out.notes.push({ name, why: "It has no package that fits its pins, so it came in with no footprint" });
        out.parts.push(comp.def);
      }
      for (const name of lib.packages.keys()) if (!used.has(name)) out.notes.push({ name, why: "No device here uses this package, so it was left out" });
    } catch (e) {
      out.notes.push({ name: f.name, why: e instanceof Error ? e.message : "It could not be read" });
    }
  }
  return out;
}
