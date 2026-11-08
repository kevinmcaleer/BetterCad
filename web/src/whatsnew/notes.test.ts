import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NAME_PATTERN, NOTES, blocks, byDay, dayLabel, parseNote, spans } from "./notes";

const DIR = join(__dirname, "notes");
const files = readdirSync(DIR).filter((f) => !f.startsWith("."));

describe("release note files", () => {
  it.each(files)("%s follows the format", (file) => {
    expect(file, "name it YYYY-MM-DD-short-name.md").toMatch(/\.md$/);
    const id = file.replace(/\.md$/, "");
    expect(id, "name it YYYY-MM-DD-short-name.md, lower case").toMatch(NAME_PATTERN);
    const note = parseNote(id, readFileSync(join(DIR, file), "utf8"));
    expect(note, "start with a '# Feature name' line").not.toBeNull();
    const { title, body, date } = note!;
    expect(Number.isNaN(Date.parse(date)), "a real date").toBe(false);
    expect(title.length, "a short feature name, 60 characters at most").toBeLessThanOrEqual(60);
    expect(title, "sentence case: start with a capital").toMatch(/^[A-Z0-9]/);
    expect(title, "no full stop on the name").not.toMatch(/\.$/);
    expect(body.length, "a sentence or two under the name").toBeGreaterThan(0);
    expect(body.length, "keep it short: 400 characters at most").toBeLessThanOrEqual(400);
    expect(title + body, "the brand book: no exclamation marks").not.toContain("!");
  });

  it("loads every file, newest first", () => {
    expect(NOTES.length).toBe(files.length);
    const ids = NOTES.map((n) => n.id);
    expect(ids).toEqual([...ids].sort().reverse());
  });
});

describe("parseNote", () => {
  it("reads the name and body", () => {
    expect(parseNote("2026-11-08-mirror", "# Mirror across a face\n\nMirror bodies.\n")).toEqual({
      id: "2026-11-08-mirror",
      date: "2026-11-08",
      title: "Mirror across a face",
      body: "Mirror bodies.",
    });
  });
  it("refuses a file with no heading or a bad name", () => {
    expect(parseNote("2026-11-08-mirror", "Mirror bodies.")).toBeNull();
    expect(parseNote("mirror", "# Mirror\nBody")).toBeNull();
  });
});

describe("note bodies", () => {
  it("splits paragraphs and lists", () => {
    expect(blocks("One line\nruns on.\n\n- First\n- Second\n  more")).toEqual([
      { kind: "p", text: "One line runs on." },
      { kind: "ul", items: ["First", "Second more"] },
    ]);
  });
  it("finds bold and code", () => {
    expect(spans("Use **To object** or `Shift+R`.")).toEqual([
      { kind: "text", text: "Use " },
      { kind: "strong", text: "To object" },
      { kind: "text", text: " or " },
      { kind: "code", text: "Shift+R" },
      { kind: "text", text: "." },
    ]);
  });
  it("groups by day and names the day", () => {
    const n = (id: string) => parseNote(id, "# A\nB")!;
    expect(byDay([n("2026-11-09-b"), n("2026-11-08-b"), n("2026-11-08-a")]).map((d) => [d.date, d.notes.length])).toEqual([
      ["2026-11-09", 1],
      ["2026-11-08", 2],
    ]);
    expect(dayLabel("2026-11-08")).toBe("8 November 2026");
  });
});
