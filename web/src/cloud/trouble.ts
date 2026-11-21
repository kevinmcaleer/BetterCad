import { ApiError, OFFLINE, type Api } from "./api";
import { go } from "./route";

/**
 * What went wrong reaching your account, told apart so the page can say so and offer the way back: being offline
 * (Retry, and it reloads by itself when the connection is back), the server not answering (Retry), or a sign-in that
 * has run out (Log in again). Anything else is an ordinary error and gets null.
 */
export type Trouble = { kind: "offline" | "unreachable" | "signin"; text: string };

export function trouble(e: unknown, online = typeof navigator === "undefined" ? true : navigator.onLine): Trouble | null {
  if (!(e instanceof ApiError)) return null;
  if (e.status === 401) return { kind: "signin", text: "Your sign-in has run out." };
  if (e.status === 0) {
    if (!online) return { kind: "offline", text: "You’re offline." };
    const n = e.noAnswer;
    if (n?.why === "no-server")
      return {
        kind: "unreachable",
        text: n.http >= 500 ? `BetterCad’s server isn’t answering just now (error ${n.http}).` : "BetterCad’s server isn’t answering just now.",
      };
    return { kind: "unreachable", text: "BetterCad’s server can’t be reached just now. Your connection looks fine." };
  }
  if (e.status >= 500)
    return { kind: "unreachable", text: e.message && e.message !== OFFLINE ? e.message : `BetterCad’s server isn’t answering just now (error ${e.status}).` };
  return null;
}

/** Straight to kevsrobots.com's sign-in, which sends you back to `back`; BetterCad's sign-in page if that can't be asked. */
export async function logInAgain(api: Api, back = window.location.hash || "#/library") {
  try {
    const { signin_url } = await api.links(back);
    if (signin_url) return window.location.assign(signin_url);
  } catch {
    // Fall through to BetterCad's own sign-in page.
  }
  go(`#/signin?next=${encodeURIComponent(back)}`);
}
