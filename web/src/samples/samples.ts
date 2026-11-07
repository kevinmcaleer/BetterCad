import { SAMPLES, type SampleInfo } from "@bettercad/kernel/samples";

/**
 * The sample models (#99) the app ships in public/samples/: <id>.bcad and a <id>.png thumbnail, written by
 * `npm run build:samples`. Opening one loads it as a new, unsaved model.
 */
export type Sample = Omit<SampleInfo, "build">;
export const SAMPLE_LIST: readonly Sample[] = SAMPLES.map(({ id, name, blurb }) => ({ id, name, blurb }));

const base = () => import.meta.env.BASE_URL ?? "./";
export const sampleUrl = (id: string) => `${base()}samples/${id}.bcad`;
export const sampleThumb = (id: string) => `${base()}samples/${id}.png`;
export const isSample = (id: string) => SAMPLE_LIST.some((s) => s.id === id);
