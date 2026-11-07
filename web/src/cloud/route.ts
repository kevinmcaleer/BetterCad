import { useEffect, useState } from "react";

/**
 * Hash routes, so the app runs from any static host: "#/" is the editor, then the pages of epic #9.
 * "#/edit/<id>" opens a saved model in the editor; "#/view/<token>" is a share link.
 */
export type Route =
  | { page: "editor"; model?: string }
  | { page: "signin"; next?: string }
  | { page: "signup"; next?: string }
  | { page: "account" }
  | { page: "library"; bin?: boolean }
  | { page: "view"; token: string }
  | { page: "gallery" };

export function parseRoute(hash: string): Route {
  const [path = "", query = ""] = hash.replace(/^#\/?/, "").split("?");
  const q = new URLSearchParams(query);
  const [head, arg] = path.split("/");
  const next = q.get("next") ?? undefined;
  switch (head) {
    case "signin":
      return { page: "signin", next };
    case "signup":
      return { page: "signup", next };
    case "account":
      return { page: "account" };
    case "library":
      return { page: "library", bin: arg === "bin" };
    case "edit":
      return arg ? { page: "editor", model: decodeURIComponent(arg) } : { page: "editor" };
    case "view":
      return arg ? { page: "view", token: decodeURIComponent(arg) } : { page: "editor" };
    case "gallery":
      return { page: "gallery" };
    default:
      return { page: "editor" };
  }
}

export function go(hash: string) {
  window.location.hash = hash;
}

export function useRoute(): Route {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const on = () => setHash(window.location.hash);
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return parseRoute(hash);
}
