import { realParts, tidyValue } from "../edit";
import { packageOf, type ElectronicsDesign, type Id, type Part } from "../model";
import { byRef } from "../nets";
import data from "./common.json";
import { setSupplier, supplierOf } from "./parts";

/**
 * Common parts with their LCSC numbers (#661): the everyday resistors and capacitors a board house keeps loaded. The
 * list is data, read from each part's own page, with the day it was read. A number is only ever offered for a part
 * whose kind, value and package all match, and only where the part has none: a wrong number orders the wrong part.
 */
export interface CommonPart {
  /** The reference prefix of the kind of part: R or C. */
  prefix: string;
  /** The value as BetterCad writes it: "10 kΩ", "100 nF". */
  value: string;
  /** The package's size code: "0603". */
  package: string;
  lcsc: string;
  mpn: string;
  manufacturer: string;
  /** What the value does not say: tolerance, power or voltage, dielectric. */
  spec: string;
  /** The board house's library type when it was read. */
  type: string;
  source: string;
}

export const COMMON_PARTS: readonly CommonPart[] = data.parts;
/** The day the list was read from the supplier's pages. */
export const COMMON_CHECKED: string = data.checked;

/** A chip package's size code, from the footprint's name: "R_0603_1608Metric" is "0603". */
const sizeOf = (footprint: string): string | undefined => /(?:^|[_ ])(\d{4})(?:[_ ]|$)/.exec(footprint)?.[1];

/** The common part that is this part exactly: same kind, value and package. */
export function commonFor(d: ElectronicsDesign, part: Part): CommonPart | undefined {
  const prefix = d.defs[part.def]?.prefix ?? "";
  const size = sizeOf(packageOf(d, part)?.footprint.name ?? "");
  if (!size) return undefined;
  const value = tidyValue(part.value, prefix);
  return COMMON_PARTS.find((c) => c.prefix === prefix && c.package === size && c.value === value);
}

export interface CommonMatch {
  part: Id;
  ref: string;
  common: CommonPart;
}

/** The parts with no LCSC number of their own or their component's that a common part matches, in name order. */
export function commonMatches(d: ElectronicsDesign): CommonMatch[] {
  return realParts(d)
    .sort((a, b) => byRef(a.ref, b.ref))
    .flatMap((p) => {
      const common = supplierOf(d, p).lcsc ? undefined : commonFor(d, p);
      return common ? [{ part: p.id, ref: p.ref, common }] : [];
    });
}

/** Gives every matching part its common part's numbers. Parts that have a number already are left alone. */
export function fillCommon(d: ElectronicsDesign): ElectronicsDesign {
  return commonMatches(d).reduce((next, m) => setSupplier(next, [m.part], { lcsc: m.common.lcsc, mpn: m.common.mpn, manufacturer: m.common.manufacturer }), d);
}
