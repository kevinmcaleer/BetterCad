import { SAMPLES, type SampleInfo } from "@bettercad/kernel/samples";

/**
 * The sample models (#99) the app ships in public/samples/: <id>.bcad and a <id>.png thumbnail, written by
 * `npm run build:samples`. Opening one loads it as a new, unsaved model.
 */
export type Sample = Omit<SampleInfo, "build">;
const ALL: readonly Sample[] = SAMPLES.map(({ id, name, blurb, card }) => ({ id, name, blurb, card }));
/** The ones on the sample cards; the hole calibration coupon opens from the Print panel. */
export const SAMPLE_LIST: readonly Sample[] = ALL.filter((s) => s.card !== false);

const base = () => import.meta.env.BASE_URL ?? "./";
export const sampleUrl = (id: string) => `${base()}samples/${id}.bcad`;
export const sampleThumb = (id: string) => `${base()}samples/${id}.png`;
export const isSample = (id: string) => ALL.some((s) => s.id === id);
