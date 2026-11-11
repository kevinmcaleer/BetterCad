import { blobHash, toBase64 } from "@bettercad/kernel";
import type { DecalImage } from "../state/document";

/** The pictures a decal takes. */
export const PICTURE_TYPES = ["image/png", "image/jpeg", "image/svg+xml"];
/** Bigger pictures make the model heavy to save and share. */
export const MAX_PICTURE_BYTES = 4 * 1024 * 1024;

/** A decal's picture as a data: URL, from its bytes in the document's blobs. */
export const pictureUrl = (image: Pick<DecalImage, "type">, base64: string) => `data:${image.type};base64,${base64}`;

/** Reads a picture file for a decal: its bytes (base64) and what the document keeps about it, or why it can't. */
export async function readPicture(file: File): Promise<{ image: DecalImage; data: string } | string> {
  const type = file.type || (/\.svg$/i.test(file.name) ? "image/svg+xml" : /\.jpe?g$/i.test(file.name) ? "image/jpeg" : "image/png");
  if (!PICTURE_TYPES.includes(type)) return "Decals take PNG, JPG or SVG pictures";
  if (file.size > MAX_PICTURE_BYTES) return "That picture is over 4 MB. Try a smaller one";
  const bytes = new Uint8Array(await file.arrayBuffer());
  const data = toBase64(bytes);
  const size = await pictureSize(pictureUrl({ type }, data));
  if (!size) return "That picture couldn't be read";
  return { image: { blob: blobHash(bytes), type, file: file.name, width: size[0], height: size[1] }, data };
}

/** A picture's size in pixels; an SVG without one counts as square. */
function pictureSize(url: string): Promise<[number, number] | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve([img.naturalWidth || 512, img.naturalHeight || 512]);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** The size a new decal starts at on a face: up to 40 mm wide, and no more than 60% of the face either way. */
export function firstSize(image: Pick<DecalImage, "width" | "height">, face: [number, number]): { width: number; height: number } {
  const aspect = image.height / Math.max(1, image.width);
  let width = Math.min(40, face[0] * 0.6);
  if (width * aspect > face[1] * 0.6) width = (face[1] * 0.6) / aspect;
  width = Math.max(1, Math.round(width * 10) / 10);
  return { width, height: Math.round(width * aspect * 10) / 10 };
}
