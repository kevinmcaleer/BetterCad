import { describe, expect, it } from "vitest";
import { boxMesh } from "@bettercad/kernel";
import { faceFrame, pointOnPicture } from "../decal/place";
import { pictureOnFace, type BoardPicture } from "./boardPicture";

/** A 50 by 40 mm board, 1.6 mm thick, as a box: face 0 is its bottom and face 1 its top. Its corner is moved to 0, 0. */
function boardMesh(shift: [number, number, number] = [0, 0, 0]) {
  const m = boxMesh({ x: 50, y: 40, z: 1.6 });
  const positions = new Float32Array(m.positions);
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] += 25 + shift[0];
    positions[i + 1] += 20 + shift[1];
    positions[i + 2] += shift[2];
  }
  return { ...m, positions };
}
const pic: BoardPicture = { url: "data:,", x: 0, y: 0, w: 50, h: 40 };
const near = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, 5));

describe("the board's picture on its faces", () => {
  it("lies on the top face the way the PCB view shows it", () => {
    const mesh = boardMesh([10, 5, 2]);
    const place = { position: { x: 10, y: 5, z: 2 } };
    const at = pictureOnFace(mesh, 1, pic, place, 1.6, false)!;
    expect(at).toMatchObject({ x: 0, y: 0, width: 50, height: 40, angle: 0 });
    expect(at.flip).toBeUndefined();
    const f = faceFrame(mesh, 1)!;
    // The picture's bottom left is the board's corner (0, 0); its top right is (50, 40).
    near(pointOnPicture(f, at, 0, 0), [10, 5, 3.6]);
    near(pointOnPicture(f, at, 1, 1), [60, 45, 3.6]);
  });

  it("lies on the bottom face mirrored, so each pad is under its own place", () => {
    const mesh = boardMesh();
    const at = pictureOnFace(mesh, 0, pic, { position: { x: 0, y: 0, z: 0 } }, 0, true)!;
    expect(at.flip).toBe(true);
    const f = faceFrame(mesh, 0)!;
    near(pointOnPicture(f, at, 0, 0), [0, 0, 0]);
    near(pointOnPicture(f, at, 1, 0), [50, 0, 0]);
    near(pointOnPicture(f, at, 0, 1), [0, 40, 0]);
  });

  it("says no when the face is not there", () => {
    expect(pictureOnFace(boardMesh(), 99, pic, { position: { x: 0, y: 0, z: 0 } }, 0, false)).toBeNull();
  });
});
