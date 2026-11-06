/**
 * Expressions for number fields, sketch dimensions (#5) and parameters (#7): numbers, + - * / ( ), unary minus,
 * an optional unit after a number (mm, cm, m, in, deg, °, %), and names looked up in a scope. No eval.
 */
export type Scope = Record<string, number>;

export class ExprError extends Error {}

const UNITS: Record<string, number> = { mm: 1, cm: 10, m: 1000, in: 25.4, deg: 1, "°": 1, "%": 1 };

type Tok = { t: "num"; v: number } | { t: "id"; v: string } | { t: "op"; v: string };

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const num = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(src.slice(i));
    if (num) {
      let v = Number(num[0]);
      i += num[0].length;
      const unit = /^\s*(mm|cm|m|in|deg|°|%)(?![a-z_])/i.exec(src.slice(i));
      if (unit) {
        v *= UNITS[unit[1]!.toLowerCase()]!;
        i += unit[0].length;
      }
      out.push({ t: "num", v });
      continue;
    }
    const id = /^[a-z_][a-z0-9_]*/i.exec(src.slice(i));
    if (id) {
      out.push({ t: "id", v: id[0] });
      i += id[0].length;
      continue;
    }
    if ("+-*/()".includes(c)) {
      out.push({ t: "op", v: c });
      i++;
      continue;
    }
    throw new ExprError(`Can't read ${src}`);
  }
  return out;
}

/** Evaluates an expression. Throws ExprError with a one-line message the field shows under itself. */
export function evaluate(src: string, scope: Scope = {}): number {
  const text = src.trim().replace(/^=/, "");
  if (!text) throw new ExprError("Type a number");
  const toks = lex(text);
  let p = 0;
  const peek = () => toks[p];
  const fail = (): never => {
    throw new ExprError(`Can't read ${text}`);
  };
  const isOp = (v: string) => {
    const t = peek();
    return t?.t === "op" && t.v === v;
  };
  function expr(): number {
    let v = term();
    while (isOp("+") || isOp("-")) {
      const op = (toks[p++] as { v: string }).v;
      const r = term();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  }
  function term(): number {
    let v = unary();
    while (isOp("*") || isOp("/")) {
      const op = (toks[p++] as { v: string }).v;
      const r = unary();
      if (op === "/" && r === 0) throw new ExprError("Can't divide by zero");
      v = op === "*" ? v * r : v / r;
    }
    return v;
  }
  function unary(): number {
    if (isOp("-")) {
      p++;
      return -unary();
    }
    if (isOp("+")) {
      p++;
      return unary();
    }
    return atom();
  }
  function atom(): number {
    const t = toks[p++];
    if (!t) return fail();
    if (t.t === "num") return t.v;
    if (t.t === "id") {
      if (!(t.v in scope)) throw new ExprError(`No value called ${t.v}`);
      return scope[t.v]!;
    }
    if (t.v === "(") {
      const v = expr();
      if (!isOp(")")) fail();
      p++;
      return v;
    }
    return fail();
  }
  const v = expr();
  if (p !== toks.length || !Number.isFinite(v)) fail();
  return v;
}

/** True when the text is more than a plain number, so the field should remember it. */
export function isExpression(src: string): boolean {
  return !/^\s*-?(\d+\.?\d*|\.\d+)\s*(mm|deg|°)?\s*$/.test(src);
}
