"""Saved models, their versions, share links and import blobs (#87, #92).

Every save is a version. A model row holds the name, the latest version number and its thumbnail; each version
holds the .bcad text, zlib-compressed. Another user's ids answer 404, never 403, so ids leak nothing.
"""

import base64
import binascii
import json
import re
import secrets
import shutil
import sqlite3
import time
import zlib
from collections import defaultdict, deque
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Header, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field

from .auth import CurrentUser, User, Writer, conn

HASH = re.compile(r"^[A-Za-z0-9_-]{8,128}$")
THUMB = re.compile(r"^data:(image/(?:png|jpeg|webp));base64,(.+)$", re.S)
WRITES_PER_MINUTE = 60
NOT_FOUND = "That model isn't here. It may have been deleted."
THUMB_BYTES = 256 * 1024


def tag(thumb: str) -> str:
    """A short tag for a thumbnail, so its URL changes when a rendered picture replaces it and caches miss."""
    return format(zlib.crc32(thumb.encode()), "08x")


class Limiter:
    """Writes per user per minute, in memory: the app is one process on one machine."""

    def __init__(self, limit: int, window: float = 60.0) -> None:
        self.limit, self.window = limit, window
        self.hits: dict[int, deque[float]] = defaultdict(deque)

    def check(self, user_id: int) -> None:
        now = time.monotonic()
        hits = self.hits[user_id]
        while hits and hits[0] <= now - self.window:
            hits.popleft()
        if len(hits) >= self.limit:
            raise HTTPException(429, "That's a lot of saves at once. Wait a minute, then try again.")
        hits.append(now)


class BlobStore:
    """Import files on disk, one folder per user, named by hash."""

    def __init__(self, root: Path) -> None:
        self.root = root

    def path(self, user_id: int, h: str) -> Path:
        return self.root / str(user_id) / h

    def write(self, user_id: int, h: str, data: bytes) -> None:
        p = self.path(user_id, h)
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(".part")
        tmp.write_bytes(data)
        tmp.replace(p)

    def forget_user(self, user_id: int) -> None:
        shutil.rmtree(self.root / str(user_id), ignore_errors=True)


class NewModel(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    bcad: str
    note: str | None = Field(default=None, max_length=200)


class Save(BaseModel):
    bcad: str
    note: str | None = Field(default=None, max_length=200)
    name: str | None = Field(default=None, min_length=1, max_length=200)


class Rename(BaseModel):
    name: str = Field(min_length=1, max_length=200)


class Thumbnail(BaseModel):
    thumbnail: str = Field(max_length=THUMB_BYTES)


class Note(BaseModel):
    note: str = Field(max_length=200)


def thumbnail_of(bcad: str) -> str | None:
    """The .bcad's thumbnail data URL, or None. Refuses text that isn't a BetterCad model."""
    try:
        data = json.loads(bcad)
    except ValueError:
        raise HTTPException(422, "That isn't a BetterCad model.") from None
    if not isinstance(data, dict) or not ("document" in data or "features" in data):
        raise HTTPException(422, "That isn't a BetterCad model.")
    thumb = data.get("thumbnail")
    return thumb if isinstance(thumb, str) and THUMB.match(thumb) else None


def router(settings) -> APIRouter:
    r = APIRouter(prefix="/api", tags=["models"])
    limit = settings.max_upload_mb * 1024 * 1024
    quota = settings.user_quota_mb * 1024 * 1024
    limiter = Limiter(WRITES_PER_MINUTE)

    def too_big() -> HTTPException:
        return HTTPException(413, f"That's over the {settings.max_upload_mb} MB limit for one save.")

    def check_size(request: Request) -> None:
        length = request.headers.get("content-length")
        if length and length.isdigit() and int(length) > limit:
            raise too_big()

    def used(db: sqlite3.Connection, user_id: int) -> int:
        v = db.execute(
            "SELECT COALESCE(SUM(v.size), 0) FROM versions v JOIN models m ON m.id = v.model_id WHERE m.user_id = ?",
            (user_id,),
        ).fetchone()[0]
        b = db.execute("SELECT COALESCE(SUM(size), 0) FROM blobs WHERE user_id = ?", (user_id,)).fetchone()[0]
        return v + b

    def write_check(db: sqlite3.Connection, user: User, adding: int) -> None:
        if adding > limit:
            raise too_big()
        limiter.check(user.id)
        if used(db, user.id) + adding > quota:
            raise HTTPException(
                413, f"You've used your {settings.user_quota_mb} MB. Delete some models or old versions to save more."
            )

    def own(db: sqlite3.Connection, user: User, model_id: str, binned: bool | None = False) -> sqlite3.Row:
        row = db.execute("SELECT * FROM models WHERE id = ? AND user_id = ?", (model_id, user.id)).fetchone()
        if not row or (binned is not None and bool(row["deleted_at"]) != binned):
            raise HTTPException(404, NOT_FOUND)
        return row

    def add_version(db: sqlite3.Connection, model_id: str, number: int, bcad: str, note: str | None) -> str | None:
        raw = bcad.encode()
        thumb = thumbnail_of(bcad)
        db.execute(
            "INSERT INTO versions (model_id, number, bcad_json, size, thumbnail, note) VALUES (?, ?, ?, ?, ?, ?)",
            (model_id, number, zlib.compress(raw, 6), len(raw), thumb, note),
        )
        db.execute(
            "UPDATE models SET version = ?, thumbnail = ?, modified = strftime('%Y-%m-%d %H:%M:%f', 'now') WHERE id = ?",
            (number, thumb, model_id),
        )
        return thumb

    def summary(row: sqlite3.Row) -> dict:
        return {
            "id": row["id"],
            "name": row["name"],
            "version": row["version"],
            "created": row["created"],
            "modified": row["modified"],
            "deleted_at": row["deleted_at"],
            "thumbnail": f"/api/models/{row['id']}/thumbnail?v={row['version']}.{tag(row['thumbnail'])}"
            if row["thumbnail"]
            else None,
        }

    def version_row(db: sqlite3.Connection, model_id: str, n: int) -> sqlite3.Row:
        row = db.execute("SELECT * FROM versions WHERE model_id = ? AND number = ?", (model_id, n)).fetchone()
        if not row:
            raise HTTPException(404, "That version isn't here any more.")
        return row

    def version_info(model_id: str, v: sqlite3.Row) -> dict:
        return {
            "number": v["number"],
            "size": v["size"],
            "created": v["created"],
            "note": v["note"],
            "thumbnail": f"/api/models/{model_id}/versions/{v['number']}/thumbnail?h={tag(v['thumbnail'])}"
            if v["thumbnail"]
            else None,
        }

    def full(model: sqlite3.Row, v: sqlite3.Row) -> dict:
        return {**summary(model), "bcad": zlib.decompress(v["bcad_json"]).decode(), "note": v["note"]}

    def image(data_url: str | None, cache: str) -> Response:
        m = THUMB.match(data_url or "")
        if not m:
            raise HTTPException(404, "There's no picture for that model.")
        try:
            body = base64.b64decode(m.group(2), validate=False)
        except binascii.Error:
            raise HTTPException(404, "There's no picture for that model.") from None
        return Response(body, media_type=m.group(1), headers={"Cache-Control": cache})

    # --- Models -----------------------------------------------------------------------------------------------

    @r.get("/models")
    def list_models(
        request: Request,
        user: CurrentUser,
        limit_: Annotated[int, Query(alias="limit", ge=1, le=200)] = 50,
        offset: Annotated[int, Query(ge=0)] = 0,
        q: str = "",
        sort: Annotated[str, Query(pattern="^(modified|name)$")] = "modified",
        bin: bool = False,
    ) -> dict:
        db = conn(request)
        where = "user_id = ? AND deleted_at IS " + ("NOT NULL" if bin else "NULL")
        args: list = [user.id]
        if q:
            where += " AND name LIKE ? ESCAPE '\\'"
            args.append("%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%")
        order = "name COLLATE NOCASE ASC" if sort == "name" else "modified DESC"
        total = db.execute(f"SELECT COUNT(*) FROM models WHERE {where}", args).fetchone()[0]
        rows = db.execute(
            f"SELECT m.*, (SELECT COALESCE(SUM(v.size), 0) FROM versions v WHERE v.model_id = m.id) AS bytes,"
            f" (SELECT COUNT(*) FROM versions v WHERE v.model_id = m.id) AS versions"
            f" FROM models m WHERE {where} ORDER BY {order}, id LIMIT ? OFFSET ?",
            [*args, limit_, offset],
        )
        # Size is what the model takes from the quota: every saved version, as /api/me/usage counts it.
        return {"models": [{**summary(x), "size": x["bytes"], "versions": x["versions"]} for x in rows], "total": total}

    @r.post("/models", status_code=201)
    def create(body: NewModel, request: Request, user: Writer) -> dict:
        check_size(request)
        db = conn(request)
        write_check(db, user, len(body.bcad.encode()))
        model_id = secrets.token_urlsafe(9)
        with db:
            db.execute("INSERT INTO models (id, user_id, name) VALUES (?, ?, ?)", (model_id, user.id, body.name.strip()))
            add_version(db, model_id, 1, body.bcad, body.note)
        return summary(own(db, user, model_id))

    @r.get("/models/{model_id}")
    def get_model(model_id: str, request: Request, user: CurrentUser) -> dict:
        db = conn(request)
        m = own(db, user, model_id)
        return full(m, version_row(db, model_id, m["version"]))

    @r.put("/models/{model_id}")
    def save(
        model_id: str,
        body: Save,
        request: Request,
        user: Writer,
        if_match: Annotated[str | None, Header()] = None,
    ) -> dict:
        check_size(request)
        db = conn(request)
        write_check(db, user, len(body.bcad.encode()))
        with db:
            m = own(db, user, model_id)
            expected = (if_match or "").strip('"W/ ')
            if expected and expected != str(m["version"]):
                raise HTTPException(409, {"message": "This model changed in another tab.", "version": m["version"]})
            n = m["version"] + 1
            add_version(db, model_id, n, body.bcad, body.note)
            if body.name:
                db.execute("UPDATE models SET name = ? WHERE id = ?", (body.name.strip(), model_id))
        return {"version": n}

    @r.patch("/models/{model_id}")
    def rename(model_id: str, body: Rename, request: Request, user: Writer) -> dict:
        db = conn(request)
        own(db, user, model_id)
        with db:
            db.execute(
                "UPDATE models SET name = ?, modified = strftime('%Y-%m-%d %H:%M:%f', 'now') WHERE id = ?",
                (body.name.strip(), model_id),
            )
        return summary(own(db, user, model_id))

    @r.post("/models/{model_id}/duplicate", status_code=201)
    def duplicate(model_id: str, request: Request, user: Writer) -> dict:
        db = conn(request)
        m = own(db, user, model_id)
        v = version_row(db, model_id, m["version"])
        write_check(db, user, v["size"])
        copy = secrets.token_urlsafe(9)
        with db:
            db.execute("INSERT INTO models (id, user_id, name) VALUES (?, ?, ?)", (copy, user.id, f"{m['name']} copy"))
            db.execute(
                "INSERT INTO versions (model_id, number, bcad_json, size, thumbnail, note) VALUES (?, 1, ?, ?, ?, ?)",
                (copy, v["bcad_json"], v["size"], v["thumbnail"], f"Copied from {m['name']}"),
            )
            db.execute("UPDATE models SET version = 1, thumbnail = ? WHERE id = ?", (v["thumbnail"], copy))
        return summary(own(db, user, copy))

    @r.delete("/models/{model_id}")
    def delete(model_id: str, request: Request, user: Writer, forever: bool = False) -> dict:
        db = conn(request)
        own(db, user, model_id, binned=None)
        with db:
            if forever:
                db.execute("DELETE FROM models WHERE id = ?", (model_id,))
            else:
                db.execute("UPDATE models SET deleted_at = strftime('%Y-%m-%d %H:%M:%f', 'now') WHERE id = ?", (model_id,))
                db.execute("DELETE FROM shares WHERE model_id = ?", (model_id,))
        return {"ok": True}

    @r.post("/models/{model_id}/restore")
    def undelete(model_id: str, request: Request, user: Writer) -> dict:
        db = conn(request)
        own(db, user, model_id, binned=True)
        with db:
            db.execute("UPDATE models SET deleted_at = NULL WHERE id = ?", (model_id,))
        return summary(own(db, user, model_id))

    @r.get("/models/{model_id}/thumbnail")
    def thumbnail(model_id: str, request: Request, user: CurrentUser) -> Response:
        m = own(conn(request), user, model_id, binned=None)
        return image(m["thumbnail"], "private, max-age=86400")

    # --- Versions ---------------------------------------------------------------------------------------------

    @r.get("/models/{model_id}/versions")
    def versions(model_id: str, request: Request, user: CurrentUser) -> dict:
        db = conn(request)
        own(db, user, model_id)
        rows = db.execute("SELECT * FROM versions WHERE model_id = ? ORDER BY number DESC", (model_id,))
        return {"versions": [version_info(model_id, v) for v in rows]}

    @r.get("/models/{model_id}/versions/{n}")
    def get_version(model_id: str, n: int, request: Request, user: CurrentUser) -> dict:
        db = conn(request)
        m = own(db, user, model_id)
        v = version_row(db, model_id, n)
        return {**full(m, v), **version_info(model_id, v)}

    @r.patch("/models/{model_id}/versions/{n}")
    def note(model_id: str, n: int, body: Note, request: Request, user: Writer) -> dict:
        db = conn(request)
        own(db, user, model_id)
        version_row(db, model_id, n)
        with db:
            db.execute("UPDATE versions SET note = ? WHERE model_id = ? AND number = ?", (body.note or None, model_id, n))
        return version_info(model_id, version_row(db, model_id, n))

    @r.post("/models/{model_id}/versions/{n}/restore")
    def restore(model_id: str, n: int, request: Request, user: Writer) -> dict:
        db = conn(request)
        m = own(db, user, model_id)
        v = version_row(db, model_id, n)
        write_check(db, user, v["size"])
        latest = m["version"] + 1
        with db:
            add_version(db, model_id, latest, zlib.decompress(v["bcad_json"]).decode(), f"Restored version {n}")
        return {"version": latest}

    @r.put("/models/{model_id}/versions/{n}/thumbnail")
    def set_thumbnail(model_id: str, n: int, body: Thumbnail, request: Request, user: Writer) -> dict:
        """Replaces a version's picture: the editor saves at once, then sends a rendered one when it is ready."""
        if not THUMB.match(body.thumbnail):
            raise HTTPException(422, "That isn't a picture.")
        db = conn(request)
        m = own(db, user, model_id)
        version_row(db, model_id, n)
        limiter.check(user.id)
        with db:
            db.execute("UPDATE versions SET thumbnail = ? WHERE model_id = ? AND number = ?", (body.thumbnail, model_id, n))
            if n == m["version"]:
                db.execute("UPDATE models SET thumbnail = ? WHERE id = ?", (body.thumbnail, model_id))
        return summary(own(db, user, model_id))

    @r.get("/models/{model_id}/versions/{n}/thumbnail")
    def version_thumbnail(model_id: str, n: int, request: Request, user: CurrentUser) -> Response:
        db = conn(request)
        own(db, user, model_id)
        return image(version_row(db, model_id, n)["thumbnail"], "private, max-age=31536000, immutable")

    # --- Sharing (#92) ----------------------------------------------------------------------------------------

    @r.post("/models/{model_id}/share")
    def share(model_id: str, request: Request, user: Writer) -> dict:
        db = conn(request)
        own(db, user, model_id)
        row = db.execute("SELECT token FROM shares WHERE model_id = ?", (model_id,)).fetchone()
        if row:
            return {"token": row["token"]}
        token = secrets.token_urlsafe(16)[:22]
        with db:
            db.execute("INSERT INTO shares (token, model_id) VALUES (?, ?)", (token, model_id))
        return {"token": token}

    @r.delete("/models/{model_id}/share")
    def unshare(model_id: str, request: Request, user: Writer) -> dict:
        db = conn(request)
        own(db, user, model_id)
        with db:
            db.execute("DELETE FROM shares WHERE model_id = ?", (model_id,))
        return {"ok": True}

    def shared_model(db: sqlite3.Connection, token: str) -> sqlite3.Row:
        row = db.execute(
            "SELECT m.*, u.name AS owner FROM shares s JOIN models m ON m.id = s.model_id JOIN accounts u ON u.id = m.user_id "
            "WHERE s.token = ? AND m.deleted_at IS NULL "
            "AND (s.expires IS NULL OR s.expires > strftime('%Y-%m-%d %H:%M:%f', 'now'))",
            (token,),
        ).fetchone()
        if not row:
            raise HTTPException(404, "This link isn't active any more.")
        return row

    @r.get("/shared/{token}")
    def shared(token: str, request: Request, response: Response) -> dict:
        db = conn(request)
        m = shared_model(db, token)
        v = version_row(db, m["id"], m["version"])
        response.headers["Cache-Control"] = "private, no-store"
        return {
            "name": m["name"],
            "owner": m["owner"],
            "version": m["version"],
            "modified": m["modified"],
            "bcad": zlib.decompress(v["bcad_json"]).decode(),
            "thumbnail": f"/api/shared/{token}/thumbnail" if m["thumbnail"] else None,
        }

    @r.get("/shared/{token}/thumbnail")
    def shared_thumbnail(token: str, request: Request) -> Response:
        return image(shared_model(conn(request), token)["thumbnail"], "private, no-store")

    @r.get("/shared/{token}/blobs/{h}")
    def shared_blob(token: str, h: str, request: Request) -> Response:
        """A file the shared model imports, so the viewer can rebuild it without a session."""
        m = shared_model(conn(request), token)
        return send_blob(request, m["user_id"], h, "private, no-store")

    # --- Blobs ------------------------------------------------------------------------------------------------

    def blob_hash(h: str) -> str:
        if not HASH.match(h):
            raise HTTPException(404, "That file isn't here.")
        return h

    @r.put("/blobs/{h}")
    async def put_blob(h: str, request: Request, user: Writer) -> dict:
        h = blob_hash(h)
        check_size(request)
        db = conn(request)
        if db.execute("SELECT 1 FROM blobs WHERE hash = ? AND user_id = ?", (h, user.id)).fetchone():
            return {"hash": h, "stored": False}
        data = await request.body()
        write_check(db, user, len(data))
        mime = request.headers.get("content-type", "application/octet-stream").split(";")[0][:100]
        request.app.state.blobs.write(user.id, h, data)
        with db:
            db.execute(
                "INSERT OR REPLACE INTO blobs (hash, user_id, size, mime) VALUES (?, ?, ?, ?)", (h, user.id, len(data), mime)
            )
        return {"hash": h, "stored": True}

    def send_blob(request: Request, user_id: int, h: str, cache: str) -> Response:
        h = blob_hash(h)
        row = conn(request).execute("SELECT mime FROM blobs WHERE hash = ? AND user_id = ?", (h, user_id)).fetchone()
        path = request.app.state.blobs.path(user_id, h)
        if not row or not path.is_file():
            raise HTTPException(404, "That file isn't here.")
        headers = {"Cache-Control": cache}
        if request.method == "HEAD":
            headers["Content-Length"] = str(path.stat().st_size)
            return Response(b"", media_type=row["mime"], headers=headers)
        return Response(path.read_bytes(), media_type=row["mime"], headers=headers)

    @r.head("/blobs/{h}", include_in_schema=False)
    @r.get("/blobs/{h}")
    def get_blob(h: str, request: Request, user: CurrentUser) -> Response:
        return send_blob(request, user.id, h, "private, max-age=31536000, immutable")

    # --- Usage ------------------------------------------------------------------------------------------------

    @r.get("/me/usage")
    def usage(request: Request, user: CurrentUser) -> dict:
        db = conn(request)
        models = db.execute("SELECT COUNT(*) FROM models WHERE user_id = ? AND deleted_at IS NULL", (user.id,)).fetchone()[0]
        return {"models": models, "bytes": used(db, user.id), "quota": quota}

    return r
