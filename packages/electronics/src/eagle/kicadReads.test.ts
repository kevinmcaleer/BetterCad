import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { needsKicad } from "../kicad/needsKicad";
import { boardPads } from "../board";
import { importEagleProject } from "./project";

/**
 * A second opinion on the Eagle reader (#665): KiCad reads Eagle boards too, so where KiCad's Python module is
 * installed (`apt install kicad`), it opens the same test board and every pad must be where ours is, the same size,
 * on the same side and on the same net. The pull request CI has no KiCad, so this skips there; the Nightly KiCad workflow runs it in KiCad's own image (#759).
 */
const SCRIPT = `
import json, sys, pcbnew
b = pcbnew.IO_MGR.Load(pcbnew.IO_MGR.EAGLE, sys.argv[1])
mm = lambda v: round(pcbnew.ToMM(v), 4)
pads = [{"ref": f.GetReference(), "pad": p.GetNumber(), "x": mm(p.GetPosition().x), "y": mm(p.GetPosition().y), "w": mm(p.GetSize().x), "h": mm(p.GetSize().y),
         "top": p.IsOnLayer(pcbnew.F_Cu), "bottom": p.IsOnLayer(pcbnew.B_Cu), "net": p.GetNetname(), "drill": mm(p.GetDrillSize().x)}
        for f in b.GetFootprints() for p in f.Pads()]
vias = [{"x": mm(t.GetPosition().x), "y": mm(t.GetPosition().y), "d": mm(t.GetWidth()), "drill": mm(t.GetDrillValue())} for t in b.GetTracks() if t.GetClass() == "PCB_VIA"]
print("JSON" + json.dumps({"pads": pads, "vias": vias}))
`;
const board = join(__dirname, "fixtures", "turns.brd");
const ran = spawnSync("python3", ["-c", SCRIPT, board], { encoding: "utf8" });
const has = ran.status === 0 && ran.stdout.includes("JSON");
needsKicad(has, "KiCad's Python module (pcbnew)");

interface TheirPad {
  ref: string;
  pad: string;
  x: number;
  y: number;
  w: number;
  h: number;
  top: boolean;
  bottom: boolean;
  net: string;
  drill: number;
}

describe.skipIf(!has)("KiCad reads the same Eagle board", () => {
  const read = () => {
    const theirs = JSON.parse(ran.stdout.slice(ran.stdout.indexOf("JSON") + 4)) as {
      pads: TheirPad[];
      vias: { x: number; y: number; d: number; drill: number }[];
    };
    const file = (name: string) => ({ name, text: readFileSync(join(__dirname, "fixtures", name), "utf8") });
    const design = importEagleProject([file("turns.sch"), file("turns.brd")]).design;
    return { theirs, design, ours: boardPads(design) };
  };

  it("puts every pad where KiCad does, the same size and on the same side", () => {
    const { theirs, ours } = read();
    // KiCad keeps Eagle's own origin, with y down; ours is the outline's corner, with y up. One pad gives the shift.
    const mine = (ref: string, pad: string) => ours.find((p) => p.ref === ref && p.pad.number === pad)!;
    const anchor = theirs.pads.find((p) => p.ref === "R1" && p.pad === "1")!;
    const dx = anchor.x - mine("R1", "1").at[0];
    const dy = -anchor.y - mine("R1", "1").at[1];
    const real = theirs.pads.filter((p) => p.pad !== "");
    expect(real.length).toBe(ours.filter((p) => p.pad.number !== "").length);
    for (const t of real) {
      const m = mine(t.ref, t.pad);
      const what = `${t.ref} pad ${t.pad}`;
      expect(m.at[0] + dx, `${what} x`).toBeCloseTo(t.x, 3);
      expect(m.at[1] + dy, `${what} y`).toBeCloseTo(-t.y, 3);
      expect([m.pad.w, m.pad.h], `${what} size`).toEqual([t.w, t.h]);
      expect(m.pad.drill ?? 0, `${what} drill`).toBe(t.drill);
      const side = t.top && t.bottom ? "both" : t.top ? "top" : "bottom";
      expect(m.pad.kind === "thru" ? "both" : m.side, `${what} side`).toBe(side);
    }
  });

  it("groups the pads into the same nets", () => {
    const { theirs, ours } = read();
    const groups = (pairs: [string, string][]) => {
      const by = new Map<string, string[]>();
      for (const [net, pad] of pairs) if (net) by.set(net, [...(by.get(net) ?? []), pad]);
      return [...by.values()].map((g) => g.sort().join(" ")).sort();
    };
    expect(groups(ours.filter((p) => p.pad.number).map((p) => [p.net, `${p.ref}.${p.pad.number}`]))).toEqual(
      groups(theirs.pads.filter((p) => p.pad).map((p) => [p.net, `${p.ref}.${p.pad}`])),
    );
  });

  it("gives vias with no size of their own the ring KiCad gives them", () => {
    const { theirs, design } = read();
    const sizes = (list: { d: number; drill: number }[]) => list.map((v) => `${v.d} ${v.drill}`).sort();
    // KiCad's reading has only the vias that go right through; the blind one (#648) is ours to keep as well.
    expect(sizes(design.board!.vias.filter((v) => !v.span).map((v) => ({ d: v.diameter, drill: v.drill })))).toEqual(sizes(theirs.vias));
  });
});
