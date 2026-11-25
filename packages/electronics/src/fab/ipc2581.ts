import { boardPads, outlinePoints } from "../board";
import { packageOf, type ElectronicsDesign, type P2 } from "../model";
import { netlist } from "../nets";
import { buildOf, layersOf } from "../pcb/stack";
import { holesOf } from "./drill";
import { gerberFiles, type GerberLayer } from "./gerber";
import { bom, mountingOf } from "./parts";
import { readGerber, type Aperture, type GerberOp, type Prim } from "./read";

/**
 * IPC-2581 (#662): the whole board in one XML file, revision C, as some assemblers ask for in place of Gerbers, drill
 * files and parts lists. Every layer's image is the Gerber writer's own, read back and written out again as IPC-2581
 * features, so the two can never disagree; on top of that it carries the parts, their packages and pins, the nets,
 * the stack and the parts list.
 */

const n = (v: number) => String(Math.round(v * 1e4) / 1e4);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** Names are used as references; the format wants them plain. */
const id = (s: string) => s.replace(/[^A-Za-z0-9_.+-]/g, "_") || "_";

const LAYER_FN: Partial<Record<string, { fn: string; side: "TOP" | "BOTTOM" | "INTERNAL" }>> = {
  "mask-top": { fn: "SOLDERMASK", side: "TOP" },
  "mask-bottom": { fn: "SOLDERMASK", side: "BOTTOM" },
  "paste-top": { fn: "SOLDERPASTE", side: "TOP" },
  "paste-bottom": { fn: "SOLDERPASTE", side: "BOTTOM" },
  "silk-top": { fn: "SILKSCREEN", side: "TOP" },
  "silk-bottom": { fn: "SILKSCREEN", side: "BOTTOM" },
};

/** The IPC-2581 layer name for a Gerber layer. */
const layerOf = (l: GerberLayer): string =>
  l
    .replace(/^copper-/, "")
    .toUpperCase()
    .replace(/-/g, "_");

/** Collects the shapes used, so each is written once in the dictionaries and referred to by its id. */
class Dictionary {
  shapes = new Map<string, string>();
  lines = new Map<string, string>();
  shape(xml: string): string {
    let k = this.shapes.get(xml);
    if (!k) this.shapes.set(xml, (k = `SHAPE_${this.shapes.size + 1}`));
    return k;
  }
  line(width: number): string {
    const w = n(width);
    let k = this.lines.get(w);
    if (!k) this.lines.set(w, (k = `LINE_${this.lines.size + 1}`));
    return k;
  }
}

const polygon = (pts: P2[], tag = "Polygon") =>
  `<${tag}><PolyBegin x="${n(pts[0]![0])}" y="${n(pts[0]![1])}"/>${[...pts.slice(1), pts[0]!].map((p) => `<PolyStepSegment x="${n(p[0])}" y="${n(p[1])}"/>`).join("")}</${tag}>`;
const polyline = (pts: P2[]) =>
  `<PolyBegin x="${n(pts[0]![0])}" y="${n(pts[0]![1])}"/>${pts
    .slice(1)
    .map((p) => `<PolyStepSegment x="${n(p[0])}" y="${n(p[1])}"/>`)
    .join("")}`;

/** One drawn thing as IPC-2581 features. */
function features(op: GerberOp, dict: Dictionary): string[] {
  if (op.kind === "region") return [`<Contour>${polygon(op.pts)}</Contour>`];
  if (op.kind === "draw") return [`<Polyline>${polyline(op.pts)}<LineDescRef id="${dict.line(op.pen)}"/></Polyline>`];
  const at = op.at;
  const ap: Aperture = op.ap;
  const ref = (xml: string) => `<Pad><Location x="${n(at[0])}" y="${n(at[1])}"/><StandardPrimitiveRef id="${dict.shape(xml)}"/></Pad>`;
  if (ap.kind === "circle") return [ref(`<Circle diameter="${n(ap.d)}"/>`)];
  if (ap.kind === "rect") return [ref(`<RectCenter width="${n(ap.w)}" height="${n(ap.h)}"/>`)];
  if (ap.kind === "obround") return [ref(`<Oval width="${n(ap.w)}" height="${n(ap.h)}"/>`)];
  // A macro: each of its pieces where it lands. Pieces that take away are rare and drawn as they come.
  return ap.prims.map((p: Prim) =>
    p.kind === "disc"
      ? `<Pad><Location x="${n(at[0] + p.at[0])}" y="${n(at[1] + p.at[1])}"/><StandardPrimitiveRef id="${dict.shape(`<Circle diameter="${n(p.d)}"/>`)}"/></Pad>`
      : `<Contour>${polygon(p.pts.map((q): P2 => [q[0] + at[0], q[1] + at[1]]))}</Contour>`,
  );
}

/** A layer's image as Sets: one for each run of objects on the same net with the same polarity, in drawing order. */
function layerSets(text: string, dict: Dictionary): string {
  const ops = readGerber(text).ops;
  const out: string[] = [];
  let i = 0;
  while (i < ops.length) {
    const first = ops[i]!;
    const net = first.net && first.net !== "N/C" ? first.net : "";
    const feats: string[] = [];
    while (i < ops.length && ops[i]!.dark === first.dark && (ops[i]!.net ?? "") === (first.net ?? "")) feats.push(...features(ops[i++]!, dict));
    out.push(`<Set${net ? ` net="${esc(net)}"` : ""}${first.dark ? "" : ' polarity="NEGATIVE"'}><Features>${feats.join("")}</Features></Set>`);
  }
  return out.join("");
}

/** The board as an IPC-2581 revision C file. `when` is the time to stamp it with. */
export function ipc2581(d: ElectronicsDesign, name: string, when = new Date()): string | null {
  const board = d.board;
  if (!board) return null;
  const nl = netlist(d);
  const pads = boardPads(d, nl);
  const dict = new Dictionary();
  const step = id(name);
  const files = gerberFiles(d, nl);
  const copper = layersOf(board);
  const stamp = when.toISOString().replace(/\.\d+Z$/, "");
  const parts = new Map(d.parts.map((p) => [p.id, p]));
  const placed = board.placements.flatMap((at) => {
    const part = parts.get(at.part);
    const pkg = part && packageOf(d, part);
    return part && pkg ? [{ at, part, pkg }] : [];
  });

  // Layers: copper top to bottom, then the rest, then a drill layer for each span.
  const layers: { name: string; fn: string; side: string; text?: string }[] = [];
  for (const l of copper) {
    const f = files.find((x) => x.layer === `copper-${l}`)!;
    layers.push({ name: layerOf(f.layer), fn: "CONDUCTOR", side: l === "top" ? "TOP" : l === "bottom" ? "BOTTOM" : "INTERNAL", text: f.text });
  }
  for (const f of files) {
    const k = LAYER_FN[f.layer];
    if (k) layers.push({ name: layerOf(f.layer), fn: k.fn, side: k.side, text: f.text });
  }
  const holes = holesOf(d, pads);
  const spans = [...new Set(holes.map((h) => (h.span ? h.span.join("_") : `1_${copper.length}`)))];
  const drill = (s: string) => `DRILL_${s}`;
  const spanOf = (s: string) => s.split("_").map((x) => layerOf(`copper-${copper[Number(x) - 1]!}` as GerberLayer));

  const xmlLayers = [
    ...layers.map((l) => `<Layer name="${l.name}" layerFunction="${l.fn}" side="${l.side}" polarity="POSITIVE"/>`),
    ...spans.map((s) => {
      const [from, to] = spanOf(s);
      return `<Layer name="${drill(s)}" layerFunction="DRILL" side="ALL" polarity="POSITIVE"><Span fromLayer="${from}" toLayer="${to}"/></Layer>`;
    }),
  ];

  // The stack: the board's build, top to bottom, copper and the sheets between.
  const plies = buildOf(board);
  const stack: string[] = [];
  const dielectrics: string[] = [];
  plies.forEach((p, i) => {
    let ref = p.layer ? layerOf(`copper-${p.layer}` as GerberLayer) : "";
    if (!ref) {
      ref = `DIELECTRIC_${dielectrics.length + 1}`;
      dielectrics.push(`<Layer name="${ref}" layerFunction="${p.kind === "core" ? "DIELCORE" : "DIELPREG"}" side="INTERNAL" polarity="POSITIVE"/>`);
    }
    stack.push(`<StackupLayer layerOrGroupRef="${ref}" thickness="${n(p.thickness)}" tolPlus="0" tolMinus="0" sequence="${i + 1}"/>`);
  });

  // Packages, one for each footprint used, with its pins where the footprint puts them.
  const packages = new Map<string, string>();
  for (const { pkg } of placed) {
    const key = id(pkg.footprint.name);
    if (packages.has(key)) continue;
    const pins = pkg.footprint.pads.map((p) => {
      const shape =
        p.shape === "circle"
          ? `<Circle diameter="${n(Math.max(p.w, p.h))}"/>`
          : p.shape === "oval"
            ? `<Oval width="${n(p.w)}" height="${n(p.h)}"/>`
            : `<RectCenter width="${n(p.w)}" height="${n(p.h)}"/>`;
      return `<Pin number="${esc(p.number)}" type="${p.kind === "smd" ? "SURFACE" : "THRU"}" electricalType="${p.kind === "npth" ? "MECHANICAL" : "ELECTRICAL"}"><Location x="${n(p.x)}" y="${n(p.y)}"/><StandardPrimitiveRef id="${dict.shape(shape)}"/></Pin>`;
    });
    packages.set(
      key,
      `<Package name="${key}" type="OTHER" pinOne="${esc(pkg.footprint.pads[0]?.number ?? "1")}" pinOneOrientation="OTHER">${pins.join("")}</Package>`,
    );
  }

  const components = placed.map(
    ({ at, part, pkg }) =>
      `<Component refDes="${esc(part.ref)}" packageRef="${id(pkg.footprint.name)}" layerRef="${at.side === "top" ? "TOP" : "BOTTOM"}" part="${esc(part.supplier?.mpn ?? part.value)}" mountType="${mountingOf(d, part) === "thru" ? "THMT" : "SMT"}"><Xform rotation="${n(at.rot)}"${at.side === "bottom" ? ' mirror="true"' : ""}/><Location x="${n(at.x)}" y="${n(at.y)}"/></Component>`,
  );

  // Nets: every pin on each.
  const nets = new Map<string, string[]>();
  for (const p of pads) {
    if (!p.net) continue;
    if (!nets.has(p.net)) nets.set(p.net, []);
    nets.get(p.net)!.push(`<PinRef componentRef="${esc(p.ref)}" pin="${esc(p.pad.number)}"/>`);
  }
  const logical = [...nets].map(([net, pins]) => `<LogicalNet name="${esc(net)}">${[...new Set(pins)].join("")}</LogicalNet>`);

  // The images.
  const images = layers.map((l) => `<LayerFeature layerRef="${l.name}">${layerSets(l.text!, dict)}</LayerFeature>`);
  for (const s of spans) {
    const mine = holes.filter((h) => (h.span ? h.span.join("_") : `1_${copper.length}`) === s);
    const xml = mine.map((h, i) => {
      const status = h.what === "via" ? "VIA" : h.plated ? "PLATED" : "NONPLATED";
      return `<Hole name="H${i + 1}" diameter="${n(h.d)}" platingStatus="${status}" plusTol="0" minusTol="0" x="${n(h.at[0])}" y="${n(h.at[1])}"/>`;
    });
    if (xml.length) images.push(`<LayerFeature layerRef="${drill(s)}"><Set>${xml.join("")}</Set></LayerFeature>`);
  }

  const edge = outlinePoints(board.outline);
  const cutouts = (board.cutouts ?? []).map((c) => polygon(outlinePoints(c), "Cutout"));
  const profile = `<Profile>${polygon(edge)}${cutouts.join("")}</Profile>`;

  const list = bom(d);
  const items = list.rows.map((r) => {
    const refs = r.refs.map((ref, i) => {
      const at = board.placements.find((p) => p.part === r.parts[i]);
      const part = parts.get(r.parts[i]!);
      const pkg = part && packageOf(d, part);
      return `<RefDes name="${esc(ref)}" packageRef="${id(pkg?.footprint.name ?? r.footprint)}" populate="true" layerRef="${at?.side === "bottom" ? "BOTTOM" : "TOP"}"/>`;
    });
    const value = `<Textual definitionSource="BetterCad" textualCharacteristicName="Value" textualCharacteristicValue="${esc(r.value)}"/>`;
    const mpn = r.mpn
      ? `<Textual definitionSource="BetterCad" textualCharacteristicName="Manufacturer part number" textualCharacteristicValue="${esc(r.mpn)}"/>`
      : "";
    return `<BomItem OEMDesignNumberRef="${esc(`${r.value}_${r.footprint}`)}" quantity="${r.qty}" pinCount="${pins(d, r.parts[0]!)}" category="ELECTRICAL">${refs.join("")}<Characteristics category="ELECTRICAL">${value}${mpn}</Characteristics></BomItem>`;
  });

  const shapes = [...dict.shapes].map(([xml, k]) => `<EntryStandard id="${k}">${xml}</EntryStandard>`);
  const lines = [...dict.lines].map(([w, k]) => `<EntryLineDesc id="${k}"><LineDesc lineEnd="ROUND" lineWidth="${w}"/></EntryLineDesc>`);
  const layerNames = [...layers.map((l) => l.name), ...spans.map(drill)];

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<IPC-2581 revision="C" xmlns="http://webstds.ipc.org/2581" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">`,
    `<Content roleRef="Owner"><FunctionMode mode="ASSEMBLY"/><StepRef name="${step}"/>${layerNames.map((l) => `<LayerRef name="${l}"/>`).join("")}<BomRef name="${step}_BOM"/>`,
    `<DictionaryLineDesc units="MILLIMETER">${lines.join("")}</DictionaryLineDesc>`,
    `<DictionaryStandard units="MILLIMETER">${shapes.join("")}</DictionaryStandard></Content>`,
    `<LogisticHeader><Role id="Owner" roleFunction="SENDER"/><Enterprise id="BetterCad" code="NONE"/><Person name="BetterCad" enterpriseRef="BetterCad" roleRef="Owner"/></LogisticHeader>`,
    `<HistoryRecord number="1" origination="${stamp}" software="BetterCad" lastChange="${stamp}"><FileRevision fileRevisionId="1" comment="" label=""><SoftwarePackage name="BetterCad" revision="1" vendor="BetterCad"><Certification certificationStatus="SELFTEST"/></SoftwarePackage></FileRevision></HistoryRecord>`,
    `<Bom name="${step}_BOM"><BomHeader assembly="${step}" revision="1"><StepRef name="${step}"/></BomHeader>${items.join("")}</Bom>`,
    `<Ecad name="${step}"><CadHeader units="MILLIMETER"/><CadData>`,
    ...xmlLayers,
    ...dielectrics,
    `<Stackup name="${esc(board.stack ? `Stack ${board.stack}` : "Stack")}" overallThickness="${n(board.thickness)}" tolPlus="0" tolMinus="0" whereMeasured="METAL"><StackupGroup name="GROUP_PRIMARY" thickness="${n(board.thickness)}" tolPlus="0" tolMinus="0">${stack.join("")}</StackupGroup></Stackup>`,
    `<Step name="${step}"><Datum x="0" y="0"/>${profile}`,
    ...packages.values(),
    ...components,
    ...logical,
    ...images,
    `</Step></CadData></Ecad>`,
    `</IPC-2581>`,
    "",
  ].join("\n");
}

const pins = (d: ElectronicsDesign, part: string) => {
  const p = d.parts.find((x) => x.id === part);
  const pkg = p && packageOf(d, p);
  return pkg?.footprint.pads.length ?? 0;
};
