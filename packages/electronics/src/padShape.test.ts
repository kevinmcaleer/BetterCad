import { describe, expect, it } from "vitest";
import { boardPads, pointInPolygon, type BoardPad } from "./board";
import { packageIn } from "./eagle/library";
import { parseXml } from "./eagle/xml";
import { gerberFiles } from "./fab/gerber";
import { ipc2581 } from "./fab/ipc2581";
import { inkAt, readGerber } from "./fab/read";
import { kicadFootprint, kicadProject } from "./kicad/export";
import { readKicadFootprint } from "./kicad/footprint";
import { importKicadProject } from "./kicad/project";
import type { ElectronicsDesign, P2, Pad } from "./model";
import { copperMiddle, octagon, outlineBox, padOnBoard, padOutline } from "./padShape";
import { copperOf } from "./pcb/copper";
import { checkBoard } from "./pcb/drc";
import { sampleBoard } from "./sample";

const near = (a: P2, b: P2) => {
  expect(a[0]).toBeCloseTo(b[0], 3);
  expect(a[1]).toBeCloseTo(b[1], 3);
};

/** The sample board with the driver's pin 1 an octagon, and the 1×2 header's pin 2 copper moved off its hole. */
function shaped(off: P2 = [0.1, 0]): ElectronicsDesign {
  const d = sampleBoard();
  const defs = { ...d.defs };
  for (const [id, def] of Object.entries(defs)) {
    const change = (pads: Pad[]): Pad[] =>
      def.name === "L293D motor driver"
        ? pads.map((p, i) => (i === 0 ? { ...p, shape: "polygon", points: octagon(p.w, p.h), round: undefined } : p))
        : def.name === "Pin header 1×2"
          ? pads.map((p, i) => (i === 1 ? { ...p, offset: off } : p))
          : pads;
    defs[id] = { ...def, packages: def.packages.map((k) => ({ ...k, footprint: { ...k.footprint, pads: change(k.footprint.pads) } })) };
  }
  return { ...d, defs };
}
const pick = (d: ElectronicsDesign) => {
  const pads = boardPads(d);
  const refOf = (p: BoardPad) => d.parts.find((x) => x.id === p.part)?.ref ?? "";
  const eight = pads.find((p) => p.pad.shape === "polygon")!;
  const moved = pads.find((p) => p.pad.offset)!;
  return { pads, eight, moved, refOf };
};

describe("pad shapes (#744)", () => {
  it("work out the copper's middle and outline, turned with the pad", () => {
    near(copperMiddle({ x: 1, y: 2, angle: 90, offset: [0.5, 0] }), [1, 2.5]);
    near(copperMiddle({ x: 1, y: 2 }), [1, 2]);
    const square: P2[] = [
      [-1, -0.5],
      [1, -0.5],
      [1, 0.5],
      [-1, 0.5],
    ];
    const out = padOutline({ x: 0, y: 0, angle: 90, shape: "polygon", points: square })!;
    near(out[0]!, [0.5, -1]);
    expect(padOutline({ x: 0, y: 0, shape: "rect" })).toBeNull();
    const o = octagon(2, 2);
    expect(o).toHaveLength(8);
    expect(outlineBox(o)).toEqual({ w: 2, h: 2, mid: [0, 0] });
    // On the back the outline is mirrored with the part.
    const back = padOnBoard({ x: 1, y: 0, shape: "polygon", points: square, offset: [0, 1] }, { x: 0, y: 0, rot: 0, side: "bottom" });
    near(back.centre!, [-1, 1]);
    expect(back.outline).toHaveLength(4);
  });

  it("put the copper where it is on the board, for the check and the pours", () => {
    const d = shaped();
    const { eight, moved, pads } = pick(d);
    expect(eight.outline).toHaveLength(8);
    near(moved.centre!, [moved.at[0] + 0.1, moved.at[1]]);
    const copper = copperOf(d, pads);
    expect(copper.find((c) => c.kind === "pad" && c.pts.length === 8 && c.r === 0)).toBeDefined();
    expect(checkBoard(d).map((r) => r.text)).toEqual(checkBoard(sampleBoard()).map((r) => r.text));
  });

  it("thin the ring round the hole by as much as the copper moves, and the check says so", () => {
    const ring = (d: ElectronicsDesign) => checkBoard(d).filter((r) => r.rule === "ring").length;
    expect(ring(shaped([0.1, 0]))).toBe(ring(sampleBoard()));
    // Every header of that kind gets the thin ring: one result for each.
    const moved = pick(shaped([0.3, 0])).pads.filter((p) => p.pad.offset).length;
    expect(moved).toBeGreaterThan(0);
    expect(ring(shaped([0.3, 0]))).toBe(ring(sampleBoard()) + moved);
  });

  it("are copper in the Gerber files: an octagon as a region, its mask opening grown round it", () => {
    const d = shaped();
    const { eight, moved } = pick(d);
    const files = gerberFiles(d);
    const top = readGerber(files.find((f) => f.layer === "copper-top")!.text);
    const mid = eight.at;
    const box = outlineBox(eight.outline!);
    // The pad is a region round its middle (pours are regions too, with many more corners) that leaves out the box's corner, which the octagon cuts off.
    const corner: P2 = [mid[0] + box.w / 2 - 0.05, mid[1] + box.h / 2 - 0.05];
    const regions = top.ops.flatMap((o) => (o.kind === "region" && o.pts.length <= 9 && pointInPolygon(mid, o.pts) ? [o.pts] : []));
    expect(regions.length).toBeGreaterThan(0);
    expect(regions.some((pts) => pointInPolygon(corner, pts))).toBe(false);
    // The moved copper is flashed at its own middle, not the hole's.
    const flashes = top.ops.filter((o) => o.kind === "flash").map((o) => (o.kind === "flash" ? o.at : [0, 0]));
    expect(flashes.some((f) => Math.hypot(f[0] - moved.centre![0], f[1] - moved.centre![1]) < 1e-3)).toBe(true);
    expect(flashes.some((f) => Math.hypot(f[0] - moved.at[0], f[1] - moved.at[1]) < 1e-3)).toBe(false);
    // The mask's opening is the outline grown by the board's gap.
    const mask = readGerber(files.find((f) => f.layer === "mask-top")!.text);
    expect(inkAt(mask, [mid[0] + box.w / 2 + 0.03, mid[1]])).toBe(true);
    expect(inkAt(mask, corner)).toBe(false);
  });

  it("go to IPC-2581 as an outline", () => {
    const xml = ipc2581(shaped(), "pads", new Date(0))!;
    expect(xml).toMatch(/<EntryStandard id="SHAPE_\d+"><Contour><Polygon>/);
  });

  it("go to KiCad as a custom pad and a drill offset, and come back the same", () => {
    const d = shaped();
    const files = kicadProject(d, "trip").files;
    const pcb = files.find((f) => f.name.endsWith(".kicad_pcb"))!.text;
    expect(pcb).toMatch(/thru_hole\s+custom/);
    expect(pcb).toMatch(/\(gr_poly/);
    expect(pcb).toMatch(/\(drill [\d.]+\s*\(offset 0\.1 0\)\s*\)/);
    const got = importKicadProject(files, { licence: "CC0" });
    expect(got.notes.map((x) => x.why).join(" ")).not.toContain("off the middle");
    const back = pick(got.design);
    const before = pick(d);
    expect(back.eight.outline!.length).toBe(8);
    before.eight.outline!.forEach((p, i) => near(back.eight.outline![i]!, p));
    near(back.moved.centre!, before.moved.centre!);
  });

  it("read a KiCad footprint's custom pad and offset drill", () => {
    const fp = readKicadFootprint(`(footprint "Odd" (layer "F.Cu")
      (pad "1" smd custom (at 1 1) (size 0.5 0.5) (layers "F.Cu" "F.Paste" "F.Mask")
        (options (clearance outline) (anchor circle))
        (primitives (gr_poly (pts (xy -1 -0.5) (xy 1 -0.5) (xy 0 1)) (width 0) (fill yes))))
      (pad "2" thru_hole oval (at 4 0) (size 2 1.2) (drill 0.8 (offset 0.4 0)) (layers "*.Cu" "*.Mask")))`).footprint;
    const [a, b] = fp.pads as [Pad, Pad];
    expect(a.shape).toBe("polygon");
    expect(a.points).toEqual([
      [-1, 0.5],
      [1, 0.5],
      [0, -1],
    ]);
    expect([a.w, a.h]).toEqual([2, 1.5]);
    expect(b.offset).toEqual([0.4, 0]);
    // And a footprint written out reads back the same.
    const again = readKicadFootprint(kicadFootprint(fp, "Odd")).footprint;
    expect(again.pads[0]!.points).toEqual(a.points);
    expect(again.pads[1]!.offset).toEqual([0.4, 0]);
  });

  it("read Eagle's octagon and offset pads as they are drawn", () => {
    const pkg = packageIn(
      parseXml(
        `<package name="P"><pad name="1" x="0" y="0" drill="0.8" diameter="1.6" shape="octagon"/><pad name="2" x="2.54" y="0" drill="0.8" diameter="1.6" shape="offset"/></package>`,
      ),
    );
    const [a, b] = pkg.footprint.pads as [Pad, Pad];
    expect(a.shape).toBe("polygon");
    expect(a.points).toEqual(octagon(1.6, 1.6));
    expect(b.shape).toBe("oval");
    expect(b.offset).toEqual([0.8, 0]);
  });
});
