"""Folders and projects (#273, #274; epic #271).

Projects hold folders: a project is one build's space with a readme and a cover picture; folders nest inside a project
or at the top of My models. `GET /api/places` answers every folder and project at once, so the library can draw
breadcrumbs, a Move to… list and search results' places without asking again. Binning a folder or project bins what
is in it; restoring brings that back, and something whose parent has gone since lands one level up.
"""

import secrets
import sqlite3

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field

from . import where
from .auth import CurrentUser, Writer, conn
from .models import THUMB, THUMB_BYTES, image, tag

README_CHARS = 20_000


class NewFolder(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    parent_id: str | None = None
    project_id: str | None = None


class FolderChange(BaseModel):
    name: str = Field(min_length=1, max_length=200)


class Move(BaseModel):
    """Where to: a folder (and its project), a project's top level, or My models when both are empty."""

    folder_id: str | None = None
    project_id: str | None = None


class NewProject(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    readme: str = Field(default="", max_length=README_CHARS)


class ProjectChange(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    readme: str | None = Field(default=None, max_length=README_CHARS)
    #: A PNG, JPEG or WebP data URL, or "" to take the cover off.
    cover: str | None = Field(default=None, max_length=THUMB_BYTES)


def folder_json(row: sqlite3.Row, counts: dict[str, tuple[int, int]] | None = None) -> dict:
    models, folders = (counts or {}).get(row["id"], (0, 0))
    return {
        "id": row["id"],
        "name": row["name"],
        "parent_id": row["parent_id"],
        "project_id": row["project_id"],
        "created": row["created"],
        "modified": row["modified"],
        "deleted_at": row["deleted_at"],
        "models": models,
        "folders": folders,
    }


def project_json(row: sqlite3.Row, models: int = 0) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "readme": row["readme"],
        "cover": f"/api/projects/{row['id']}/cover?h={tag(row['cover'])}" if row["cover"] else None,
        "created": row["created"],
        "modified": row["modified"],
        "deleted_at": row["deleted_at"],
        "models": models,
    }


def router(settings) -> APIRouter:
    r = APIRouter(prefix="/api", tags=["places"])

    def new_id() -> str:
        return secrets.token_urlsafe(9)

    def touch(db: sqlite3.Connection, table: str, row_id: str) -> None:
        db.execute(f"UPDATE {table} SET modified = {where.NOW} WHERE id = ?", (row_id,))

    @r.get("/places")
    def places(request: Request, user: CurrentUser, bin: bool = False) -> dict:
        """Every live folder and project with what's directly in it; with `bin`, what was put in the bin itself."""
        db = conn(request)
        if bin:
            fs = db.execute(
                "SELECT * FROM folders WHERE user_id = ? AND deleted_at IS NOT NULL AND binned_by IS NULL"
                " ORDER BY deleted_at DESC",
                (user.id,),
            )
            ps = db.execute(
                "SELECT * FROM projects WHERE user_id = ? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC", (user.id,)
            )
            return {"folders": [folder_json(f) for f in fs], "projects": [project_json(p) for p in ps]}
        counts: dict[str, tuple[int, int]] = {}
        for row in db.execute(
            "SELECT f.id, (SELECT COUNT(*) FROM models m WHERE m.folder_id = f.id AND m.deleted_at IS NULL),"
            " (SELECT COUNT(*) FROM folders c WHERE c.parent_id = f.id AND c.deleted_at IS NULL)"
            " FROM folders f WHERE f.user_id = ? AND f.deleted_at IS NULL",
            (user.id,),
        ):
            counts[row[0]] = (row[1], row[2])
        fs = db.execute(
            "SELECT * FROM folders WHERE user_id = ? AND deleted_at IS NULL ORDER BY name COLLATE NOCASE, id", (user.id,)
        )
        ps = db.execute(
            "SELECT p.*, (SELECT COUNT(*) FROM models m WHERE m.project_id = p.id AND m.deleted_at IS NULL) AS n"
            " FROM projects p WHERE p.user_id = ? AND p.deleted_at IS NULL ORDER BY p.modified DESC, p.id",
            (user.id,),
        )
        return {"folders": [folder_json(f, counts) for f in fs], "projects": [project_json(p, p["n"]) for p in ps]}

    # --- Folders (#273) ---------------------------------------------------------------------------------------

    @r.post("/folders", status_code=201)
    def new_folder(body: NewFolder, request: Request, user: Writer) -> dict:
        db = conn(request)
        parent, project_id = where.resolve(db, user.id, body.parent_id, body.project_id)
        folder_id = new_id()
        with db:
            db.execute(
                "INSERT INTO folders (id, user_id, project_id, parent_id, name) VALUES (?, ?, ?, ?, ?)",
                (folder_id, user.id, project_id, parent, body.name.strip()),
            )
        return folder_json(where.folder(db, user.id, folder_id))

    @r.patch("/folders/{folder_id}")
    def rename_folder(folder_id: str, body: FolderChange, request: Request, user: Writer) -> dict:
        db = conn(request)
        where.folder(db, user.id, folder_id)
        with db:
            db.execute(f"UPDATE folders SET name = ?, modified = {where.NOW} WHERE id = ?", (body.name.strip(), folder_id))
        return folder_json(where.folder(db, user.id, folder_id))

    @r.post("/folders/{folder_id}/move")
    def move_folder(folder_id: str, body: Move, request: Request, user: Writer) -> dict:
        db = conn(request)
        where.folder(db, user.id, folder_id)
        parent, project_id = where.resolve(db, user.id, body.folder_id, body.project_id)
        inner = where.subtree(db, folder_id)
        if parent in inner:
            raise HTTPException(422, "A folder can't go inside itself.")
        with db:
            db.execute(f"UPDATE folders SET parent_id = ?, modified = {where.NOW} WHERE id = ?", (parent, folder_id))
            where.set_project(db, inner, project_id)
        return folder_json(where.folder(db, user.id, folder_id))

    @r.delete("/folders/{folder_id}")
    def delete_folder(folder_id: str, request: Request, user: Writer, forever: bool = False) -> dict:
        db = conn(request)
        where.folder(db, user.id, folder_id, binned=None)
        with db:
            if forever:
                where.forget_folder(db, folder_id)
            else:
                where.bin_folder(db, folder_id)
        return {"ok": True}

    @r.post("/folders/{folder_id}/restore")
    def restore_folder(folder_id: str, request: Request, user: Writer) -> dict:
        db = conn(request)
        f = where.folder(db, user.id, folder_id, binned=True)
        with db:
            # A parent that has gone since: one level up, out of the project too if that has gone.
            parent = f["parent_id"] if where.live_folder(db, f["parent_id"]) else None
            project_id = f["project_id"] if where.live_project(db, f["project_id"]) else None
            db.execute("UPDATE folders SET deleted_at = NULL, binned_by = NULL, parent_id = ? WHERE id = ?", (parent, folder_id))
            where.restore_with(db, folder_id)
            if project_id != f["project_id"]:
                where.set_project(db, where.subtree(db, folder_id), project_id)
        return folder_json(where.folder(db, user.id, folder_id))

    # --- Projects (#274) --------------------------------------------------------------------------------------

    @r.post("/projects", status_code=201)
    def new_project(body: NewProject, request: Request, user: Writer) -> dict:
        db = conn(request)
        project_id = new_id()
        with db:
            db.execute(
                "INSERT INTO projects (id, user_id, name, readme) VALUES (?, ?, ?, ?)",
                (project_id, user.id, body.name.strip(), body.readme),
            )
        return project_json(where.project(db, user.id, project_id))

    def counted(db: sqlite3.Connection, user_id: int, project_id: str) -> dict:
        p = where.project(db, user_id, project_id)
        n = db.execute("SELECT COUNT(*) FROM models WHERE project_id = ? AND deleted_at IS NULL", (project_id,)).fetchone()[0]
        return project_json(p, n)

    @r.get("/projects/{project_id}")
    def get_project(project_id: str, request: Request, user: CurrentUser) -> dict:
        return counted(conn(request), user.id, project_id)

    @r.patch("/projects/{project_id}")
    def change_project(project_id: str, body: ProjectChange, request: Request, user: Writer) -> dict:
        db = conn(request)
        where.project(db, user.id, project_id)
        if body.cover and not THUMB.match(body.cover):
            raise HTTPException(422, "That isn't a picture.")
        sets, args = [], []
        if body.name is not None:
            sets.append("name = ?")
            args.append(body.name.strip())
        if body.readme is not None:
            sets.append("readme = ?")
            args.append(body.readme)
        if body.cover is not None:
            sets.append("cover = ?")
            args.append(body.cover or None)
        if sets:
            with db:
                db.execute(f"UPDATE projects SET {', '.join(sets)}, modified = {where.NOW} WHERE id = ?", (*args, project_id))
        return counted(db, user.id, project_id)

    @r.get("/projects/{project_id}/cover")
    def cover(project_id: str, request: Request, user: CurrentUser) -> Response:
        p = where.project(conn(request), user.id, project_id, binned=None)
        return image(p["cover"], "private, max-age=86400")

    @r.delete("/projects/{project_id}")
    def delete_project(project_id: str, request: Request, user: Writer, forever: bool = False) -> dict:
        db = conn(request)
        where.project(db, user.id, project_id, binned=None)
        with db:
            if forever:
                where.forget_project(db, project_id)
            else:
                where.bin_project(db, project_id)
        return {"ok": True}

    @r.post("/projects/{project_id}/restore")
    def restore_project(project_id: str, request: Request, user: Writer) -> dict:
        db = conn(request)
        where.project(db, user.id, project_id, binned=True)
        with db:
            db.execute("UPDATE projects SET deleted_at = NULL WHERE id = ?", (project_id,))
            where.restore_with(db, project_id)
            touch(db, "projects", project_id)
        return counted(db, user.id, project_id)

    return r
