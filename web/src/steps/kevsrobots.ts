/**
 * Send to kevsrobots: the build steps .zip goes to one of your projects on kevsrobots Projects
 * (projects.kevsrobots.com), where it waits until you import it in the project's editor. Calls go straight from the
 * browser with the shared kevsrobots sign-in cookie, so they work only on a kevsrobots.com host.
 */

export const PROJECTS_API = "https://projects.kevsrobots.com";
export const PROJECTS_SITE = "https://www.kevsrobots.com";

/** One of your kevsrobots projects. */
export interface KrProject {
  id: number;
  title: string;
  status: string;
  cover_image: string | null;
}

/** What the project holds after a send: waiting to be imported. */
export interface KrImport {
  id: number;
  project_id: number;
  title: string;
  steps: number;
  pictures: number;
  files: number;
  /** An earlier send was imported, so this one updates it. */
  is_update: boolean;
}

/** The model's link to a project, kept in the model so the next send is an update. */
export interface KrLink {
  project: number;
  title: string;
  /** When the build steps were last sent, ISO time. */
  sent: string;
}

export class KrError extends Error {
  constructor(
    message: string,
    readonly status = 0,
  ) {
    super(message);
  }
}

/** The project's page in the kevsrobots editor, where the import waits. */
export const editorUrl = (project: number) => `${PROJECTS_SITE}/projects/editor.html?id=${project}`;

/** Titles there need 5 to 200 characters. */
export function titleProblem(title: string): string | null {
  const t = title.trim();
  if (t.length < 5) return "Use at least 5 characters.";
  if (t.length > 200) return "Use 200 characters or fewer.";
  return null;
}

async function call<T>(path: string, init: RequestInit = {}, fetcher: typeof fetch = fetch): Promise<T> {
  let r: Response;
  try {
    r = await fetcher(`${PROJECTS_API}${path}`, { credentials: "include", ...init });
  } catch {
    throw new KrError("kevsrobots.com can't be reached. Check your connection and try again.");
  }
  if (r.ok) return (await r.json()) as T;
  const detail = await r
    .json()
    .then((b: { detail?: unknown }) => (typeof b?.detail === "string" ? b.detail : null))
    .catch(() => null);
  if (r.status === 401) throw new KrError("Sign in with your kevsrobots account first.", 401);
  if (r.status === 403 && /terms/i.test(detail ?? ""))
    throw new KrError("Accept the kevsrobots terms first: open your projects on kevsrobots.com and agree to them.", 403);
  throw new KrError(detail ?? `kevsrobots.com said no (${r.status}).`, r.status);
}

export function kevsrobots(fetcher: typeof fetch = fetch) {
  return {
    /** Your projects, newest change first. */
    projects: () => call<KrProject[]>("/api/projects/my/list", {}, fetcher),
    /** A new draft project, tagged as made in BetterCad. */
    create: (title: string) =>
      call<KrProject>(
        "/api/projects",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: title.trim(), status: "draft", tags: ["bettercad", "3d-printing"] }),
        },
        fetcher,
      ),
    /** Sends the build steps .zip; it waits on the project until you import it there. */
    send: (project: number, name: string, bytes: Uint8Array, modelUrl?: string) => {
      const form = new FormData();
      form.append("file", new Blob([bytes.slice().buffer], { type: "application/zip" }), name);
      form.append("source", "bettercad");
      if (modelUrl) form.append("model_url", modelUrl);
      return call<KrImport>(`/api/projects/${project}/imports`, { method: "POST", body: form }, fetcher);
    },
  };
}

export type Kevsrobots = ReturnType<typeof kevsrobots>;
