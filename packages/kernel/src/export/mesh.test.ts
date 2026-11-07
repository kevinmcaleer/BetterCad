import { describe, expect, it } from "vitest";
import { meshVolume, placeOnBed, read3mf, readStl, stlBytes, write3mf, writeStl, type MeshBody } from "./mesh";
import { crc32, unzip, zip } from "./zip";

/** A 10 mm cube from (0,0,5) to (10,10,15), as 12 outward triangles. */
function cube(z0 = 5): Float32Array {
  const p = (x: number, y: number, z: number) => [x * 10, y * 10, z * 10 + z0];
  const quads = [
    [p(0, 0, 0), p(0, 1, 0), p(1, 1, 0), p(1, 0, 0)],
    [p(0, 0, 1), p(1, 0, 1), p(1, 1, 1), p(0, 1, 1)],
    [p(0, 0, 0), p(1, 0, 0), p(1, 0, 1), p(0, 0, 1)],
    [p(1, 1, 0), p(0, 1, 0), p(0, 1, 1), p(1, 1, 1)],
    [p(0, 1, 0), p(0, 0, 0), p(0, 0, 1), p(0, 1, 1)],
    [p(1, 0, 0), p(1, 1, 0), p(1, 1, 1), p(1, 0, 1)],
  ];
  return Float32Array.from(quads.flatMap(([a, b, c, d]) => [...a!, ...b!, ...c!, ...a!, ...c!, ...d!]));
}

describe("mesh exports (#80)", () => {
  it("writes binary STL with the name in the header and reads it back", () => {
    const b: MeshBody[] = [{ name: "Cube", triangles: cube() }];
    const buf = writeStl("Bracket", b);
    expect(buf.byteLength).toBe(stlBytes(12));
    expect(new TextDecoder().decode(new Uint8Array(buf, 0, 17))).toBe("BetterCad Bracket");
    expect(new DataView(buf).getUint32(80, true)).toBe(12);
    // The first triangle is on the bottom: its normal points down.
    expect(new DataView(buf).getFloat32(84 + 8, true)).toBeCloseTo(-1);
    const back = readStl(buf);
    expect(meshVolume(back)).toBeCloseTo(1000, 3);
  });

  it("reads ASCII STL", () => {
    const text = `solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid t\n`;
    expect([...readStl(new TextEncoder().encode(text).buffer as ArrayBuffer)]).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    expect(() => readStl(new TextEncoder().encode("hello").buffer as ArrayBuffer)).toThrow("not an STL");
  });

  it("puts the lowest point on the bed", () => {
    const [b] = placeOnBed([{ name: "c", triangles: cube(5) }]);
    expect(Math.min(...[...b!.triangles].filter((_, i) => i % 3 === 2))).toBe(0);
  });

  it("writes a 3MF package in millimetres with one named object per body", () => {
    const data = write3mf("Bracket & co", [
      { name: "Base", triangles: cube(0) },
      { name: "Top", triangles: cube(20) },
    ]);
    const files = unzip(new Uint8Array(data));
    expect([...files.keys()]).toEqual(["[Content_Types].xml", "_rels/.rels", "3D/3dmodel.model"]);
    const model = new TextDecoder().decode(files.get("3D/3dmodel.model"));
    expect(model).toContain('unit="millimeter"');
    expect(model).toContain('<metadata name="Title">Bracket &amp; co</metadata>');
    expect(model.match(/<object /g)).toHaveLength(2);
    expect(model).toContain('<build><item objectid="1"/><item objectid="2"/></build>');
    // Corners are shared: 8 per cube.
    expect(model.match(/<vertex /g)).toHaveLength(16);
    const back = read3mf(data);
    expect(back.map((b) => b.name)).toEqual(["Base", "Top"]);
    expect(meshVolume(back[1]!.triangles)).toBeCloseTo(1000, 3);
  });

  it("zips and unzips, with the standard CRC", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    const z = zip([{ name: "a.txt", data: new TextEncoder().encode("hello") }]);
    expect(new TextDecoder().decode(unzip(z).get("a.txt"))).toBe("hello");
  });
});
