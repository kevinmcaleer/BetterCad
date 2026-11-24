/** Parts you placed lately and parts you starred, by id, kept in this browser. */
const KEYS = { recent: "bettercad.electronics.recent", starred: "bettercad.electronics.starred" } as const;
const MAX_RECENT = 8;

function read(key: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "[]") as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function write(key: string, ids: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(ids));
  } catch {
    // Private windows may refuse: the lists are a convenience, so carry on without them.
  }
}

export const recentParts = (): string[] => read(KEYS.recent);
export const starredParts = (): string[] => read(KEYS.starred);

export function noteRecent(id: string): string[] {
  const next = [id, ...read(KEYS.recent).filter((x) => x !== id)].slice(0, MAX_RECENT);
  write(KEYS.recent, next);
  return next;
}

export function toggleStar(id: string): string[] {
  const now = read(KEYS.starred);
  const next = now.includes(id) ? now.filter((x) => x !== id) : [...now, id];
  write(KEYS.starred, next);
  return next;
}
