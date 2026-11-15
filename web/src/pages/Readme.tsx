import { Fragment, type ReactNode } from "react";

/**
 * A project's readme (#274): a small, safe slice of Markdown. Headings (#, ##, ###), "- " lists and paragraphs, with
 * **bold**, `code` and [links](https://…). Everything is text: no HTML is ever passed through.
 */

export type ReadmeBlock = { kind: "h"; level: 1 | 2 | 3; text: string } | { kind: "p"; text: string } | { kind: "ul"; items: string[] };

export function readmeBlocks(src: string): ReadmeBlock[] {
  const out: ReadmeBlock[] = [];
  let para: string[] = [];
  let list: string[] | null = null;
  const flush = () => {
    if (para.length) out.push({ kind: "p", text: para.join(" ") });
    para = [];
    if (list) out.push({ kind: "ul", items: list });
    list = null;
  };
  for (const raw of src.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    const h = /^(#{1,3})\s+(.+)$/.exec(line);
    const li = /^[-*]\s+(.+)$/.exec(line);
    if (!line) flush();
    else if (h) {
      flush();
      out.push({ kind: "h", level: h[1]!.length as 1 | 2 | 3, text: h[2]! });
    } else if (li) {
      if (para.length) flush();
      (list ??= []).push(li[1]!);
    } else {
      if (list) flush();
      para.push(line);
    }
  }
  flush();
  return out;
}

const INLINE = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;

export function Inline({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let at = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index! > at) parts.push(text.slice(at, m.index));
    if (m[1]) parts.push(<strong key={m.index}>{m[1]}</strong>);
    else if (m[2]) parts.push(<code key={m.index}>{m[2]}</code>);
    else
      parts.push(
        <a key={m.index} href={m[4]} target="_blank" rel="noopener noreferrer">
          {m[3]}
        </a>,
      );
    at = m.index! + m[0].length;
  }
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts.map((p, i) => (typeof p === "string" ? <Fragment key={`t${i}`}>{p}</Fragment> : p))}</>;
}

/** Headings start at h2, under the page's own h1. */
export function Readme({ src }: { src: string }) {
  return (
    <div className="bc-readme">
      {readmeBlocks(src).map((b, i) => {
        if (b.kind === "h") {
          const H = (["h2", "h3", "h4"] as const)[b.level - 1]!;
          return (
            <H key={i}>
              <Inline text={b.text} />
            </H>
          );
        }
        if (b.kind === "p")
          return (
            <p key={i}>
              <Inline text={b.text} />
            </p>
          );
        return (
          <ul key={i}>
            {b.items.map((t, j) => (
              <li key={j}>
                <Inline text={t} />
              </li>
            ))}
          </ul>
        );
      })}
    </div>
  );
}
