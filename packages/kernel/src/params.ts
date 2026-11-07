import { ExprError, evaluate, type Scope } from "@bettercad/ui/expr";

/**
 * Parameters (#75): named values with expressions, used by feature fields. Each feature keeps the expression typed
 * into a field in `exprs` (by field path, such as "distance" or "size.x"); the build puts the parameter values in
 * before it replays the feature, so changing `width` reshapes everything that uses it.
 */
export type ParamUnit = "mm" | "deg" | "none";

export interface Parameter {
  id: string;
  name: string;
  expression: string;
  unit: ParamUnit;
  comment?: string;
}

export interface ParamValues {
  values: Scope;
  /** Why a parameter has no value, by id. */
  errors: Map<string, string>;
}

export const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** The names an expression uses. */
export function namesIn(expression: string): string[] {
  // Units after numbers ("5 mm") are not names: drop number+unit runs first.
  const text = expression.replace(/(\d+\.?\d*|\.\d+)(e[+-]?\d+)?\s*(mm|cm|m|in|deg|%)(?![A-Za-z0-9_])/gi, "0");
  return [...new Set(text.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [])];
}

/** Works every parameter out in dependency order, catching cycles, missing names and mixed units. */
export function evaluateParams(params: Parameter[] = []): ParamValues {
  const byName = new Map(params.map((p) => [p.name, p]));
  const values: Scope = {};
  const errors = new Map<string, string>();
  const state = new Map<string, "busy" | "done">();
  const visit = (p: Parameter, stack: string[]): boolean => {
    const s = state.get(p.name);
    if (s === "done") return p.name in values;
    if (s === "busy") {
      const loop = stack.slice(stack.indexOf(p.name));
      const text = loop.length === 1 ? `${p.name} uses itself` : `${loop.map((n) => `\`${n}\``).join(" and ")} depend on each other`;
      for (const n of loop) {
        const q = byName.get(n);
        if (q) errors.set(q.id, text);
      }
      return false;
    }
    state.set(p.name, "busy");
    let ok = true;
    for (const n of namesIn(p.expression)) {
      const q = byName.get(n);
      if (!q) continue;
      if (!visit(q, [...stack, p.name])) ok = false;
      else if (p.unit !== "none" && q.unit !== "none" && q.unit !== p.unit) {
        errors.set(p.id, `${q.name} is ${q.unit === "deg" ? "an angle" : "a length"}, and ${p.name} is ${p.unit === "deg" ? "an angle" : "a length"}`);
        ok = false;
      }
    }
    state.set(p.name, "done");
    if (!ok) {
      if (!errors.has(p.id)) errors.set(p.id, "It uses a parameter that has a problem");
      return false;
    }
    try {
      values[p.name] = evaluate(p.expression, values);
      return true;
    } catch (e) {
      errors.set(p.id, e instanceof ExprError ? e.message : `Can't read ${p.expression}`);
      return false;
    }
  };
  for (const p of params) visit(p, []);
  return { values, errors };
}

/** Sets a value at a dotted path on a copy ("size.x"), leaving the original alone. */
export function setPath<T extends object>(obj: T, path: string, value: number): T {
  const [head, ...rest] = path.split(".");
  const o = obj as Record<string, unknown>;
  if (!rest.length) return { ...o, [head!]: value } as T;
  return { ...o, [head!]: setPath((o[head!] as object) ?? {}, rest.join("."), value) } as T;
}

/** A feature with its expressions worked out against the parameters; failures leave the stored number. */
export function bindExprs<F extends { exprs?: Record<string, string> }>(f: F, values: Scope): { feature: F; error?: string } {
  if (!f.exprs) return { feature: f };
  let out = f;
  let error: string | undefined;
  for (const [path, expr] of Object.entries(f.exprs)) {
    try {
      out = setPath(out, path, evaluate(expr, values));
    } catch (e) {
      error ??= e instanceof ExprError ? e.message : `Can't read ${expr}`;
    }
  }
  return { feature: out, error };
}

/** Renames a name inside an expression, whole words only. */
export function renameIn(expression: string, from: string, to: string): string {
  return expression.replace(new RegExp(`(?<![A-Za-z0-9_])${from}(?![A-Za-z0-9_])`, "g"), to);
}
