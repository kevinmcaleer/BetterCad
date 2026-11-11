import type { BodyMesh } from "@bettercad/kernel";

/**
 * Meshes drawn for an imported STL or 3MF while the geometry engine is still sewing it into a solid, so the model
 * shows the moment the file is read. Keyed by the file's blob and the body's place in it; the import drops them once
 * the engine's mesh is on show.
 */
export const quickMeshes = new Map<string, BodyMesh>();

export const quickKey = (blob: string, index: number) => `${blob}:${index}`;
