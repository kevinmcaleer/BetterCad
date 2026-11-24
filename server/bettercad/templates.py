"""Drawing templates (#575): each person's sheet set-ups, synced so every browser they sign in on has them.

The template itself is JSON the editor owns (page, standard, title block, logo, first views); the server checks only
its size and shape. The logo travels inside it as a small JPEG, which is why a template may be bigger than a printer.
"""

import json
import re
import sqlite3
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from .auth import CurrentUser, Writer, conn

ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
MAX_TEMPLATES = 20
MAX_BYTES = 200_000


class Template(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    data: dict[str, Any]


def router() -> APIRouter:
    r = APIRouter(prefix="/api/templates", tags=["templates"])

    def check_id(template_id: str) -> None:
        if not ID.match(template_id):
            raise HTTPException(404, "That template isn't here.")

    def row_out(row: sqlite3.Row) -> dict:
        data = json.loads(row["data"])
        return {**data, "id": row["id"], "modified": row["modified"]}

    @r.get("")
    def list_templates(request: Request, user: CurrentUser) -> dict:
        rows = conn(request).execute(
            "SELECT id, data, modified FROM drawing_templates WHERE user_id = ? ORDER BY modified", (user.id,)
        )
        return {"templates": [row_out(x) for x in rows]}

    @r.put("/{template_id}")
    def save(template_id: str, body: Template, request: Request, user: Writer) -> dict:
        check_id(template_id)
        text = json.dumps({**body.data, "name": body.name}, separators=(",", ":"))
        if len(text) > MAX_BYTES:
            raise HTTPException(413, "That template is too big to save. Try a smaller logo.")
        db = conn(request)
        with db:
            exists = db.execute("SELECT 1 FROM drawing_templates WHERE user_id = ? AND id = ?", (user.id, template_id)).fetchone()
            if not exists:
                n = db.execute("SELECT COUNT(*) FROM drawing_templates WHERE user_id = ?", (user.id,)).fetchone()[0]
                if n >= MAX_TEMPLATES:
                    raise HTTPException(409, f"You can keep up to {MAX_TEMPLATES} templates. Delete one to add another.")
            db.execute(
                "INSERT INTO drawing_templates (user_id, id, data) VALUES (?, ?, ?) "
                "ON CONFLICT (user_id, id) DO UPDATE SET data = excluded.data, "
                "modified = strftime('%Y-%m-%d %H:%M:%f', 'now')",
                (user.id, template_id, text),
            )
        row = db.execute(
            "SELECT id, data, modified FROM drawing_templates WHERE user_id = ? AND id = ?", (user.id, template_id)
        ).fetchone()
        return row_out(row)

    @r.delete("/{template_id}")
    def delete(template_id: str, request: Request, user: Writer) -> dict:
        check_id(template_id)
        db = conn(request)
        with db:
            gone = db.execute("DELETE FROM drawing_templates WHERE user_id = ? AND id = ?", (user.id, template_id)).rowcount
        if not gone:
            raise HTTPException(404, "That template isn't here.")
        return {"ok": True}

    return r
