/** Joins class names, skipping falsy ones. */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/** "Fit the parts in the picture" + "F" → "Fit the parts in the picture (F)". */
export function withShortcut(title: string | undefined, shortcut: string | undefined): string | undefined {
  if (!title) return shortcut ? `(${shortcut})` : undefined;
  return shortcut ? `${title} (${shortcut})` : title;
}
