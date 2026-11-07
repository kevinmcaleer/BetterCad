import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LIBRARIES } from "./about";

describe("About", () => {
  it("lists every main library THIRD_PARTY_LICENSES.md does, with the same licence", () => {
    const md = readFileSync(join(__dirname, "..", "..", "..", "THIRD_PARTY_LICENSES.md"), "utf8");
    const rows = md
      .split("## Every runtime dependency")[0]!
      .split("\n")
      .filter((l) => l.startsWith("| ") && !l.startsWith("| Library") && !l.startsWith("| ---"));
    expect(rows.length).toBe(LIBRARIES.length);
    for (const lib of LIBRARIES) {
      const row = rows.find((r) => r.includes(lib.name));
      expect(row, lib.name).toBeDefined();
      expect(row!.split("|")[3]!.trim()).toContain(lib.licence.split(" / ")[0]!);
    }
  });
});

describe("THIRD_PARTY_LICENSES.md", () => {
  it("names every main library's package in the generated list", () => {
    const md = readFileSync(join(__dirname, "..", "..", "..", "THIRD_PARTY_LICENSES.md"), "utf8");
    for (const pkg of ["replicad-opencascadejs", "@salusoft89/planegcs", "three", "react", "fastapi"]) expect(md).toContain(`| ${pkg} |`);
  });
});
