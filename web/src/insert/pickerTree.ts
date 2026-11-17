import type { TreeItem } from "@bettercad/ui";
import type { ModelSummary } from "../cloud/api";
import { foldersIn, ROOT_NAME, type Here, type Tree } from "../pages/places";

/** Row ids: places and models share one tree, so each kind gets its own prefix. */
export const ROOT_ID = "root";
export const modelRowId = (id: string) => `m:${id}`;
export const modelOfRow = (rowId: string): string | null => (rowId.startsWith("m:") ? rowId.slice(2) : null);

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });

/**
 * The model picker's tree (#480): My models with its folders and models, then each project with its folders and
 * models. Places start folded, except My models; the open model is marked and can't go inside itself.
 */
export function pickerItems(tree: Tree, models: ModelSummary[], current?: string): TreeItem[] {
  const out: TreeItem[] = [];
  const live = models.filter((m) => !m.deleted_at);
  const modelsIn = (h: Here) =>
    live
      .filter((m) =>
        h.kind === "folder" ? m.folder_id === h.id : h.kind === "project" ? m.project_id === h.id && !m.folder_id : !m.folder_id && !m.project_id,
      )
      .sort(byName);
  const fill = (h: Here, parentId: string) => {
    for (const f of foldersIn(tree, h)) {
      const id = `f:${f.id}`;
      out.push({ id, name: f.name, icon: "folder", parentId, folded: true, kind: "folder", note: count(f.models) });
      fill({ kind: "folder", id: f.id }, id);
    }
    for (const m of modelsIn(h))
      out.push({
        id: modelRowId(m.id),
        name: m.name,
        icon: "component",
        parentId,
        kind: "model",
        note: m.id === current ? "Open now" : undefined,
      });
  };
  out.push({ id: ROOT_ID, name: ROOT_NAME, icon: "folder", kind: "place" });
  fill({ kind: "root" }, ROOT_ID);
  for (const p of [...tree.projects].filter((x) => !x.deleted_at).sort(byName)) {
    const id = `p:${p.id}`;
    out.push({ id, name: p.name, icon: "folder", folded: true, kind: "project", note: count(p.models) });
    fill({ kind: "project", id: p.id }, id);
  }
  return out;
}

const count = (n: number) => (n ? String(n) : undefined);

/** Models whose name has the words in `q`, with the places that hold them, so a search shows where each one is. */
export function filterItems(items: TreeItem[], q: string): TreeItem[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return items;
  const byId = new Map(items.map((i) => [i.id, i]));
  const keep = new Set<string>();
  for (const i of items) {
    if (!modelOfRow(i.id) || !words.every((w) => i.name.toLowerCase().includes(w))) continue;
    for (let at: TreeItem | undefined = i; at && !keep.has(at.id); at = at.parentId ? byId.get(at.parentId) : undefined) keep.add(at.id);
  }
  return items.filter((i) => keep.has(i.id)).map((i) => (i.folded ? { ...i, folded: false } : i));
}
