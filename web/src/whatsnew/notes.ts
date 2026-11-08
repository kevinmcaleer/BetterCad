/**
 * Release notes: one Markdown file per merged change in ./notes, named `YYYY-MM-DD-short-name.md`, with the feature
 * name as its `# heading` and a sentence or two (or a short list) below. Vite bundles them into this module's chunk,
 * which only loads after first paint. See CONTRIBUTING.md, "Release notes".
 */
const FILES = import.meta.glob<string>("./notes/*.md", { query: "?raw", import: "default", eager: true });

export interface ReleaseNote {
  /** The file name without .md, such as "2026-11-08-mirror". Sorts by date. */
  id: string;
  /** YYYY-MM-DD, from the file name. */
  date: string;
  title: string;
  /** Markdown: paragraphs and "- " lists, with **bold** and `code`. */
  body: string;
}

export const NAME_PATTERN = /^(\d{4}-\d{2}-\d{2})-[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Reads one note file. Returns null for a file that doesn't follow the format (a test catches those). */
export function parseNote(id: string, text: string): ReleaseNote | null {
  const date = NAME_PATTERN.exec(id)?.[1];
  const m = /^#\s+(.+?)\s*\n([\s\S]*)$/.exec(text.replace(/\r\n/g, "\n").trimStart() + "\n");
  if (!date || !m) return null;
  return { id, date, title: m[1]!, body: m[2]!.trim() };
}

function load(files: Record<string, string>): ReleaseNote[] {
  return Object.entries(files)
    .map(([path, text]) => parseNote(path.replace(/^.*\//, "").replace(/\.md$/, ""), text))
    .filter((n): n is ReleaseNote => n !== null)
    .sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}

/** Every note, newest first. */
export const NOTES: readonly ReleaseNote[] = load(FILES);

/** Notes grouped by the day they were merged, newest day first. */
export function byDay(notes: readonly ReleaseNote[]): { date: string; notes: ReleaseNote[] }[] {
  const days: { date: string; notes: ReleaseNote[] }[] = [];
  for (const n of notes) {
    const last = days[days.length - 1];
    if (last?.date === n.date) last.notes.push(n);
    else days.push({ date: n.date, notes: [n] });
  }
  return days;
}

/** "8 November 2026". Built by hand so it reads the same in every locale and time zone. */
export function dayLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${d} ${months[(m ?? 1) - 1]} ${y}`;
}

export type Block = { kind: "p"; text: string } | { kind: "ul"; items: string[] };

/** Splits a note body into paragraphs and lists. Lines that run on join with a space. */
export function blocks(body: string): Block[] {
  const out: Block[] = [];
  for (const chunk of body.split(/\n\s*\n/)) {
    const lines = chunk
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (!lines.length) continue;
    if (lines[0]!.startsWith("- ")) {
      const items: string[] = [];
      for (const l of lines) {
        if (l.startsWith("- ")) items.push(l.slice(2).trim());
        else if (items.length) items[items.length - 1] += " " + l;
      }
      out.push({ kind: "ul", items });
    } else out.push({ kind: "p", text: lines.join(" ") });
  }
  return out;
}

export type Span = { kind: "text" | "strong" | "code"; text: string };

/** **bold** and `code` inside a line; everything else is plain text. */
export function spans(text: string): Span[] {
  const out: Span[] = [];
  const re = /\*\*(.+?)\*\*|`([^`]+)`/g;
  let at = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > at) out.push({ kind: "text", text: text.slice(at, m.index) });
    out.push(m[1] !== undefined ? { kind: "strong", text: m[1] } : { kind: "code", text: m[2]! });
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push({ kind: "text", text: text.slice(at) });
  return out;
}
