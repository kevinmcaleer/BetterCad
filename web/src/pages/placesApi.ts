import type { Api, Folder, ModelSummary, Place, Project } from "../cloud/api";

/** Folders and projects (#273, #274) on the server. Kept out of the shell: only the library loads it. */
export function placesApi(api: Api) {
  const { call } = api;
  const f = (id: string) => `folders/${encodeURIComponent(id)}`;
  const p = (id: string) => `projects/${encodeURIComponent(id)}`;
  const forever = (yes: boolean) => (yes ? "?forever=true" : "");
  return {
    move: (id: string, to: Place) => call<ModelSummary>("POST", `models/${encodeURIComponent(id)}/move`, to),
    /** Every folder and project; with `bin`, the ones put in the bin. */
    places: (bin = false) => call<{ folders: Folder[]; projects: Project[] }>("GET", `places${bin ? "?bin=true" : ""}`),
    newFolder: (name: string, where: { parent_id?: string | null; project_id?: string | null } = {}) => call<Folder>("POST", "folders", { name, ...where }),
    renameFolder: (id: string, name: string) => call<Folder>("PATCH", f(id), { name }),
    moveFolder: (id: string, to: Place) => call<Folder>("POST", `${f(id)}/move`, to),
    removeFolder: (id: string, yes = false) => call<{ ok: true }>("DELETE", f(id) + forever(yes)),
    restoreFolder: (id: string) => call<Folder>("POST", `${f(id)}/restore`),
    newProject: (name: string, readme = "") => call<Project>("POST", "projects", { name, readme }),
    project: (id: string) => call<Project>("GET", p(id)),
    /** Changes a project; `cover` is a picture as a data URL, or "" to take it off. */
    changeProject: (id: string, change: { name?: string; readme?: string; cover?: string }) => call<Project>("PATCH", p(id), change),
    removeProject: (id: string, yes = false) => call<{ ok: true }>("DELETE", p(id) + forever(yes)),
    restoreProject: (id: string) => call<Project>("POST", `${p(id)}/restore`),
  };
}
