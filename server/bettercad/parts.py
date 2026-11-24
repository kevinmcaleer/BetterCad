"""Electronics part libraries (#629): each person's own components, synced so every browser they sign in on has them.

The library is one JSON document the editor owns: a library pack (symbols, footprints and the parts that use them) and
the ids of parts taken out of it, so a part deleted on one machine does not come back from another. The server checks
only its size and shape.
"""

import json
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from .auth import CurrentUser, Writer, conn

MAX_BYTES = 4_000_000
MAX_REMOVED = 2_000


class Library(BaseModel):
    pack: dict[str, Any]
    removed: list[str] = Field(default_factory=list, max_length=MAX_REMOVED)


def router() -> APIRouter:
    r = APIRouter(prefix="/api/parts-library", tags=["parts"])

    @r.get("")
    def read(request: Request, user: CurrentUser) -> dict:
        row = conn(request).execute("SELECT data, modified FROM part_libraries WHERE user_id = ?", (user.id,)).fetchone()
        if not row:
            return {"pack": None, "removed": [], "modified": None}
        return {**json.loads(row["data"]), "modified": row["modified"]}

    @r.put("")
    def save(body: Library, request: Request, user: Writer) -> dict:
        if body.pack.get("pack") != 1 or not isinstance(body.pack.get("parts"), list):
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

    return r
