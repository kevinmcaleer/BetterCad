import { useEffect, useState } from "react";

/**
 * Hash routes, so the app runs from any static host: "#/" is the editor, then the pages of epic #9.
 * "#/edit/<id>" opens a saved model in the editor; "#/view/<token>" is a share link; "#/sample/<id>" opens a sample (#99).
 * "#/forgot" asks for a reset email, and "#/reset-password#token=<t>" is the link in it.
 */
export type Route =
  | { page: "editor"; model?: string; sample?: string }
  | { page: "signin"; next?: string }
  | { page: "signup"; next?: string }
  | { page: "account" }
  | { page: "forgot" }
  | { page: "reset"; token: string }
  | { page: "library"; bin?: boolean }
  | { page: "view"; token: string }
  | { page: "gallery" }
  | { page: "privacy" }
  | { page: "terms" };

export function parseRoute(hash: string): Route {
  const [path = "", query = ""] = hash.replace(/^#\/?/, "").split("?");
  const q = new URLSearchParams(query);
  // A password reset email links to "#/reset-password#token=…": the token stays out of server logs.
  const [route = "", fragment = ""] = path.split("#");
  const [head, arg] = route.split("/");
  const next = q.get("next") ?? undefined;
  switch (head) {
    case "signin":
      return { page: "signin", next };
    case "signup":
      return { page: "signup", next };
    case "account":
      return { page: "account" };
    case "forgot":
      return { page: "forgot" };
    case "reset-password": {
      const token = new URLSearchParams(fragment).get("token");
      return token ? { page: "reset", token } : { page: "forgot" };
    }
    case "library":
      return { page: "library", bin: arg === "bin" };
    case "edit":
      return arg ? { page: "editor", model: decodeURIComponent(arg) } : { page: "editor" };
    case "sample":
      return arg ? { page: "editor", sample: decodeURIComponent(arg) } : { page: "editor" };
    case "view":
      return arg ? { page: "view", token: decodeURIComponent(arg) } : { page: "editor" };
    case "gallery":
      return { page: "gallery" };
    case "privacy":
      return { page: "privacy" };
    case "terms":
      return { page: "terms" };
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
