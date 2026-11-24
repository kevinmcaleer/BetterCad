import { checkPinMap } from "../library/pack";
import { simpleBody } from "../library/body";
import type { ComponentDef, FootprintDef, SymbolDef } from "../model";
import { readKicadFootprint, type KicadFootprint } from "./footprint";
import { readKicadSymbols, type KicadSymbol } from "./symbol";

export interface ImportFile {
  name: string;
  text: string;
}

export interface Imported {
  /** Whole components, each with the file it came from and the licence it was imported under. */
  parts: ComponentDef[];
  /** What was read: how many symbols and footprints the files held. */
  found: { symbols: number; footprints: number };
  /** What was left out or needs a look, and why. */
  notes: { name: string; why: string }[];
}

const stem = (file: string) => file.replace(/^.*[\\/]/, "").replace(/\.(kicad_sym|kicad_mod)$/i, "");

/** Whether a footprint's name fits one of a symbol's footprint filters ("SOT?23*"). */
function fits(filters: string[], name: string): boolean {
  return filters.some((f) =>
    new RegExp(
      `^${f
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*")
        .replace(/\?/g, ".")}$`,
      "i",
    ).test(name),
  );
}

/**
 * KiCad writes several pads on one pin as a stacked number, "[1,2,11,36-38]". Here that is one pin, numbered by the
 * first, with a pin map that sends it to every pad.
 */
export function unstack(symbol: SymbolDef): { symbol: SymbolDef; pinMap: Record<string, string[]> } {
  const pinMap: Record<string, string[]> = {};
  const pins = symbol.pins.map((pin) => {
    const m = /^\[(.+)\]$/.exec(pin.number);
    if (!m) return pin;
    const pads = m[1]!.split(",").flatMap((part) => {
      const range = /^(\d+)-(\d+)$/.exec(part.trim());
      if (!range) return [part.trim()];
      const from = Number(range[1]);
      const to = Number(range[2]);
      return to >= from && to - from < 500 ? Array.from({ length: to - from + 1 }, (_, i) => String(from + i)) : [part.trim()];
    });
    if (!pads[0]) return pin;
    pinMap[pads[0]] = pads;
    return { ...pin, number: pads[0] };
  });
  return { symbol: { ...symbol, pins }, pinMap };
}

/**
 * Turns KiCad library files into components (#623): `.kicad_sym` symbol libraries and `.kicad_mod` footprints, from
 * KiCad itself, a manufacturer or a site that exports KiCad format. A symbol is paired with the footprint its own
 * footprint field names when that footprint is among the files; failing that, with the one its filters fit, or, when it
 * names none, with the only footprint there is. A footprint that is not among the files can come from `known` (the starter library's,
 * by KiCad name). Nothing is guessed beyond that: what could not be paired or read is in `notes`.
 */
export function importKicad(files: ImportFile[], source: { licence: string; library?: string }, known?: (name: string) => FootprintDef | undefined): Imported {
  const out: Imported = { parts: [], found: { symbols: 0, footprints: 0 }, notes: [] };
  const symbols: { sym: KicadSymbol; file: string }[] = [];
  const footprints = new Map<string, { fp: KicadFootprint; file: string; used: boolean }>();
  for (const f of files) {
    const kind = /\.kicad_sym$/i.test(f.name)
      ? "sym"
      : /\.kicad_mod$/i.test(f.name)
        ? "mod"
        : /^\s*\(kicad_symbol_lib/.test(f.text)
          ? "sym"
          : /^\s*\((footprint|module)\b/.test(f.text)
            ? "mod"
            : null;
    if (!kind) {
      out.notes.push({ name: f.name, why: "Not a KiCad symbol library (.kicad_sym) or footprint (.kicad_mod)" });
      continue;
    }
    try {
      if (kind === "sym") for (const sym of readKicadSymbols(f.text)) symbols.push({ sym, file: f.name });
      else {
        const fp = readKicadFootprint(f.text);
        footprints.set(fp.footprint.name || stem(f.name), { fp, file: f.name, used: false });
      }
    } catch (e) {
      out.notes.push({ name: f.name, why: e instanceof Error ? e.message : "It could not be read" });
    }
  }
  out.found = { symbols: symbols.length, footprints: footprints.size };

  const body = (name: string, fp: FootprintDef) => {
    const model = simpleBody(name, fp);
    return model ? { model } : {};
  };
  for (const { sym, file } of symbols) {
    if (sym.symbol.power) {
      out.notes.push({ name: sym.name, why: "A power symbol. BetterCad has its own, so it was left out" });
      continue;
    }
    const named = sym.footprint?.split(":").pop();
    let match = named ? footprints.get(named) : undefined;
    let how = "";
    if (!match && named) {
      const fp = known?.(named);
      if (fp) {
        match = { fp: { footprint: fp, keywords: [], models: [], skipped: 0 }, file: "", used: false };
        how = `Its footprint ${named} came from the starter library`;
      }
    }
    if (!match) {
      const fitting = [...footprints.values()].filter((f) => fits(sym.footprintFilters, f.fp.footprint.name));
      if (fitting.length === 1) match = fitting[0];
      else if (!named && footprints.size === 1 && symbols.filter((s) => !s.sym.symbol.power).length === 1) match = [...footprints.values()][0];
      if (match) how = named ? `Its footprint ${named} was not among the files, so it uses ${match.fp.footprint.name}` : "";
    }
    const flat = unstack(sym.symbol);
    const pinMap = Object.keys(flat.pinMap).length ? { pinMap: flat.pinMap } : {};
    const def: ComponentDef = {
      name: sym.name.replace(/_/g, " "),
      ...(sym.description ? { description: sym.description } : {}),
      prefix: sym.prefix || "U",
      value: sym.value || sym.name,
      symbol: flat.symbol,
      packages: match ? [{ footprint: match.fp.footprint, ...pinMap, ...body(match.fp.footprint.name, match.fp.footprint) }] : [],
      ...(sym.keywords.length ? { keywords: sym.keywords.map((k) => k.toLowerCase()) } : {}),
      ...(sym.datasheet && /^https?:/.test(sym.datasheet) ? { datasheet: sym.datasheet } : {}),
      source: { library: source.library ?? stem(file), licence: source.licence },
    };
    if (match) {
      match.used = true;
      const bad = checkPinMap(def);
      if (bad.length) {
        const n = bad[0]!.missing.length;
        out.notes.push({
          name: def.name,
          why: `${match.fp.footprint.name} has no pad for ${n > 4 ? `${n} pins` : `pin ${bad[0]!.missing.join(", ")}`}, so it came in with no footprint`,
        });
        def.packages = [];
      } else if (how) out.notes.push({ name: def.name, why: how });
    } else
      out.notes.push({
        name: def.name,
        why: named ? `Its footprint ${named} was not among the files, so it came in with no footprint` : "It names no footprint, so it came in with none",
      });
    out.parts.push(def);
  }
  for (const [name, f] of footprints)
    if (!f.used)
      out.notes.push({
        name,
        why: symbols.length ? "No symbol here uses this footprint, so it was left out" : "A footprint needs a symbol to be a part. Add its .kicad_sym file too",
      });
  return out;
}
