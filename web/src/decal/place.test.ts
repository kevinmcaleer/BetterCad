import { describe, expect, it } from "vitest";
import { primitiveMesh } from "@bettercad/kernel";
import { decalFace, decalMesh, faceFrame, inFace, pictureAt, pointOnPicture, type Placement } from "./place";

// Faces: bottom, top, front (−Y), back (+Y), left (−X), right (+X); the box sits on z = 0.
const box = primitiveMesh("box", { x: 60, y: 40, z: 20 });
const at: Placement = { x: 0, y: 0, width: 40, height: 20, angle: 0 };
const close = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, 6));

describe("decal placement (#263)", () => {
  it("frames a top face with right along X, and a side face upright", () => {
    const top = faceFrame(box, 1)!;
    close(top.origin, [0, 0, 20]);
    close(top.normal, [0, 0, 1]);
    close(top.x, [1, 0, 0]);
    close(top.y, [0, 1, 0]);
    close(top.size, [60, 40]);
    const front = faceFrame(box, 2)!;
    close(front.origin, [0, -20, 10]);
    close(front.x, [1, 0, 0]);
    close(front.y, [0, 0, 1]);
    // Seen from outside the right-hand face, right is +Y and up is +Z.
    const right = faceFrame(box, 5)!;
    close(right.x, [0, 1, 0]);
    close(right.y, [0, 0, 1]);
  });

  it("follows the face when the box grows", () => {
    const tall = primitiveMesh("box", { x: 60, y: 40, z: 35 });
    close(faceFrame(tall, 1)!.origin, [0, 0, 35]);
  });

  it("says a round face isn't flat", () => {
    const can = primitiveMesh("cylinder", { x: 20, y: 20, z: 30 });
    const n = can.faceTris.length - 1;
    const flat = Array.from({ length: n }, (_, i) => !!faceFrame(can, i));
    expect(flat.filter(Boolean).length).toBe(2);
    expect(faceFrame(box, 99)).toBeNull();
  });

  it("maps the face to the picture: centred, moved, turned and flipped", () => {
    const top = faceFrame(box, 1)!;
    close(pictureAt(top, at, [0, 0, 20]), [0.5, 0.5]);
    close(pictureAt(top, at, [20, 10, 20]), [1, 1]);
    close(pictureAt(top, at, [-20, -10, 20]), [0, 0]);
    close(pictureAt(top, { ...at, x: 10 }, [10, 0, 20]), [0.5, 0.5]);
    // Turned 90° anticlockwise, the picture's right points along +Y.
    close(pictureAt(top, { ...at, angle: 90 }, [0, 20, 20]), [1, 0.5]);
    close(pictureAt(top, { ...at, flip: true }, [20, 10, 20]), [0, 1]);
  });

  it("finds the face's point at a spot on the picture, and back", () => {
    const top = faceFrame(box, 1)!;
    const d: Placement = { x: 5, y: -3, width: 30, height: 12, angle: 33, flip: true };
    const p = pointOnPicture(top, d, 0.2, 0.9);
    close(pictureAt(top, d, p), [0.2, 0.9]);
    close(inFace(top, pointOnPicture(top, d, 0.5, 0.5)), [5, -3]);
  });

  it("lays the picture on the face's own triangles, lifted off it, inside a clear margin", () => {
    const m = decalMesh(box, 1, faceFrame(box, 1)!, at, 0.1);
    expect(m.indices.length).toBe(6);
    expect(Math.max(...m.indices)).toBe(3);
    expect(m.positions[2]).toBeCloseTo(20.02, 6);
    // The face's corner (−30, −20) is off the picture: past the margin, in the clear border.
    const us = Array.from(m.uvs);
    expect(Math.min(...us)).toBeLessThan(0.1);
    close([us[0]!, us[1]!], [0.1 + 0.8 * ((-30 + 20) / 40), 0.1 + 0.8 * ((-20 + 10) / 20)]);
  });

  it("finds its face by name, and by number when the name has gone", () => {
    expect(decalFace({ face: 1, faceName: "f7" }, ["f0", "f7"])).toBe(1);
    expect(decalFace({ face: 1, faceName: "f7" }, ["f7", "f0"])).toBe(0);
    expect(decalFace({ face: 3, faceName: "gone" }, ["a"])).toBe(3);
    expect(decalFace({ face: 2 })).toBe(2);
  });
});
