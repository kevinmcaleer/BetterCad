import type { Folder, Place, Project } from "../cloud/api";

/**
 * Folders and projects (#273, #274) as the library draws them: breadcrumbs, what's inside a place, a place's name for
 * search results, and the list Move to… offers. Projects hold folders; a folder carries its project.
 */

export interface Tree {
  folders: Folder[];
  projects: Project[];
}

/** Where the library is looking. */
export type Here = { kind: "root" } | { kind: "folder"; id: string } | { kind: "project"; id: string };

export const ROOT_NAME = "My models";

export const hashOf = (h: Here) => (h.kind === "root" ? "#/library" : `#/library/${h.kind}/${encodeURIComponent(h.id)}`);

/** Where a new model or folder made here goes. */
export function placeOf(tree: Tree, h: Here): Place {
  if (h.kind === "folder") return { folder_id: h.id, project_id: tree.folders.find((f) => f.id === h.id)?.project_id ?? null };
  if (h.kind === "project") return { project_id: h.id };
  return {};
}

/** The places from My models down to here, the last one being here. */
export function crumbs(tree: Tree, h: Here): { here: Here; name: string }[] {
  const out: { here: Here; name: string }[] = [];
  if (h.kind === "folder") {
    let f = tree.folders.find((x) => x.id === h.id);
    const seen = new Set<string>();
    while (f && !seen.has(f.id)) {
      seen.add(f.id);
      out.unshift({ here: { kind: "folder", id: f.id }, name: f.name });
      const parent = f.parent_id;
      f = parent ? tree.folders.find((x) => x.id === parent) : undefined;
    }
    const top = tree.folders.find((x) => x.id === h.id);
    const p = top?.project_id ? tree.projects.find((x) => x.id === top.project_id) : undefined;
    if (p) out.unshift({ here: { kind: "project", id: p.id }, name: p.name });
  } else if (h.kind === "project") {
    const p = tree.projects.find((x) => x.id === h.id);
    if (p) out.push({ here: h, name: p.name });
  }
  out.unshift({ here: { kind: "root" }, name: ROOT_NAME });
  return out;
}

/** The folders directly inside a place, by name. */
export function foldersIn(tree: Tree, h: Here): Folder[] {
  const inside = (f: Folder) =>
    h.kind === "folder" ? f.parent_id === h.id : h.kind === "project" ? f.project_id === h.id && !f.parent_id : !f.project_id && !f.parent_id;
  return tree.folders.filter(inside).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
}

/** A model's or folder's place as words: "Rover / Arm", or "My models". */
export function placeName(tree: Tree, p: Place): string {
  if (p.folder_id)
    return (
      crumbs(tree, { kind: "folder", id: p.folder_id })
        .slice(1)
        .map((c) => c.name)
        .join(" / ") || ROOT_NAME
    );
  if (p.project_id) return tree.projects.find((x) => x.id === p.project_id)?.name ?? ROOT_NAME;
  return ROOT_NAME;
}

/** A folder and every folder inside it. */
export function within(tree: Tree, folderId: string): Set<string> {
  const out = new Set([folderId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of tree.folders)
      if (f.parent_id && out.has(f.parent_id) && !out.has(f.id)) {
        out.add(f.id);
        grew = true;
      }
  }
  return out;
}

export interface Target {
  key: string;
  name: string;
  depth: number;
  kind: Here["kind"];
  place: Place;
}

/** Every place something can move to, in tree order: My models and its folders, then each project and its folders. */
export function targets(tree: Tree): Target[] {
  const out: Target[] = [{ key: "root", name: ROOT_NAME, depth: 0, kind: "root", place: {} }];
  const walk = (h: Here, depth: number) => {
    for (const f of foldersIn(tree, h)) {
      out.push({ key: `f:${f.id}`, name: f.name, depth, kind: "folder", place: { folder_id: f.id, project_id: f.project_id } });
      walk({ kind: "folder", id: f.id }, depth + 1);
    }
  };
  walk({ kind: "root" }, 1);
  for (const p of [...tree.projects].sort((a, b) => a.name.localeCompare(b.name))) {
    out.push({ key: `p:${p.id}`, name: p.name, depth: 0, kind: "project", place: { project_id: p.id } });
    walk({ kind: "project", id: p.id }, 1);
  }
  return out;
}

/** The target key for a place, to mark where something is now. */
export function keyOf(p: Place): string {
  return p.folder_id ? `f:${p.folder_id}` : p.project_id ? `p:${p.project_id}` : "root";
}
