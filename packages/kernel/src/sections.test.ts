import { describe, expect, it } from "vitest";
import { appliedSection, applySection, newDoc, nextSectionName, parseDoc, removeSection, renameSection, saveSection, type SectionAnalysis } from "./document";

const cut = (id: string, name: string, offset = 0): SectionAnalysis => ({ id, name, origin: [0, 0, 5], normal: [0, 0, 1], offset });

describe("section analyses", () => {
  it("saves a section and applies it", () => {
    const d = saveSection(newDoc(), cut("s1", "Section 1"));
    expect(d.sections).toHaveLength(1);
    expect(appliedSection(d)?.id).toBe("s1");
  });

  it("applies only one at a time", () => {
    let d = saveSection(newDoc(), cut("s1", "Section 1"));
    d = saveSection(d, cut("s2", "Section 2"));
    expect(appliedSection(d)?.id).toBe("s2");
    d = applySection(d, "s1");
    expect(appliedSection(d)?.id).toBe("s1");
    expect(d.sections).toHaveLength(2);
    d = applySection(d, null);
    expect(appliedSection(d)).toBeNull();
    expect("section" in d).toBe(false);
  });

  it("updates a section in place", () => {
    let d = saveSection(newDoc(), cut("s1", "Section 1"));
    d = saveSection(d, cut("s1", "Section 1", 4));
    expect(d.sections).toEqual([cut("s1", "Section 1", 4)]);
  });

  it("ignores an unknown id", () => {
    const d = saveSection(newDoc(), cut("s1", "Section 1"));
    expect(applySection(d, "nope")).toBe(d);
  });

  it("removes, renames and names the next one", () => {
    let d = saveSection(newDoc(), cut("s1", "Section 1"));
    d = saveSection(d, cut("s2", "Section 2"));
    expect(nextSectionName(d)).toBe("Section 3");
    d = renameSection(d, "s1", " Bearing seat ");
    expect(d.sections![0]!.name).toBe("Bearing seat");
    expect(renameSection(d, "s1", "  ")).toBe(d);
    d = removeSection(d, "s2");
    expect(appliedSection(d)).toBeNull();
    expect(nextSectionName(d)).toBe("Section 1");
    d = removeSection(d, "s1");
    expect(d.sections).toBeUndefined();
  });

  it("is saved with the model", () => {
    const d = saveSection(newDoc(), cut("s1", "Section 1", 2));
    const back = parseDoc(JSON.stringify(d));
    expect(appliedSection(back)).toEqual(cut("s1", "Section 1", 2));
  });
});
