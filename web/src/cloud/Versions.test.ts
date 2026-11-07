import { describe, expect, it } from "vitest";
import { groupVersions } from "./Versions";
import type { VersionInfo } from "./api";

const v = (number: number, note: string | null = null): VersionInfo => ({ number, note, size: 10, created: "2026-11-07 09:00:00", thumbnail: null });

describe("version history", () => {
  it("folds runs of autosaves into one row, keeping the newest on its own", () => {
    const rows = groupVersions([v(7, "autosave"), v(6, "autosave"), v(5, "autosave"), v(4, "Added holes"), v(3, "autosave"), v(2), v(1)]);
    expect(rows.map((r) => (r.kind === "one" ? r.v.number : r.list.map((x) => x.number)))).toEqual([7, [6, 5], 4, 3, 2, 1]);
  });
});
