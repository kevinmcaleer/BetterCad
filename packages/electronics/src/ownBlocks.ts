/**
 * Your own blocks (#772): a group saved as a block, with the parts it needs carried inside, so it places on any
 * design and travels as one file. Saved blocks sit on the Your blocks shelf and are kept with Your library.
 */
import { buildBlock, nextTag, type BlockSpec, type BuiltBlock } from "./blocks";
import { insidePrint } from "./blockUpdate";
import { eid, isPower, type ComponentDef, type ElectronicsDesign, type Id, type PointKind, type Sheet } from "./model";
import { byRef, netlist, type Netlist } from "./nets";
import { voltsOf } from "./points";

/** A saved block: its spec, and the parts it uses by the key its spec names them with. */
export interface OwnBlock {
  spec: BlockSpec;
  defs: Record<string, ComponentDef>;
}

/** A net that could be one of the block's connection points, and how it would be one. */
export interface PointChoice {
  /** The net's name in the design. */
  net: string;
  /** The point's name: the net's name without the block's tag. */
  name: string;
  kind: PointKind;
  volts?: string;
  /** Power and ground join by name wherever the block goes. */
  global?: boolean;
  /** Offered ticked: it leaves the group, or it is a supply. */
  pick: boolean;
}

const tagOf = (sheet: Sheet, groupId: Id) => sheet.groups?.find((g) => g.id === groupId)?.block?.tag;
const local = (net: string, tag?: string) => (tag && net.startsWith(`${tag}.`) ? net.slice(tag.length + 1) : net);
const isGround = (name: string) => /^(GND|0V|VSS|AGND|DGND|PGND)$/i.test(name);

function groupParts(d: ElectronicsDesign, sheet: Sheet, groupId: Id) {
  const g = sheet.groups?.find((x) => x.id === groupId);
  const ids = new Set(sheet.symbols.filter((y) => g?.members.includes(y.id)).map((y) => y.part));
  const all = d.parts.filter((p) => ids.has(p.id));
  return { g, real: all.filter((p) => !isPower(d, p)).sort((a, b) => byRef(a.ref, b.ref)), power: all.filter((p) => isPower(d, p)) };
}

/** The nets a group's parts are on that could be points, ticked when they leave the group or are a supply. */
export function pointChoices(d: ElectronicsDesign, sheetId: Id, groupId: Id, nl: Netlist = netlist(d)): PointChoice[] {
  const sheet = d.sheets.find((s) => s.id === sheetId);
  if (!sheet) return [];
  const { real } = groupParts(d, sheet, groupId);
  const inside = new Set(real.map((p) => p.id));
  const tag = tagOf(sheet, groupId);
  const inGroup = new Set(sheet.groups?.find((g) => g.id === groupId)?.members);
  const labelled = new Set(sheet.labels.filter((l) => inGroup.has(l.id)).map((l) => l.name));
  const labelById = new Map(sheet.labels.map((l) => [l.id, l.name]));
  const known = new Map((sheet.groups?.find((g) => g.id === groupId)?.block?.points ?? []).map((p) => [labelById.get(p.label) ?? "", p]));
  const out: PointChoice[] = [];
  for (const net of nl.nets) {
    if (!net.pins.some((p) => inside.has(p.part))) continue;
    const leaves = net.pins.some((p) => !inside.has(p.part));
    const supply = net.power.length > 0;
    if (!leaves && !supply && !net.names.some((n) => labelled.has(n))) continue;
    const name = local(net.name, tag);
    // A block saved again keeps its points as they were.
    const was = known.get(net.name);
    if (was) {
      out.push({
        net: net.name,
        name: was.name,
        kind: was.kind,
        ...(was.volts ? { volts: was.volts } : {}),
        ...(was.kind === "ground" || net.name === was.name ? { global: true } : {}),
        pick: true,
      });
      continue;
    }
    const ground = isGround(name) || net.power.some(isGround);
    const volts = voltsOf(name);
    out.push({
      net: net.name,
      name,
      kind: ground ? "ground" : supply ? "power-in" : "plain",
      ...(supply && !ground && volts !== null ? { volts: `${volts} V` } : {}),
      ...(supply || ground ? { global: true } : {}),
      pick: leaves || supply || ground,
    });
  }
  return out.sort((a, b) => Number(b.kind === "ground") - Number(a.kind === "ground") || byRef(a.name, b.name));
}

/** A tag from a name: "Motor board" gives MB, "Sensor" gives SE. */
export function tagFor(name: string): string {
  const words = name.toUpperCase().match(/[A-Z]+/g) ?? [];
  const tag =
    words.length > 1
      ? words
          .map((w) => w[0])
          .join("")
          .slice(0, 3)
      : (words[0] ?? "B").slice(0, 2);
  return tag || "B";
}

/**
 * Saves a group as a block: its parts, how they are joined, the points chosen and what each part is for. Nets that
 * stay inside the group keep their names; ones with no name get N1, N2. Pins marked Not connected stay open.
 */
export function blockFromGroup(
  d: ElectronicsDesign,
  sheetId: Id,
  groupId: Id,
  how: { name: string; summary: string; points: PointChoice[]; id?: string; version?: number },
  nl: Netlist = netlist(d),
): OwnBlock | null {
  const sheet = d.sheets.find((s) => s.id === sheetId);
  if (!sheet) return null;
  const { g, real } = groupParts(d, sheet, groupId);
  if (!g || !real.length) return null;
  const tag = tagOf(sheet, groupId);
  const inside = new Set(real.map((p) => p.id));
  const refOf = new Map(real.map((p) => [p.id, p.ref]));
  const chosen = new Map(how.points.map((p) => [p.net, p]));
  const defs: Record<string, ComponentDef> = {};
  const keyOf = new Map<Id, string>();
  for (const p of real) {
    const def = d.defs[p.def];
    if (!def) continue;
    // One copy of each part kind.
    let key = [...keyOf.entries()].find(([, k]) => defs[k] === def)?.[1];
    if (!key) {
      key = `p${Object.keys(defs).length + 1}`;
      defs[key] = def;
    }
    keyOf.set(p.id, key);
  }
  const nets: Record<string, string[]> = {};
  let unnamed = 0;
  for (const net of nl.nets) {
    const pins = net.pins.filter((p) => inside.has(p.part));
    if (!pins.length) continue;
    const point = chosen.get(net.name);
    if (pins.length < 2 && !point) continue;
    const name = point ? point.name : net.named ? local(net.name, tag) : `N${(unnamed += 1)}`;
    nets[name] = [...(nets[name] ?? []), ...pins.map((p) => `${refOf.get(p.part)}.${p.pin}`)];
  }
  const open = [...nl.noConnect].flatMap((k) => {
    const [part, pin] = [k.slice(0, k.indexOf(":")), k.slice(k.indexOf(":") + 1)];
    return inside.has(part) ? [`${refOf.get(part)}.${pin}`] : [];
  });
  const id =
    how.id ??
    `own-${
      how.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "block"
    }-${eid("b").slice(-6)}`;
  const spec: BlockSpec = {
    id,
    version: how.version ?? 1,
    name: how.name.trim() || g.name,
    shelf: "Your blocks",
    summary: how.summary.trim() || `Saved from the group ${g.name}.`,
    tag: tagFor(how.name || g.name),
    source: { title: "Your own block", url: "" },
    parts: real.map((p) => ({
      ref: p.ref,
      part: keyOf.get(p.id)!,
      ...(p.value ? { value: p.value } : {}),
      ...(p.pkg ? { pkg: p.pkg } : {}),
      note: g.block?.notes?.[p.id] ?? "",
    })),
    nets,
    ...(open.length ? { open } : {}),
    points: how.points.map((p) => ({
      name: p.name,
      net: p.name,
      kind: p.kind,
      ...(p.volts ? { volts: p.volts } : {}),
      ...(p.global ? { global: true } : {}),
      ...(p.kind === "power-in" || p.kind === "ground" ? { required: true } : {}),
    })),
  };
  return { spec, defs };
}

/** Builds an own block to place, from the parts carried inside it. */
export function buildOwn(b: OwnBlock): BuiltBlock {
  return buildBlock(b.spec, (key) => b.defs[key]);
}

/**
 * The group becomes a placed copy of the block it was saved as: it carries the block's name and version, so the
 * Update badge can tell when the block moves on. Its parts and wires stay as they are.
 */
export function markAsBlock(d: ElectronicsDesign, sheetId: Id, groupId: Id, b: OwnBlock): ElectronicsDesign {
  const print = insidePrint(d, sheetId, groupId);
  return {
    ...d,
    sheets: d.sheets.map((s): Sheet => {
      if (s.id !== sheetId) return s;
      return {
        ...s,
        groups: s.groups?.map((g) =>
          g.id === groupId
            ? {
                ...g,
                name: b.spec.name,
                block: { ...(g.block ?? { points: [], tag: nextTag(d, b.spec.tag) }), def: b.spec.id, version: b.spec.version, print },
              }
            : g,
        ),
      };
    }),
  };
}

/** True for a block file's contents: a spec with its parts inside. */
export function isOwnBlock(v: unknown): v is OwnBlock {
  const b = v as Partial<OwnBlock> | null;
  const s = b?.spec as Partial<BlockSpec> | undefined;
  return (
    !!b &&
    typeof b.defs === "object" &&
    !!s &&
    typeof s.id === "string" &&
    typeof s.name === "string" &&
    typeof s.version === "number" &&
    Array.isArray(s.parts) &&
    Array.isArray(s.points) &&
    typeof s.nets === "object" &&
    s.parts.every((p) => p && typeof p.part === "string" && !!b.defs![p.part])
  );
}

/** A block as a file to share: `.bcblock`, JSON. */
export const blockFileText = (b: OwnBlock): string => `${JSON.stringify({ bcblock: 1, ...b }, null, 1)}\n`;

/** Reads a block file, or says what is wrong with it. */
export function readBlockFile(text: string): OwnBlock | string {
  try {
    const v = JSON.parse(text) as unknown;
    if (!isOwnBlock(v)) return "That file isn't a BetterCad block.";
    const { spec, defs } = v;
    return { spec: { ...spec, shelf: "Your blocks" }, defs };
  } catch {
    return "That file isn't a BetterCad block.";
  }
}
