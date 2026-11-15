import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { Banner, Button, Dialog, ESC, Icon, MenuButton, cx, useEscape, type MenuEntry } from "@bettercad/ui";
import { fileName, saveBcad } from "@bettercad/kernel/bcad";
import { newDoc } from "../state/document";
import { ApiError, serverTime, type Folder, type ModelSummary, type Place, type Project, type Usage } from "../cloud/api";
import { offline } from "../cloud/offline";
import { useAccount } from "../cloud/account";
import { go } from "../cloud/route";
import { ago } from "../files/autosave";
import { formatBytes } from "../export/format";
import { Field, Page } from "./Page";
import { SampleCards } from "../samples/SampleCards";
import { Readme } from "./Readme";
import { placesApi } from "./placesApi";
import { ROOT_NAME, crumbs, foldersIn, hashOf, keyOf, placeName, placeOf, targets, within, type Here, type Tree } from "./places";

/**
 * My models (#89): cards with thumbnails, search and sort, rename in place, duplicate, download, and a 30-day bin.
 * Opening a card goes to "#/edit/<id>", which loads the model in the editor.
 *
 * Folders and projects (#273, #274): projects hold folders, folders nest, and a model lives in one place. The address
 * names the place ("#/library/folder/<id>", "#/library/project/<id>"), breadcrumbs lead back up, and models and folders
 * move by dragging onto a folder, project or breadcrumb, or with Move to… in their menu. Search covers every place.
 */

const MB = 1024 * 1024;
export const formatMB = (n: number) => `${n < 10 * MB ? (n / MB).toFixed(1).replace(/\.0$/, "") : Math.round(n / MB)} MB`;

/** What is being dragged, and what it can be dropped on. */
type Dragged = { kind: "model"; id: string; name: string } | { kind: "folder"; id: string; name: string };
const DRAG_TYPE = "application/x-bettercad-item";

function Thumb({ src, icon = "cube" }: { src: string | null; icon?: "cube" | "template" }) {
  const [state, setState] = useState<"loading" | "done" | "none">(src ? "loading" : "none");
  return (
    <span className={cx("bc-thumb", state === "loading" && "bc-loading")}>
      {src && state !== "none" ? (
        <img
          src={src}
          alt=""
          width={320}
          height={200}
          loading="lazy"
          onLoad={() => setState("done")}
          onError={() => setState("none")}
          // Not `hidden`: a lazy image with no box never loads, so the card would keep the cube for good.
          className={cx(state === "loading" && "bc-thumb-pending")}
        />
      ) : null}
      {state !== "done" && <Icon name={icon} size={40} />}
    </span>
  );
}

function RenameField({ name, onDone }: { name: string; onDone: (name: string | null) => void }) {
  const [value, setValue] = useState(name);
  useEscape(true, () => onDone(null), ESC.overlay);
  return (
    <input
      className="bc-text"
      aria-label="New name"
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={() => onDone(value.trim() && value.trim() !== name ? value.trim() : null)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
}

/** A name for a new folder or project. */
function NameDialog({
  title,
  icon,
  label,
  done,
  onDone,
  onCancel,
}: {
  title: string;
  icon: "folder" | "template";
  label: string;
  done: string;
  onDone: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const ok = () => name.trim() && onDone(name.trim());
  return (
    <Dialog open title={title} icon={icon} onCancel={onCancel} onDone={ok} doneLabel={done}>
      <Field label={label} autoFocus value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
    </Dialog>
  );
}

/** A cover picture, made small enough to store: at most 960 by 600, as a JPEG. */
async function coverFrom(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, 960 / img.naturalWidth, 600 / img.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function ProjectDialog({
  project,
  onSave,
  onCancel,
}: {
  project: Project;
  onSave: (change: { name: string; readme: string; cover?: string }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(project.name);
  const [readme, setReadme] = useState(project.readme);
  const [cover, setCover] = useState<string | undefined>(undefined);
  const [problem, setProblem] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const hasCover = cover === undefined ? !!project.cover : cover !== "";
  return (
    <Dialog
      open
      title="Edit project"
      icon="template"
      width={520}
      onCancel={onCancel}
      onDone={() => name.trim() && onSave({ name: name.trim(), readme, cover })}
      doneLabel="Save"
    >
      <Field label="Name" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
      <div className="bc-page-field">
        <label htmlFor="bc-readme">Readme</label>
        <textarea
          id="bc-readme"
          className="bc-text bc-lib-readme-field"
          rows={8}
          value={readme}
          maxLength={20000}
          aria-describedby="bc-readme-h"
          onChange={(e) => setReadme(e.target.value)}
          // Enter is a new line here, not Done.
          onKeyDown={(e) => e.key === "Enter" && e.stopPropagation()}
        />
        <span className="bc-page-hint" id="bc-readme-h">
          Markdown: # headings, - lists, **bold**, `code` and [links](https://…).
        </span>
      </div>
      <div className="bc-lib-cover-row">
        <Button icon="image" label={hasCover ? "Change cover picture" : "Add a cover picture"} onClick={() => file.current?.click()} />
        {hasCover && <Button icon="trash" label="Remove cover" onClick={() => setCover("")} />}
        {cover && <span className="bc-page-note">New picture ready to save</span>}
        <input
          ref={file}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          aria-label="Cover picture"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f)
              coverFrom(f).then(
                (c) => {
                  setCover(c);
                  setProblem(null);
                },
                () => setProblem("That picture can't be read. Try a PNG or JPEG."),
              );
          }}
        />
      </div>
      {problem && (
        <p className="bc-page-error" role="alert">
          {problem}
        </p>
      )}
    </Dialog>
  );
}

/** Move to…: every folder and project, with where the item is now and anywhere it can't go dimmed. */
function MoveDialog({ tree, item, from, onMove, onCancel }: { tree: Tree; item: Dragged; from: Place; onMove: (to: Place) => void; onCancel: () => void }) {
  const all = useMemo(() => targets(tree), [tree]);
  const blocked = useMemo(() => (item.kind === "folder" ? within(tree, item.id) : new Set<string>()), [tree, item]);
  const here = keyOf(from);
  const [pick, setPick] = useState<string | null>(null);
  const chosen = all.find((t) => t.key === pick);
  return (
    <Dialog open title={`Move ${item.name}`} icon="move" onCancel={onCancel} onDone={() => chosen && onMove(chosen.place)} doneLabel="Move here">
      <div role="radiogroup" aria-label="Move to" className="bc-lib-targets">
        {all.map((t) => {
          const off = t.key === here || (t.kind === "folder" && blocked.has(t.key.slice(2)));
          return (
            <label
              key={t.key}
              className={cx("bc-lib-target", off && "bc-off")}
              style={{ paddingInlineStart: `calc(var(--bc-space-4) + ${t.depth} * var(--bc-space-8))` }}
            >
              <input type="radio" name="move-to" disabled={off} checked={pick === t.key} onChange={() => setPick(t.key)} />
              <Icon name={t.kind === "folder" ? "folder" : t.kind === "project" ? "template" : "home"} />
              <span>{t.name}</span>
              {t.key === here && <span className="bc-page-note">Here now</span>}
            </label>
          );
        })}
      </div>
    </Dialog>
  );
}

/** Something a model or folder can be dropped on: a folder tile, a project card or a breadcrumb. */
function useDrop(onDrop: (d: Dragged) => void) {
  const [over, setOver] = useState(false);
  return {
    over,
    props: {
      onDragOver: (e: DragEvent) => {
        if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setOver(true);
      },
      onDragLeave: () => setOver(false),
      onDrop: (e: DragEvent) => {
        setOver(false);
        const raw = e.dataTransfer.getData(DRAG_TYPE);
        if (!raw) return;
        e.preventDefault();
        onDrop(JSON.parse(raw) as Dragged);
      },
    },
  };
}

const dragProps = (d: Dragged) => ({
  draggable: true,
  onDragStart: (e: DragEvent) => {
    e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(d));
    e.dataTransfer.effectAllowed = "move";
  },
});

function Crumb({ name, here, last, onDrop }: { name: string; here: Here; last: boolean; onDrop: (d: Dragged) => void }) {
  const drop = useDrop(onDrop);
  return (
    <li className={cx("bc-crumb", drop.over && "bc-drop")} {...(last ? {} : drop.props)}>
      {last ? <span aria-current="page">{name}</span> : <a href={hashOf(here)}>{name}</a>}
    </li>
  );
}

function FolderTile({
  folder,
  bin,
  renaming,
  entries,
  onOpen,
  onRename,
  onDrop,
}: {
  folder: Folder;
  bin: boolean;
  renaming: boolean;
  entries: MenuEntry[];
  onOpen: () => void;
  onRename: (name: string | null) => void;
  onDrop: (d: Dragged) => void;
}) {
  const drop = useDrop(onDrop);
  const count = [
    folder.folders ? `${folder.folders} ${folder.folders === 1 ? "folder" : "folders"}` : "",
    `${folder.models} ${folder.models === 1 ? "model" : "models"}`,
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <li
      className={cx("bc-folder", drop.over && "bc-drop")}
      {...(bin ? {} : { ...drop.props, ...dragProps({ kind: "folder", id: folder.id, name: folder.name }) })}
    >
      {renaming ? (
        <div className="bc-folder-open">
          <Icon name="folder" size={20} />
          <RenameField name={folder.name} onDone={onRename} />
        </div>
      ) : (
        <button
          type="button"
          className="bc-folder-open"
          aria-label={bin ? `${folder.name}, in the bin` : `Open folder ${folder.name}`}
          onClick={onOpen}
          disabled={bin}
        >
          <Icon name="folder" size={20} />
          <span className="bc-card-text">
            <span className="bc-card-name" title={folder.name}>
              {folder.name}
            </span>
            <span className="bc-card-time">{bin && folder.deleted_at ? ago(Date.now() - serverTime(folder.deleted_at)) : count}</span>
          </span>
        </button>
      )}
      <MenuButton
        label={`${folder.name} menu`}
        align="end"
        entries={entries}
        trigger={(t) => <Button {...t} icon="more" title={`More for ${folder.name}`} />}
      />
    </li>
  );
}

function ProjectCard({
  project,
  bin,
  cover,
  entries,
  onDrop,
}: {
  project: Project;
  bin: boolean;
  cover: string | null;
  entries: MenuEntry[];
  onDrop: (d: Dragged) => void;
}) {
  const drop = useDrop(onDrop);
  return (
    <li className={cx("bc-card", drop.over && "bc-drop")} {...(bin ? {} : drop.props)}>
      <button
        type="button"
        className="bc-card-open"
        aria-label={bin ? `${project.name}, in the bin` : `Open project ${project.name}`}
        onClick={() => !bin && go(hashOf({ kind: "project", id: project.id }))}
        disabled={bin}
      >
        <Thumb src={cover} icon="template" />
      </button>
      <div className="bc-card-foot">
        <div className="bc-card-text">
          <div className="bc-card-name" title={project.name}>
            {project.name}
          </div>
          <div className="bc-card-time">
            {bin && project.deleted_at ? ago(Date.now() - serverTime(project.deleted_at)) : `${project.models} ${project.models === 1 ? "model" : "models"}`}
          </div>
        </div>
        <MenuButton
          label={`${project.name} menu`}
          align="end"
          entries={entries}
          trigger={(t) => <Button {...t} icon="more" title={`More for ${project.name}`} />}
        />
      </div>
    </li>
  );
}

type Deleting = { kind: "model"; item: ModelSummary } | { kind: "folder"; item: Folder } | { kind: "project"; item: Project };

export function Library({ bin = false, folder, project }: { bin?: boolean; folder?: string; project?: string }) {
  const { api, account, ready } = useAccount();
  const places = useMemo(() => placesApi(api), [api]);
  const here: Here = folder ? { kind: "folder", id: folder } : project ? { kind: "project", id: project } : { kind: "root" };
  const [models, setModels] = useState<ModelSummary[] | null>(null);
  const [tree, setTree] = useState<Tree>({ folders: [], projects: [] });
  const [binned, setBinned] = useState<Tree>({ folders: [], projects: [] });
  const [usage, setUsage] = useState<Usage | null>(null);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"modified" | "name">("modified");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Deleting | null>(null);
  const [moving, setMoving] = useState<{ item: Dragged; from: Place } | null>(null);
  const [naming, setNaming] = useState<"folder" | "project" | null>(null);
  const [editing, setEditing] = useState(false);
  const [stale, setStale] = useState(false);
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    if (!account) return;
    try {
      const searching = !!q;
      const where = bin || searching ? {} : here.kind === "folder" ? { folder: here.id } : here.kind === "project" ? { project: here.id } : { top: true };
      const [list, use, tree_, inBin] = await Promise.all([
        api.list({ q, sort, bin, ...where }),
        api.usage(),
        // An older server has no folders yet: carry on with none.
        places.places().catch((e: unknown) => {
          if (e instanceof ApiError && e.status === 404) return { folders: [], projects: [] };
          throw e;
        }),
        bin ? places.places(true).catch(() => ({ folders: [], projects: [] })) : Promise.resolve(null),
      ]);
      setModels(list.models);
      setUsage(use);
      setTree(tree_);
      if (inBin) setBinned(inBin);
      setMissing(
        (here.kind === "folder" && !tree_.folders.some((f) => f.id === here.id)) || (here.kind === "project" && !tree_.projects.some((p) => p.id === here.id)),
      );
      setError(null);
      setStale(false);
      if (!q && !bin && here.kind === "root") void offline().rememberList(list.models);
    } catch (e) {
      // Offline (#96): the last list this browser saw, read-only.
      const last = e instanceof ApiError && e.status === 0 && !bin && here.kind === "root" ? await offline().lastList() : null;
      if (last) {
        setModels(q ? last.filter((m) => m.name.toLowerCase().includes(q.toLowerCase())) : last);
        setStale(true);
        setError(null);
      } else setError((e as Error).message);
    }
    // `here` is rebuilt every render; its parts are the dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, places, account, q, sort, bin, folder, project]);

  useEffect(() => {
    const t = setTimeout(() => void load(), q ? 200 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  const act = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn();
      setStatus(done);
      await load();
    } catch (e) {
      setStatus((e as Error).message);
    }
  };

  const create = () =>
    act(async () => {
      const m = await api.create("Untitled model", saveBcad(newDoc()), undefined, placeOf(tree, here));
      go(`#/edit/${m.id}`);
    }, "Made a new model");

  const download = async (m: ModelSummary) => {
    try {
      const full = await api.get(m.id);
      const url = URL.createObjectURL(new Blob([full.bcad], { type: "application/vnd.bettercad+json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName(m.name);
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus(`Downloaded ${fileName(m.name)}`);
    } catch (e) {
      setStatus((e as Error).message);
    }
  };

  /** Moves a dragged model or folder into a place; the place's name is for the status line. */
  const moveTo = (d: Dragged, to: Place) => {
    const name = placeName(tree, to);
    if (d.kind === "folder" && to.folder_id && within(tree, d.id).has(to.folder_id)) {
      setStatus("A folder can't go inside itself.");
      return;
    }
    void act(() => (d.kind === "model" ? places.move(d.id, to) : places.moveFolder(d.id, to)), `Moved ${d.name} to ${name}`);
  };

  if (!ready) return <Page title="My models">{null}</Page>;
  if (!account)
    return (
      <Page title="My models">
        <p>
          <a href="#/signin?next=%23%2Flibrary">Sign in</a> to see the models saved to your account. Without one, the editor saves to your disk.
        </p>
      </Page>
    );

  const path = crumbs(tree, here);
  const current = here.kind === "project" ? tree.projects.find((p) => p.id === here.id) : undefined;
  const searching = !!q;
  const folders = bin ? binned.folders : searching ? [] : foldersIn(tree, here);
  const projects = bin ? binned.projects : searching || here.kind !== "root" ? [] : tree.projects;
  const title = bin ? "Bin" : missing ? "Not found" : path.at(-1)!.name;

  const modelEntries = (m: ModelSummary): MenuEntry[] =>
    bin
      ? [
          { id: "restore", label: "Restore", icon: "undo", onSelect: () => void act(() => api.undelete(m.id), `Restored ${m.name}`) },
          {
            id: "forever",
            label: "Delete for ever",
            icon: "trash",
            danger: true,
            onSelect: () => void act(() => api.remove(m.id, true), `Deleted ${m.name} for ever`),
          },
        ]
      : [
          { id: "open", label: "Open", icon: "folder", onSelect: () => go(`#/edit/${m.id}`) },
          { id: "rename", label: "Rename", icon: "pencil", onSelect: () => setRenaming(m.id) },
          { id: "move", label: "Move to…", icon: "move", onSelect: () => setMoving({ item: { kind: "model", id: m.id, name: m.name }, from: m }) },
          { id: "duplicate", label: "Duplicate", icon: "copy", onSelect: () => void act(() => api.duplicate(m.id), `Made ${m.name} copy`) },
          { id: "download", label: "Download .bcad", icon: "download", onSelect: () => void download(m) },
          { kind: "separator", id: "s" },
          { id: "delete", label: "Delete…", icon: "trash", danger: true, onSelect: () => setDeleting({ kind: "model", item: m }) },
        ];

  const folderEntries = (f: Folder): MenuEntry[] =>
    bin
      ? [
          { id: "restore", label: "Restore", icon: "undo", onSelect: () => void act(() => places.restoreFolder(f.id), `Restored ${f.name}`) },
          {
            id: "forever",
            label: "Delete for ever",
            icon: "trash",
            danger: true,
            onSelect: () => void act(() => places.removeFolder(f.id, true), `Deleted ${f.name} for ever`),
          },
        ]
      : [
          { id: "open", label: "Open", icon: "folder", onSelect: () => go(hashOf({ kind: "folder", id: f.id })) },
          { id: "rename", label: "Rename", icon: "pencil", onSelect: () => setRenaming(f.id) },
          {
            id: "move",
            label: "Move to…",
            icon: "move",
            onSelect: () =>
              setMoving({ item: { kind: "folder", id: f.id, name: f.name }, from: f.parent_id ? { folder_id: f.parent_id } : { project_id: f.project_id } }),
          },
          { kind: "separator", id: "s" },
          { id: "delete", label: "Delete…", icon: "trash", danger: true, onSelect: () => setDeleting({ kind: "folder", item: f }) },
        ];

  const projectEntries = (p: Project): MenuEntry[] =>
    bin
      ? [
          { id: "restore", label: "Restore", icon: "undo", onSelect: () => void act(() => places.restoreProject(p.id), `Restored ${p.name}`) },
          {
            id: "forever",
            label: "Delete for ever",
            icon: "trash",
            danger: true,
            onSelect: () => void act(() => places.removeProject(p.id, true), `Deleted ${p.name} for ever`),
          },
        ]
      : [
          { id: "open", label: "Open", icon: "template", onSelect: () => go(hashOf({ kind: "project", id: p.id })) },
          { kind: "separator", id: "s" },
          { id: "delete", label: "Delete…", icon: "trash", danger: true, onSelect: () => setDeleting({ kind: "project", item: p }) },
        ];

  const empty = models && models.length === 0 && folders.length === 0 && projects.length === 0;

  return (
    <Page
      title={title}
      wide
      bar={
        <>
          <Button label="Editor" icon="cube" onClick={() => go("#/")} />
          <Button label="Account" icon="user" onClick={() => go("#/account")} />
        </>
      }
    >
      {!bin && path.length > 1 && (
        <nav aria-label="Breadcrumbs">
          <ol className="bc-crumbs">
            {path.map((c, i) => (
              <Crumb
                key={keyOf(placeOf(tree, c.here)) + i}
                name={c.name}
                here={c.here}
                last={i === path.length - 1}
                onDrop={(d) => moveTo(d, placeOf(tree, c.here))}
              />
            ))}
          </ol>
        </nav>
      )}
      {missing && !bin ? (
        <div className="bc-lib-empty">
          <p>{here.kind === "folder" ? "That folder isn't here. It may have been deleted." : "That project isn't here. It may have been deleted."}</p>
          <Button label={`Back to ${ROOT_NAME.toLowerCase()}`} onClick={() => go("#/library")} />
        </div>
      ) : (
        <>
          {current && (
            <section className="bc-lib-project" aria-label="About this project">
              {current.cover && <img className="bc-lib-cover" src={api.url(current.cover)} alt="" width={480} height={300} />}
              <div className="bc-lib-about">
                {current.readme.trim() ? (
                  <Readme src={current.readme} />
                ) : (
                  <p className="bc-page-note">No readme yet. Edit the project to say what it&rsquo;s for.</p>
                )}
                <h2 className="bc-lib-h">Members</h2>
                <ul className="bc-lib-members">
                  <li>
                    <Icon name="user" /> {account.username} <span className="bc-page-note">Owner</span>
                  </li>
                </ul>
                <div className="bc-lib-about-tools">
                  <Button icon="pencil" label="Edit project" onClick={() => setEditing(true)} />
                  <Button icon="trash" label="Delete project…" onClick={() => setDeleting({ kind: "project", item: current })} />
                </div>
              </div>
            </section>
          )}
          <div className="bc-lib-tools">
            {!bin && <Button variant="primary" icon="plus" label="New model" onClick={() => void create()} />}
            {!bin && <Button icon="folder" label="New folder" onClick={() => setNaming("folder")} />}
            {!bin && here.kind === "root" && <Button icon="template" label="New project" onClick={() => setNaming("project")} />}
            <input
              className="bc-text"
              type="search"
              aria-label="Search by name"
              placeholder={bin || here.kind === "root" ? "Search by name" : "Search all your models"}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <span role="group" aria-label="Sort" className="bc-segmented">
              <Button label="Recent" on={sort === "modified"} onClick={() => setSort("modified")} />
              <Button label="Name" on={sort === "name"} onClick={() => setSort("name")} />
            </span>
            <span className="bc-grow" />
            {bin ? (
              <Button label="Back to my models" onClick={() => go("#/library")} />
            ) : (
              <Button label="Bin" icon="trash" onClick={() => go("#/library/bin")} />
            )}
          </div>
          <p role="status" className="bc-page-note">
            {status}
          </p>
          {error && (
            <p className="bc-page-error" role="alert">
              {error}
            </p>
          )}
          {stale && <Banner tone="warn">You&rsquo;re offline. Showing your last synced models.</Banner>}
          {bin && <p className="bc-page-note">Things stay in the bin for 30 days, then they&rsquo;re deleted. A folder or project takes what&rsquo;s in it.</p>}
          {projects.length > 0 && (
            <>
              <h2 className="bc-lib-h">Projects</h2>
              <ul className="bc-lib-grid" aria-label={bin ? "Deleted projects" : "Your projects"}>
                {projects.map((p) => (
                  <ProjectCard
                    key={p.id}
                    project={p}
                    bin={bin}
                    cover={p.cover ? api.url(p.cover) : null}
                    entries={projectEntries(p)}
                    onDrop={(d) => moveTo(d, { project_id: p.id })}
                  />
                ))}
              </ul>
            </>
          )}
          {folders.length > 0 && (
            <>
              <h2 className="bc-lib-h">Folders</h2>
              <ul className="bc-lib-folders" aria-label={bin ? "Deleted folders" : "Folders"}>
                {folders.map((f) => (
                  <FolderTile
                    key={f.id}
                    folder={f}
                    bin={bin}
                    renaming={renaming === f.id}
                    entries={folderEntries(f)}
                    onOpen={() => go(hashOf({ kind: "folder", id: f.id }))}
                    onRename={(name) => {
                      setRenaming(null);
                      if (name) void act(() => places.renameFolder(f.id, name), `Renamed to ${name}`);
                    }}
                    onDrop={(d) => moveTo(d, { folder_id: f.id })}
                  />
                ))}
              </ul>
            </>
          )}
          {empty && (
            <div className="bc-lib-empty">
              <p>
                {bin
                  ? "The bin is empty."
                  : q
                    ? `No models match ‘${q}’.`
                    : here.kind === "folder"
                      ? "This folder is empty."
                      : here.kind === "project"
                        ? "No models in this project yet"
                        : "No models yet"}
              </p>
              {!bin && !q && <Button variant="primary" icon="plus" label="New model" onClick={() => void create()} />}
              {!bin && !q && here.kind === "root" && <SampleCards onOpen={(id) => go(`#/sample/${id}`)} title="Or start from a sample" />}
            </div>
          )}
          {models && models.length > 0 && (
            <>
              {(folders.length > 0 || projects.length > 0) && <h2 className="bc-lib-h">Models</h2>}
              <ul className="bc-lib-grid" aria-label={bin ? "Deleted models" : searching ? "Search results" : "Your models"}>
                {models.map((m) => (
                  <li key={m.id} className="bc-card" {...(bin ? {} : dragProps({ kind: "model", id: m.id, name: m.name }))}>
                    <button
                      type="button"
                      className="bc-card-open"
                      aria-label={bin ? `${m.name}, in the bin` : `Open ${m.name}`}
                      onClick={() => !bin && go(`#/edit/${m.id}`)}
                      disabled={bin}
                    >
                      <Thumb src={m.thumbnail ? api.url(m.thumbnail) : null} />
                    </button>
                    <div className="bc-card-foot">
                      <div className="bc-card-text">
                        {renaming === m.id ? (
                          <RenameField
                            name={m.name}
                            onDone={(name) => {
                              setRenaming(null);
                              if (name) void act(() => api.rename(m.id, name), `Renamed to ${name}`);
                            }}
                          />
                        ) : (
                          <div className="bc-card-name" title={m.name}>
                            {m.name}
                          </div>
                        )}
                        {searching && !bin && (
                          <div className="bc-card-time bc-card-place">
                            <Icon name={m.folder_id ? "folder" : m.project_id ? "template" : "home"} size={12} /> {placeName(tree, m)}
                          </div>
                        )}
                        <div className="bc-card-time">{ago(Date.now() - serverTime(bin && m.deleted_at ? m.deleted_at : m.modified))}</div>
                        {m.size != null && (
                          <div
                            className="bc-card-size"
                            title={m.versions && m.versions > 1 ? `${formatBytes(m.size)} across ${m.versions} versions` : undefined}
                          >
                            {formatBytes(m.size)}
                          </div>
                        )}
                      </div>
                      <MenuButton
                        label={`${m.name} menu`}
                        align="end"
                        entries={modelEntries(m)}
                        trigger={(t) => <Button {...t} icon="more" title={`More for ${m.name}`} />}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
      {usage && (
        <p className="bc-lib-usage">
          {usage.models} {usage.models === 1 ? "model" : "models"} · {formatMB(usage.bytes)} of {formatMB(usage.quota)}
        </p>
      )}
      {naming && (
        <NameDialog
          title={naming === "folder" ? "New folder" : "New project"}
          icon={naming === "folder" ? "folder" : "template"}
          label={naming === "folder" ? "Folder name" : "Project name"}
          done="Make"
          onCancel={() => setNaming(null)}
          onDone={(name) => {
            const kind = naming;
            setNaming(null);
            if (kind === "folder") {
              const at = placeOf(tree, here);
              void act(() => places.newFolder(name, { parent_id: at.folder_id ?? null, project_id: at.project_id ?? null }), `Made the folder ${name}`);
            } else
              void act(async () => {
                const p = await places.newProject(name);
                go(hashOf({ kind: "project", id: p.id }));
              }, `Made the project ${name}`);
          }}
        />
      )}
      {editing && current && (
        <ProjectDialog
          project={current}
          onCancel={() => setEditing(false)}
          onSave={(change) => {
            setEditing(false);
            void act(() => places.changeProject(current.id, change), "Saved the project");
          }}
        />
      )}
      {moving && (
        <MoveDialog
          tree={tree}
          item={moving.item}
          from={moving.from}
          onCancel={() => setMoving(null)}
          onMove={(to) => {
            const m = moving;
            setMoving(null);
            moveTo(m.item, to);
          }}
        />
      )}
      {deleting && (
        <Dialog
          open
          title={`Delete ${deleting.item.name}?`}
          icon="trash"
          onCancel={() => setDeleting(null)}
          footer={
            <>
              <Button kind="cancel" label="Cancel" onClick={() => setDeleting(null)} />
              <Button
                variant="danger"
                label="Delete"
                onClick={() => {
                  const d = deleting;
                  setDeleting(null);
                  const gone = `Moved ${d.item.name} to the bin`;
                  if (d.kind === "model") void act(() => api.remove(d.item.id), gone);
                  else if (d.kind === "folder") void act(() => places.removeFolder(d.item.id), gone);
                  else
                    void act(async () => {
                      await places.removeProject(d.item.id);
                      if (here.kind !== "root") go("#/library");
                    }, gone);
                }}
              />
            </>
          }
        >
          <p>
            {deleting.kind === "model"
              ? "It goes to the bin for 30 days, where you can restore it."
              : "It goes to the bin with everything in it for 30 days, where you can restore it."}
          </p>
        </Dialog>
      )}
      <footer className="bc-page-note bc-lib-foot">
        <a href="#/privacy">Privacy</a> · <a href="#/terms">Terms</a>
      </footer>
    </Page>
  );
}
