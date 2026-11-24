import { isPower, packageOf, type ElectronicsDesign } from "../model";
import { byRef, netlist, type Netlist } from "../nets";

const quote = (t: string): string => `"${t.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/**
 * The design's netlist in KiCad's own format (#635, version "E"), which KiCad's board editor and many other tools
 * read: every part with its value and footprint, then every net with its pins.
 */
export function kicadNetlist(d: ElectronicsDesign, o: { title?: string; date?: string; nl?: Netlist } = {}): string {
  const nl = o.nl ?? netlist(d);
  const parts = d.parts.filter((p) => !isPower(d, p)).sort((a, b) => byRef(a.ref, b.ref));
  const out: string[] = [
    '(export (version "E")',
    "  (design",
    `    (source ${quote(o.title ?? "BetterCad")})`,
    `    (date ${quote(o.date ?? "")})`,
    '    (tool "BetterCad"))',
    "  (components",
  ];
  for (const p of parts) {
    const def = d.defs[p.def];
    const fp = packageOf(d, p)?.footprint.name;
    out.push(`    (comp (ref ${quote(p.ref)})`, `      (value ${quote(p.value)})`);
    if (fp) out.push(`      (footprint ${quote(fp)})`);
    if (def?.datasheet) out.push(`      (datasheet ${quote(def.datasheet)})`);
    if (p.fitted === false) out.push('      (property (name "dnp"))');
    out.push(`      (tstamps ${quote(p.id)}))`);
  }
  out.push("  )", "  (nets");
  nl.nets.forEach((net, i) => {
    if (!net.pins.length) return;
    out.push(`    (net (code ${quote(String(i + 1))}) (name ${quote(net.name)})`);
    for (const pin of net.pins)
      out.push(
        `      (node (ref ${quote(pin.ref)}) (pin ${quote(pin.pin)})${pin.name && pin.name !== "~" && pin.name !== pin.pin ? ` (pinfunction ${quote(pin.name)})` : ""} (pintype ${quote(pin.type)}))`,
      );
    out[out.length - 1] += ")";
  });
  out.push("  )", ")", "");
  return out.join("\n");
}
