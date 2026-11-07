import type { Route } from "./route";

/** The page a route counts as (#111). */
export function pageOf(route: Route): string {
  if (route.page === "editor") return route.sample ? "sample" : "editor";
  return route.page;
}

const KEY = "bettercad.pinged";

/**
 * Page counts (#111): once per page per browser session, the app tells the server which page opened. No cookie and
 * nothing about the person; a missing server is fine.
 */
export function ping(route: Route, send: (page: string) => Promise<unknown> = post): boolean {
  if (route.page === "gallery") return false;
  const page = pageOf(route);
  let seen: string[] = [];
  try {
    seen = JSON.parse(sessionStorage.getItem(KEY) ?? "[]") as string[];
  } catch {
    // No storage: count it every time rather than never.
  }
  if (seen.includes(page)) return false;
  try {
    sessionStorage.setItem(KEY, JSON.stringify([...seen, page]));
  } catch {
    // As above.
  }
  send(page).catch(() => undefined);
  return true;
}

function post(page: string) {
  return fetch("api/ping", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ route: page }),
    credentials: "omit",
    keepalive: true,
  });
}
