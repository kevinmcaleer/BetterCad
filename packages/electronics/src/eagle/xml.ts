/**
 * Just enough XML to read Eagle's files (#665): elements, attributes and text. No namespaces, no DTD beyond skipping
 * the one Eagle names, no entities but the five XML has and numbered ones.
 */
export interface El {
  tag: string;
  attrs: Record<string, string>;
  kids: El[];
  /** The text straight inside the element, with its entities read. */
  text: string;
}

const NAMED: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
const plain = (s: string) =>
  s.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (all, e: string) => {
    if (e[0] !== "#") return NAMED[e] ?? all;
    const code = e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
  });

/** Reads a document and gives its root element. Throws with the place when the text is not well formed. */
export function parseXml(src: string): El {
  const root: El = { tag: "", attrs: {}, kids: [], text: "" };
  const open: El[] = [root];
  let i = 0;
  const n = src.length;
  const fail = (why: string): never => {
    const line = src.slice(0, i).split("\n").length;
    throw new Error(`The file is not XML that can be read: ${why} on line ${line}`);
  };
  while (i < n) {
    const lt = src.indexOf("<", i);
    const top = open[open.length - 1]!;
    if (lt < 0) {
      top.text += plain(src.slice(i));
      break;
    }
    if (lt > i) top.text += plain(src.slice(i, lt));
    i = lt;
    if (src.startsWith("<!--", i)) {
      const end = src.indexOf("-->", i + 4);
      if (end < 0) fail("a comment does not end");
      i = end + 3;
    } else if (src.startsWith("<![CDATA[", i)) {
      const end = src.indexOf("]]>", i + 9);
      if (end < 0) fail("a CDATA block does not end");
      top.text += src.slice(i + 9, end);
      i = end + 3;
    } else if (src.startsWith("<?", i)) {
      const end = src.indexOf("?>", i + 2);
      if (end < 0) fail("a declaration does not end");
      i = end + 2;
    } else if (src.startsWith("<!", i)) {
      // A DOCTYPE, with or without rules of its own inside square brackets.
      let depth = 0;
      let j = i + 2;
      for (; j < n; j += 1) {
        if (src[j] === "[") depth += 1;
        else if (src[j] === "]") depth -= 1;
        else if (src[j] === ">" && depth <= 0) break;
      }
      if (j >= n) fail("the DOCTYPE does not end");
      i = j + 1;
    } else if (src[i + 1] === "/") {
      const end = src.indexOf(">", i);
      if (end < 0) fail("a closing tag does not end");
      const tag = src.slice(i + 2, end).trim();
      if (open.length < 2 || top.tag !== tag) fail(`</${tag}> closes nothing`);
      open.pop();
      i = end + 1;
    } else {
      const m = /^<([^\s/>]+)/.exec(src.slice(i, i + 200));
      if (!m) fail("a tag has no name");
      const el: El = { tag: m![1]!, attrs: {}, kids: [], text: "" };
      i += m![0].length;
      for (;;) {
        while (i < n && /\s/.test(src[i]!)) i += 1;
        if (src[i] === ">") {
          i += 1;
          top.kids.push(el);
          open.push(el);
          break;
        }
        if (src[i] === "/" && src[i + 1] === ">") {
          i += 2;
          top.kids.push(el);
          break;
        }
        const eq = src.indexOf("=", i);
        if (eq < 0 || i >= n) fail(`<${el.tag}> does not end`);
        const name = src.slice(i, eq).trim();
        let j = eq + 1;
        while (j < n && /\s/.test(src[j]!)) j += 1;
        const quote = src[j];
        if (quote !== '"' && quote !== "'") fail(`${name} in <${el.tag}> has no quoted value`);
        const end = src.indexOf(quote!, j + 1);
        if (end < 0) fail(`${name} in <${el.tag}> does not end`);
        el.attrs[name] = plain(src.slice(j + 1, end));
        i = end + 1;
      }
    }
  }
  if (open.length > 1) fail(`<${open[open.length - 1]!.tag}> is never closed`);
  const first = root.kids[0];
  if (!first) throw new Error("The file is not XML that can be read: it has no elements");
  return first;
}

/** The first child with a tag. */
export const kid = (el: El | undefined, tag: string): El | undefined => el?.kids.find((k) => k.tag === tag);
/** Every child with a tag. */
export const kids = (el: El | undefined, tag: string): El[] => el?.kids.filter((k) => k.tag === tag) ?? [];
/** A number from an attribute; `or` when it is missing or not a number. */
export const numOf = (el: El | undefined, name: string, or = 0): number => {
  const v = el?.attrs[name];
  if (v === undefined || v === "") return or;
  const x = Number(v);
  return Number.isFinite(x) ? x : or;
};
