import { Matrix4 } from "three";
import { quickMesh } from "../files/importFiles";
import { renderThumbnail, type ThumbnailOptions } from "../render/thumbnail";

/** An uploaded file's picture: its triangles stood as the import stands them, path traced like a saved model's. */
export function meshThumbnail(meshes: Float32Array[], o: ThumbnailOptions = {}): Promise<string | null> {
  const identity = new Matrix4();
  return renderThumbnail(
    meshes.map((t, i) => ({ id: `b${i}`, mesh: quickMesh(t, meshes), matrix: identity })),
    o,
  );
}
