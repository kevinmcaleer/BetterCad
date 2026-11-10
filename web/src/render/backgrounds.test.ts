import { describe, expect, it } from "vitest";
import { MeshStandardMaterial, Texture } from "three";
import { wallGrid } from "./backgrounds";

describe("wallGrid", () => {
  it("keeps one copy while the grid stays the same", () => {
    const m = new MeshStandardMaterial();
    const grid = new Texture();
    const a = wallGrid(m, grid);
    expect(wallGrid(m, grid)).toBe(a);
    expect(m.map).toBe(a);
    expect(m.emissiveMap).toBe(a);
  });

  it("copies the new grid when another gridded floor was shown first", () => {
    const m = new MeshStandardMaterial();
    const replicator = new Texture();
    const holoroom = new Texture();
    const first = wallGrid(m, replicator);
    const walls = wallGrid(m, holoroom);
    expect(walls).not.toBe(first);
    expect(walls.userData.from).toBe(holoroom);
    expect(m.map).toBe(walls);
    expect(m.emissiveMap).toBe(walls);
  });
});
