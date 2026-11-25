"""Electronics parts (#625, #629): each person's own library, links to it, and the catalogue people publish to.

The library is one JSON document the editor owns: a library pack (symbols, footprints and the parts that use them) and
the ids of parts taken out of it, so a part deleted on one machine does not come back from another. The server checks
only its size and shape. A library can be shared by a link that reads it as it is now.

The catalogue holds parts published from those libraries, each as a one-part pack. A published part is live at once,
marked unreviewed, until an admin approves or rejects it: the same rule as robot parts. Only open licences can be
published, and the credit travels with the part.
"""

import json
import re
import secrets
from typing import Any

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field

from .auth import CurrentUser, Writer, conn, is_admin

MAX_BYTES = 4_000_000
MAX_REMOVED = 2_000
#: One published part, with its symbol and footprints.
MAX_PART_BYTES = 400_000
#: The licences a part can be published under: ones that let other people use it.
LICENCES = (
    "CC0 1.0 (no rights kept)",
    "CC-BY 4.0",
    "CC-BY-SA 4.0",
    "CC-BY-SA 4.0 with the KiCad libraries exception",
    "MIT",
)
SEARCH_LIMIT = 40
HASH = re.compile(r"^[A-Za-z0-9_-]{8,128}$")
NOT_ADMIN = "Only BetterCad's admins can review parts."


class Library(BaseModel):
    pack: dict[str, Any]
    removed: list[str] = Field(default_factory=list, max_length=MAX_REMOVED)


class Publish(BaseModel):
    #: The part's id in its owner's library.
    id: str = Field(min_length=1, max_length=120)
    #: A library pack holding that one part.
    pack: dict[str, Any]
    licence: str
    credit: str = Field(default="", max_length=200)


class Review(BaseModel):
    status: str


def is_pack(pack: dict[str, Any]) -> bool:
    return pack.get("pack") == 1 and isinstance(pack.get("parts"), list)


def search_text(part: dict[str, Any]) -> str:
    """Everything a search looks in: name, description, keywords, value, maker's numbers and footprint names."""
    words: list[str] = []
    for key in ("name", "description", "value", "category"):
        if isinstance(part.get(key), str):
            words.append(part[key])
    if isinstance(part.get("keywords"), list):
        words += [k for k in part["keywords"] if isinstance(k, str)]
    if isinstance(part.get("supplier"), dict):
        words += [v for v in part["supplier"].values() if isinstance(v, str)]
    for pkg in part.get("packages") or []:
        if isinstance(pkg, dict) and isinstance(pkg.get("footprint"), str):
            words.append(pkg["footprint"])
    return " ".join(words).lower()[:2000]


def blobs_of(data: str) -> set[str]:
    """The files a published part's bodies come from."""
    out: set[str] = set()
    for pkg in (json.loads(data).get("parts") or [{}])[0].get("packages") or []:
        src = (pkg.get("model") or {}).get("source") or {} if isinstance(pkg, dict) else {}
        if src.get("kind") == "step" and isinstance(src.get("blob"), str):
            out.add(src["blob"])
    return out


def router() -> APIRouter:
    r = APIRouter(prefix="/api", tags=["parts"])

    # --- Your library -----------------------------------------------------------------------------------------

    @r.get("/parts-library")
    def read(request: Request, user: CurrentUser) -> dict:
        row = conn(request).execute("SELECT data, modified FROM part_libraries WHERE user_id = ?", (user.id,)).fetchone()
        if not row:
            return {"pack": None, "removed": [], "modified": None}
        return {**json.loads(row["data"]), "modified": row["modified"]}

    @r.put("/parts-library")
    def save(body: Library, request: Request, user: Writer) -> dict:
        if not is_pack(body.pack):
            raise HTTPException(422, "That isn't a parts library.")
        text = json.dumps({"pack": body.pack, "removed": body.removed}, separators=(",", ":"))
        if len(text) > MAX_BYTES:
            raise HTTPException(413, "Your parts library is too big to save. Remove some parts, or export them to a file.")
        db = conn(request)
        with db:
            db.execute(
                "INSERT INTO part_libraries (user_id, data) VALUES (?, ?) "
                "ON CONFLICT (user_id) DO UPDATE SET data = excluded.data, "
                "modified = strftime('%Y-%m-%d %H:%M:%f', 'now')",
                (user.id, text),
            )
        row = db.execute("SELECT modified FROM part_libraries WHERE user_id = ?", (user.id,)).fetchone()
        return {"ok": True, "modified": row["modified"]}

    # --- A link to your library -------------------------------------------------------------------------------

    @r.get("/parts-library/share")
    def share_state(request: Request, user: CurrentUser) -> dict:
        row = conn(request).execute("SELECT token FROM part_library_shares WHERE user_id = ?", (user.id,)).fetchone()
        return {"token": row["token"] if row else None}

    @r.post("/parts-library/share")
    def share(request: Request, user: Writer) -> dict:
        db = conn(request)
        row = db.execute("SELECT token FROM part_library_shares WHERE user_id = ?", (user.id,)).fetchone()
        if row:
            return {"token": row["token"]}
        token = secrets.token_urlsafe(16)[:22]
        with db:
            db.execute("INSERT INTO part_library_shares (token, user_id) VALUES (?, ?)", (token, user.id))
        return {"token": token}

    @r.delete("/parts-library/share")
    def unshare(request: Request, user: Writer) -> dict:
        db = conn(request)
        with db:
            db.execute("DELETE FROM part_library_shares WHERE user_id = ?", (user.id,))
        return {"ok": True}

    def shared_owner(request: Request, token: str) -> int:
        row = conn(request).execute("SELECT user_id FROM part_library_shares WHERE token = ?", (token,)).fetchone()
        if not row:
            raise HTTPException(404, "That link no longer works. Ask for a new one.")
        return row["user_id"]

    @r.get("/parts-library/shared/{token}")
    def shared(token: str, request: Request, response: Response) -> dict:
        """Someone's library by its link, with their name for the credit. No session needed."""
        owner = shared_owner(request, token)
        db = conn(request)
        row = db.execute("SELECT data FROM part_libraries WHERE user_id = ?", (owner,)).fetchone()
        who = db.execute("SELECT name AS username FROM accounts WHERE id = ?", (owner,)).fetchone()
        response.headers["Cache-Control"] = "private, no-store"
        return {"pack": json.loads(row["data"])["pack"] if row else None, "by": who["username"] if who else ""}

    def send(request: Request, owner: int, h: str) -> Response:
        if not HASH.match(h):
            raise HTTPException(404, "That file isn't here.")
        row = conn(request).execute("SELECT mime FROM blobs WHERE hash = ? AND user_id = ?", (h, owner)).fetchone()
        path = request.app.state.blobs.path(owner, h)
        if not row or not path.is_file():
            raise HTTPException(404, "That file isn't here.")
        return Response(
            path.read_bytes(), media_type=row["mime"], headers={"Cache-Control": "private, max-age=31536000, immutable"}
        )

    @r.get("/parts-library/shared/{token}/blobs/{h}")
    def shared_blob(token: str, h: str, request: Request) -> Response:
        """A file one of the shared library's parts uses for its body."""
        owner = shared_owner(request, token)
        row = conn(request).execute("SELECT data FROM part_libraries WHERE user_id = ?", (owner,)).fetchone()
        if not row or f'"{h}"' not in row["data"]:
            raise HTTPException(404, "That file isn't here.")
        return send(request, owner, h)

    # --- The catalogue ----------------------------------------------------------------------------------------

    def entry(row: Any, mine: bool = False) -> dict:
        return {
            "id": row["id"],
            "name": row["name"],
            "licence": row["licence"],
            "credit": row["credit"],
            "by": row["username"],
            "status": row["status"],
            "modified": row["modified"],
            "pack": json.loads(row["data"]),
            **({"part": row["part_id"]} if mine else {}),
        }

    COLUMNS = "c.id, c.part_id, c.name, c.licence, c.credit, c.status, c.modified, c.data, a.name AS username"

    @r.get("/parts-catalogue")
    def find(request: Request, response: Response, q: str = "", limit: int = SEARCH_LIMIT) -> dict:
        """Published parts whose text holds every word of `q`: approved ones first, then unreviewed. No session needed."""
        words = [w for w in q.lower().split() if w][:8]
        where = " AND ".join(["c.status != 'rejected'", *["c.search LIKE ? ESCAPE '\\'" for _ in words]])
        args = ["%" + w.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%" for w in words]
        rows = (
            conn(request)
            .execute(
                f"SELECT {COLUMNS} FROM part_catalogue c JOIN accounts a ON a.id = c.user_id WHERE {where} "
                "ORDER BY c.status = 'approved' DESC, c.name COLLATE NOCASE LIMIT ?",
                (*args, max(1, min(limit, SEARCH_LIMIT))),
            )
            .fetchall()
        )
        response.headers["Cache-Control"] = "private, no-store"
        return {"parts": [entry(x) for x in rows], "licences": list(LICENCES)}

    @r.get("/parts-catalogue/mine")
    def mine(request: Request, user: CurrentUser) -> dict:
        rows = conn(request).execute(
            f"SELECT {COLUMNS} FROM part_catalogue c JOIN accounts a ON a.id = c.user_id "
            "WHERE c.user_id = ? ORDER BY c.name COLLATE NOCASE",
            (user.id,),
        )
        return {"parts": [{k: v for k, v in entry(x, True).items() if k != "pack"} for x in rows], "licences": list(LICENCES)}

    @r.post("/parts-catalogue")
    def publish(body: Publish, request: Request, user: Writer) -> dict:
        """Publishes a part, or publishes it again after a change: either way it is unreviewed until an admin looks."""
        parts = body.pack.get("parts") if is_pack(body.pack) else None
        if (
            not parts
            or len(parts) != 1
            or not isinstance(parts[0], dict)
            or not isinstance(parts[0].get("name"), str)
            or not parts[0]["name"].strip()
        ):
            raise HTTPException(422, "Publish one part at a time.")
        if body.licence not in LICENCES:
            raise HTTPException(422, "Pick a licence that lets other people use the part: " + ", ".join(LICENCES) + ".")
        text = json.dumps(body.pack, separators=(",", ":"))
        if len(text) > MAX_PART_BYTES:
            raise HTTPException(413, "That part is too big to publish.")
        part = parts[0]
        credit = body.credit.strip() or user.username
        db = conn(request)
        with db:
            db.execute(
                "INSERT INTO part_catalogue (user_id, part_id, name, search, licence, credit, data) VALUES (?, ?, ?, ?, ?, ?, ?) "
                "ON CONFLICT (user_id, part_id) DO UPDATE SET name = excluded.name, search = excluded.search, "
                "licence = excluded.licence, credit = excluded.credit, data = excluded.data, status = 'unreviewed', "
                "modified = strftime('%Y-%m-%d %H:%M:%f', 'now')",
                (user.id, body.id, part["name"].strip()[:200], search_text(part), body.licence, credit, text),
            )
        row = db.execute("SELECT id, status FROM part_catalogue WHERE user_id = ? AND part_id = ?", (user.id, body.id)).fetchone()
        return {"id": row["id"], "status": row["status"]}

    @r.delete("/parts-catalogue/mine/{part_id}")
    def unpublish(part_id: str, request: Request, user: Writer) -> dict:
        db = conn(request)
        with db:
            n = db.execute("DELETE FROM part_catalogue WHERE user_id = ? AND part_id = ?", (user.id, part_id)).rowcount
        if not n:
            raise HTTPException(404, "That part isn't published.")
        return {"ok": True}

    @r.get("/parts-catalogue/{entry_id}/blobs/{h}")
    def catalogue_blob(entry_id: int, h: str, request: Request) -> Response:
        """A file a published part uses for its 3D body, read from its publisher's files."""
        row = (
            conn(request)
            .execute("SELECT user_id, data FROM part_catalogue WHERE id = ? AND status != 'rejected'", (entry_id,))
            .fetchone()
        )
        if not row or h not in blobs_of(row["data"]):
            raise HTTPException(404, "That file isn't here.")
        return send(request, row["user_id"], h)

    # --- Review -----------------------------------------------------------------------------------------------

    @r.get("/admin/parts-catalogue")
    def review_list(request: Request, user: CurrentUser) -> dict:
        if not is_admin(request, user):
            raise HTTPException(403, NOT_ADMIN)
        rows = conn(request).execute(
            f"SELECT {COLUMNS} FROM part_catalogue c JOIN accounts a ON a.id = c.user_id "
            "ORDER BY c.status = 'unreviewed' DESC, c.modified DESC LIMIT 500"
        )
        return {"parts": [entry(x) for x in rows]}

    @r.post("/admin/parts-catalogue/{entry_id}")
    def review(entry_id: int, body: Review, request: Request, user: Writer) -> dict:
        if not is_admin(request, user):
            raise HTTPException(403, NOT_ADMIN)
        if body.status not in ("unreviewed", "approved", "rejected"):
            raise HTTPException(422, "A part is unreviewed, approved or rejected.")
        db = conn(request)
        with db:
            n = db.execute("UPDATE part_catalogue SET status = ? WHERE id = ?", (body.status, entry_id)).rowcount
        if not n:
            raise HTTPException(404, "That part isn't in the catalogue.")
        return {"id": entry_id, "status": body.status}

    return r
