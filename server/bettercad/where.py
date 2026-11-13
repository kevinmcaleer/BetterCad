"""Where models live (#273, #274): My models, a folder, or a project. Plain helpers over one connection, used by the
model, folder and project routes. Another user's ids answer 404, like models.
"""

import sqlite3

from fastapi import HTTPException

NOW = "strftime('%Y-%m-%d %H:%M:%f', 'now')"
FOLDER_GONE = "That folder isn't here. It may have been deleted."
PROJECT_GONE = "That project isn't here. It may have been deleted."


def folder(db: sqlite3.Connection, user_id: int, folder_id: str, binned: bool | None = False) -> sqlite3.Row:
    row = db.execute("SELECT * FROM folders WHERE id = ? AND user_id = ?", (folder_id, user_id)).fetchone()
    if not row or (binned is not None and bool(row["deleted_at"]) != binned):
        raise HTTPException(404, FOLDER_GONE)
    return row


def project(db: sqlite3.Connection, user_id: int, project_id: str, binned: bool | None = False) -> sqlite3.Row:
    row = db.execute("SELECT * FROM projects WHERE id = ? AND user_id = ?", (project_id, user_id)).fetchone()
    if not row or (binned is not None and bool(row["deleted_at"]) != binned):
        raise HTTPException(404, PROJECT_GONE)
    return row


def resolve(db: sqlite3.Connection, user_id: int, folder_id: str | None, project_id: str | None) -> tuple[str | None, str | None]:
    """The (folder, project) a move or a new model lands in. A folder brings its project; neither is My models."""
    if folder_id:
        f = folder(db, user_id, folder_id)
        return f["id"], f["project_id"]
    if project_id:
        return None, project(db, user_id, project_id)["id"]
    return None, None


def subtree(db: sqlite3.Connection, folder_id: str) -> list[str]:
    """The folder and every folder inside it, binned or not."""
    rows = db.execute(
        "WITH RECURSIVE t(id) AS (SELECT ? UNION ALL SELECT f.id FROM folders f JOIN t ON f.parent_id = t.id) SELECT id FROM t",
        (folder_id,),
    )
    return [r[0] for r in rows]


def marks(ids: list[str]) -> str:
    return ",".join("?" * len(ids))


def set_project(db: sqlite3.Connection, folders: list[str], project_id: str | None) -> None:
    """Moves these folders and the models in them into a project (or out of any)."""
    if folders:
        db.execute(f"UPDATE folders SET project_id = ? WHERE id IN ({marks(folders)})", (project_id, *folders))
        db.execute(f"UPDATE models SET project_id = ? WHERE folder_id IN ({marks(folders)})", (project_id, *folders))


def bin_folder(db: sqlite3.Connection, folder_id: str) -> None:
    """Puts a folder in the bin with everything in it that isn't there already."""
    inner = subtree(db, folder_id)
    db.execute(f"UPDATE folders SET deleted_at = {NOW}, binned_by = NULL WHERE id = ?", (folder_id,))
    rest = inner[1:]
    if rest:
        db.execute(
            f"UPDATE folders SET deleted_at = {NOW}, binned_by = ? WHERE deleted_at IS NULL AND id IN ({marks(rest)})",
            (folder_id, *rest),
        )
    bin_models(db, folder_id, f"folder_id IN ({marks(inner)})", inner)


def bin_project(db: sqlite3.Connection, project_id: str) -> None:
    db.execute(f"UPDATE projects SET deleted_at = {NOW} WHERE id = ?", (project_id,))
    db.execute(
        f"UPDATE folders SET deleted_at = {NOW}, binned_by = ? WHERE deleted_at IS NULL AND project_id = ?",
        (project_id, project_id),
    )
    bin_models(db, project_id, "project_id = ?", [project_id])


def bin_models(db: sqlite3.Connection, by: str, where: str, args: list) -> None:
    db.execute(f"DELETE FROM shares WHERE model_id IN (SELECT id FROM models WHERE deleted_at IS NULL AND {where})", args)
    db.execute(f"UPDATE models SET deleted_at = {NOW}, binned_by = ? WHERE deleted_at IS NULL AND {where}", (by, *args))


def restore_with(db: sqlite3.Connection, by: str) -> None:
    """Brings back what went to the bin with a folder or project."""
    db.execute("UPDATE folders SET deleted_at = NULL, binned_by = NULL WHERE binned_by = ?", (by,))
    db.execute("UPDATE models SET deleted_at = NULL, binned_by = NULL WHERE binned_by = ?", (by,))


def forget_folder(db: sqlite3.Connection, folder_id: str) -> None:
    """Deletes a folder for ever, with every folder and model inside it."""
    inner = subtree(db, folder_id)
    db.execute(f"DELETE FROM models WHERE folder_id IN ({marks(inner)}) OR binned_by IN ({marks(inner)})", (*inner, *inner))
    db.execute("DELETE FROM folders WHERE id = ?", (folder_id,))


def forget_project(db: sqlite3.Connection, project_id: str) -> None:
    """Deletes a project for ever, with every folder and model in it."""
    db.execute("DELETE FROM models WHERE project_id = ? OR binned_by = ?", (project_id, project_id))
    db.execute("DELETE FROM projects WHERE id = ?", (project_id,))


def live_folder(db: sqlite3.Connection, folder_id: str | None) -> bool:
    return bool(folder_id) and bool(
        db.execute("SELECT 1 FROM folders WHERE id = ? AND deleted_at IS NULL", (folder_id,)).fetchone()
    )


def live_project(db: sqlite3.Connection, project_id: str | None) -> bool:
    return bool(project_id) and bool(
        db.execute("SELECT 1 FROM projects WHERE id = ? AND deleted_at IS NULL", (project_id,)).fetchone()
    )
