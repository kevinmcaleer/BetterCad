"""Admin console: who uses BetterCad and the models each person has saved.

`GET /api/admin/users` lists every account here (one row per kevsrobots.com person who has signed in to BetterCad)
with their models, newest first. Only the accounts named in ADMIN_EMAILS (or, until that is set, STATS_EMAILS) can
read it. It shows names, dates and sizes, never the models themselves; a model's picture is the one exception.
"""

from fastapi import APIRouter, HTTPException, Request, Response

from .auth import CurrentUser, User, conn
from .models import image
from .settings import Settings

NOT_ADMIN = "Only BetterCad's admins can see this page."


def admin_emails(settings: Settings) -> set[str]:
    raw = settings.admin_emails or settings.stats_emails
    return {e.strip().lower() for e in raw.split(",") if e.strip()}


def is_admin(request: Request, user: User) -> bool:
    return (user.email or "").lower() in request.app.state.admins


def router(settings: Settings) -> APIRouter:
    r = APIRouter(prefix="/api/admin", tags=["admin"])

    def need_admin(request: Request, user: User) -> None:
        if not is_admin(request, user):
            raise HTTPException(403, NOT_ADMIN)

    @r.get("/users")
    def users(request: Request, user: CurrentUser) -> dict:
        need_admin(request, user)
        db = conn(request)
        models: dict[int, list[dict]] = {}
        for m in db.execute(
            "SELECT m.id, m.user_id, m.name, m.version, m.created, m.modified, m.deleted_at, m.thumbnail IS NOT NULL AS pic,"
            " (SELECT COALESCE(SUM(v.size), 0) FROM versions v WHERE v.model_id = m.id) AS bytes,"
            " (SELECT COUNT(*) FROM versions v WHERE v.model_id = m.id) AS versions,"
            " EXISTS (SELECT 1 FROM shares s WHERE s.model_id = m.id) AS shared"
            " FROM models m ORDER BY m.modified DESC"
        ):
            models.setdefault(m["user_id"], []).append(
                {
                    "id": m["id"],
                    "name": m["name"],
                    "version": m["version"],
                    "versions": m["versions"],
                    "size": m["bytes"],
                    "created": m["created"],
                    "modified": m["modified"],
                    "deleted_at": m["deleted_at"],
                    "shared": bool(m["shared"]),
                    "thumbnail": f"/api/admin/models/{m['id']}/thumbnail?v={m['version']}" if m["pic"] else None,
                }
            )
        out = []
        for a in db.execute("SELECT id, name, created, last_seen FROM accounts"):
            mine = models.get(a["id"], [])
            out.append(
                {
                    "id": a["id"],
                    "username": a["name"],
                    "joined": a["created"],
                    "last_seen": a["last_seen"],
                    # Accounts from before kevsrobots.com sign-in sit at negative ids until someone claims them.
                    "set_aside": a["id"] < 0,
                    "last_saved": mine[0]["modified"] if mine else None,
                    "size": sum(m["size"] for m in mine),
                    "models": mine,
                }
            )
        out.sort(key=lambda u: max(u["last_seen"] or "", u["last_saved"] or "", u["joined"] or ""), reverse=True)
        return {
            "users": out,
            "totals": {"users": len(out), "models": sum(len(u["models"]) for u in out), "size": sum(u["size"] for u in out)},
        }

    @r.get("/models/{model_id}/thumbnail")
    def thumbnail(model_id: str, request: Request, user: CurrentUser) -> Response:
        need_admin(request, user)
        row = conn(request).execute("SELECT thumbnail FROM models WHERE id = ?", (model_id,)).fetchone()
        return image(row["thumbnail"] if row else None, "private, max-age=86400")

    return r
