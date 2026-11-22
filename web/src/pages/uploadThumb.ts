import { Matrix4 } from "three";
import { quickMesh } from "../files/importFiles";
import { renderThumbnail, type ThumbnailOptions } from "../render/thumbnail";
import type { ModelDoc } from "../state/document";
import type { Engine } from "./upload";

/** An uploaded file's picture: its triangles stood as the import stands them, path traced like a saved model's. */
export function meshThumbnail(meshes: Float32Array[], o: ThumbnailOptions = {}): Promise<string | null> {
  const identity = new Matrix4();
  return renderThumbnail(
    meshes.map((t, i) => ({ id: `b${i}`, mesh: quickMesh(t, meshes), matrix: identity })),
    o,
  );
}

/** A model's picture from the geometry engine's build of it: a STEP file, or a .bcad that came without one. */
export async function docThumbnail(doc: ModelDoc, engine: Engine, o: ThumbnailOptions = {}): Promise<string | null> {
  const built = await engine("build", { doc });
  const identity = new Matrix4();
  return renderThumbnail(
    built.bodies.map((b) => ({ id: b.id, mesh: b.mesh, matrix: identity })),
    o,
  );
}
