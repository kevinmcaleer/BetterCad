import { eid, type ElectronicsDesign, type Id, type Part, type Variant } from "./model";

/**
 * Design variants (#758): named sets of fitted parts and changed values, such as a "Lite" build that leaves the
 * charger off. A variant only says what differs from the design as drawn; `withVariant` gives the design as that
 * variant builds it, for the parts list, pick and place and the order pack.
 */

const onVariants = (d: ElectronicsDesign, id: Id, change: (v: Variant) => Variant): ElectronicsDesign => ({
  ...d,
  variants: (d.variants ?? []).map((v) => (v.id === id ? change(v) : v)),
});

/** A new variant with nothing changed yet, named so no other has its name. */
export function addVariant(d: ElectronicsDesign, name = "Variant", id: Id = eid("var")): { design: ElectronicsDesign; id: Id } {
  const taken = new Set((d.variants ?? []).map((v) => v.name));
  let free = name.trim() || "Variant";
  for (let n = 2; taken.has(free); n += 1) free = `${name.trim() || "Variant"} ${n}`;
  return { design: { ...d, variants: [...(d.variants ?? []), { id, name: free }] }, id };
}

export const renameVariant = (d: ElectronicsDesign, id: Id, name: string): ElectronicsDesign =>
  name.trim() ? onVariants(d, id, (v) => ({ ...v, name: name.trim() })) : d;

export function removeVariant(d: ElectronicsDesign, id: Id): ElectronicsDesign {
  const variants = (d.variants ?? []).filter((v) => v.id !== id);
  const out: ElectronicsDesign = { ...d, variants };
  if (!variants.length) delete out.variants;
  return out;
}

/** Fits or leaves off parts in a variant. Where that is what the design as drawn does, the variant forgets them. */
export function setVariantFitted(d: ElectronicsDesign, id: Id, parts: Id[], fitted: boolean): ElectronicsDesign {
  const drawn = new Map(d.parts.map((p) => [p.id, p.fitted !== false]));
  return onVariants(d, id, (v) => {
    const next = { ...v.fitted };
    for (const p of parts) {
      if (drawn.get(p) === fitted) delete next[p];
      else next[p] = fitted;
    }
    const out: Variant = { ...v, fitted: next };
    if (!Object.keys(next).length) delete out.fitted;
    return out;
  });
}

/** Changes a part's value in a variant; the drawn value, or an empty one, takes the change away. */
export function setVariantValue(d: ElectronicsDesign, id: Id, part: Id, value: string): ElectronicsDesign {
  const drawn = d.parts.find((p) => p.id === part)?.value;
  return onVariants(d, id, (v) => {
    const next = { ...v.values };
    if (!value.trim() || value.trim() === drawn) delete next[part];
    else next[part] = value.trim();
    const out: Variant = { ...v, values: next };
    if (!Object.keys(next).length) delete out.values;
    return out;
  });
}

/** A part as a variant builds it. */
export function partIn(v: Variant | undefined, p: Part): Part {
  if (!v) return p;
  const fitted = v.fitted?.[p.id];
  const value = v.values?.[p.id];
  if (fitted === undefined && value === undefined) return p;
  const out: Part = { ...p, ...(value !== undefined ? { value } : {}) };
  if (fitted === true) delete out.fitted;
  else if (fitted === false) out.fitted = false;
  return out;
}

/** The design as a variant builds it; the design as drawn for none, or one it doesn't have. */
export function withVariant(d: ElectronicsDesign, id: Id | null | undefined): ElectronicsDesign {
  const v = id ? d.variants?.find((x) => x.id === id) : undefined;
  return v ? { ...d, parts: d.parts.map((p) => partIn(v, p)) } : d;
}

/** What a variant changes, in words, by reference: "R4 not fitted", "C2 10 µF". */
export function variantChanges(d: ElectronicsDesign, id: Id): string[] {
  const v = d.variants?.find((x) => x.id === id);
  if (!v) return [];
  const ref = new Map(d.parts.map((p) => [p.id, p.ref]));
  const out: string[] = [];
  for (const [p, fitted] of Object.entries(v.fitted ?? {})) if (ref.has(p)) out.push(`${ref.get(p)} ${fitted ? "fitted" : "not fitted"}`);
  for (const [p, value] of Object.entries(v.values ?? {})) if (ref.has(p)) out.push(`${ref.get(p)} ${value}`);
  return out.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}
