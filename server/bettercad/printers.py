"""Printer profiles (#180): each person's printers, synced so every browser they sign in on has them.

The profile itself is JSON the editor owns (bed, hole offset, fit gaps); the server checks only its size and shape.
"""

import json
import re
import sqlite3
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from .auth import CurrentUser, Writer, conn

ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
MAX_PROFILES = 50
MAX_BYTES = 4096


class Profile(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    data: dict[str, Any]


def router() -> APIRouter:
    r = APIRouter(prefix="/api/printers", tags=["printers"])

    def check_id(profile_id: str) -> None:
        if not ID.match(profile_id):
            raise HTTPException(404, "That printer isn't here.")

    def row_out(row: sqlite3.Row) -> dict:
        data = json.loads(row["data"])
        return {**data, "id": row["id"], "modified": row["modified"]}

    @r.get("")
    def list_profiles(request: Request, user: CurrentUser) -> dict:
        rows = conn(request).execute(
            "SELECT id, data, modified FROM printer_profiles WHERE user_id = ? ORDER BY modified", (user.id,)
        )
        return {"printers": [row_out(x) for x in rows]}

    @r.put("/{profile_id}")
    def save(profile_id: str, body: Profile, request: Request, user: Writer) -> dict:
        check_id(profile_id)
        text = json.dumps({**body.data, "name": body.name}, separators=(",", ":"))
        if len(text) > MAX_BYTES:
            raise HTTPException(413, "That printer profile is too big to save.")
        db = conn(request)
        with db:
            exists = db.execute("SELECT 1 FROM printer_profiles WHERE user_id = ? AND id = ?", (user.id, profile_id)).fetchone()
            if not exists:
                n = db.execute("SELECT COUNT(*) FROM printer_profiles WHERE user_id = ?", (user.id,)).fetchone()[0]
                if n >= MAX_PROFILES:
                    raise HTTPException(409, f"You can keep up to {MAX_PROFILES} printers. Delete one to add another.")
            db.execute(
                "INSERT INTO printer_profiles (user_id, id, data) VALUES (?, ?, ?) "
                "ON CONFLICT (user_id, id) DO UPDATE SET data = excluded.data, "
                "modified = strftime('%Y-%m-%d %H:%M:%f', 'now')",
                (user.id, profile_id, text),
            )
        row = db.execute(
            "SELECT id, data, modified FROM printer_profiles WHERE user_id = ? AND id = ?", (user.id, profile_id)
        ).fetchone()
        return row_out(row)

    @r.delete("/{profile_id}")
    def delete(profile_id: str, request: Request, user: Writer) -> dict:
        check_id(profile_id)
        db = conn(request)
        with db:
            gone = db.execute("DELETE FROM printer_profiles WHERE user_id = ? AND id = ?", (user.id, profile_id)).rowcount
        if not gone:
            raise HTTPException(404, "That printer isn't here.")
        return {"ok": True}

    return r
