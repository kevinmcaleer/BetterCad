/** The names of picked edges or faces (#47), when the kernel named every one of them: stored beside their numbers. */
export function pickNames(names: { faces: string[]; edges: string[] } | undefined, kind: "faces" | "edges", refs: number[]): string[] | undefined {
  const list = names?.[kind];
  if (!list || !refs.length) return undefined;
  const out = refs.map((i) => list[i]);
  return out.every((n): n is string => n !== undefined) ? out : undefined;
}
