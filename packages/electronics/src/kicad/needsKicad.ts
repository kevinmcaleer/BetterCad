import { it } from "vitest";

/**
 * For the tests that run against real KiCad (#759). On a machine without it they skip; the nightly KiCad run sets
 * `KICAD_REQUIRED`, and there a missing KiCad, or missing demos, is a failure, so a broken image can't pass by
 * skipping everything.
 */
export function needsKicad(has: boolean, what: string): void {
  if (has || !process.env.KICAD_REQUIRED) return;
  it(`has ${what}`, () => {
    throw new Error(`${what} is missing here, and KICAD_REQUIRED is set`);
  });
}
