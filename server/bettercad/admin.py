"""Admin console: who uses BetterCad and the models each person has saved.

`GET /api/admin/users` lists every account here (one row per kevsrobots.com person who has signed in to BetterCad)
with their sign-in history, projects and models, newest first. Only the accounts named in ADMIN_EMAILS (or, until
that is set, STATS_EMAILS) or ADMIN_USERS can read it. It shows names, dates and sizes, never the models themselves;
a model's picture and a project's cover are the exceptions.
"""

from fastapi import APIRouter, HTTPException, Request, Response

from . import chunks
from .auth import CurrentUser, User, conn
from .auth import is_admin as is_admin
from .models import image
from .settings import Settings

NOT_ADMIN = "Only BetterCad's admins can see this page."


def admin_emails(settings: Settings) -> set[str]:
    raw = settings.admin_emails or settings.stats_emails
    return {e.strip().lower() for e in raw.split(",") if e.strip()}


def admin_users(settings: Settings) -> set[str]:
    return {u.strip().lower() for u in settings.admin_users.split(",") if u.strip()}


#: Visits listed per person; older ones are only counted.
VISITS_SHOWN = 20


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
            " COALESCE(m.project_id, (SELECT f.project_id FROM folders f WHERE f.id = m.folder_id)) AS project,"
            f" {chunks.MODEL_BYTES} AS bytes,"
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
                    "project_id": m["project"],
                    "thumbnail": f"/api/admin/models/{m['id']}/thumbnail?v={m['version']}" if m["pic"] else None,
                }
            )
        projects: dict[int, list[dict]] = {}
        for p in db.execute(
            "SELECT id, user_id, name, cover IS NOT NULL AS pic, created, modified, deleted_at FROM projects"
            " ORDER BY modified DESC"
        ):
            projects.setdefault(p["user_id"], []).append(
                {
                    "id": p["id"],
                    "name": p["name"],
                    "created": p["created"],
                    "modified": p["modified"],
                    "deleted_at": p["deleted_at"],
                    "cover": f"/api/admin/projects/{p['id']}/cover?v={p['modified']}" if p["pic"] else None,
                }
            )
        visits: dict[int, list[dict]] = {}
        counts: dict[int, int] = {}
        for v in db.execute(
            "SELECT user_id, started, ended FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY started DESC)"
            " AS n FROM visits) WHERE n <= ? ORDER BY started DESC",
            (VISITS_SHOWN,),
        ):
            visits.setdefault(v["user_id"], []).append({"started": v["started"], "ended": v["ended"]})
        for c in db.execute(
            "SELECT user_id, COUNT(*) AS n FROM visits WHERE started >= datetime('now', '-30 days') GROUP BY user_id"
        ):
            counts[c["user_id"]] = c["n"]
        out = []
        for a in db.execute("SELECT id, name, email, created, last_seen, last_active FROM accounts"):
            mine = models.get(a["id"], [])
            theirs = []
            for p in projects.get(a["id"], []):
                inside = [m for m in mine if m["project_id"] == p["id"]]
                live = [m for m in inside if not m["deleted_at"]]
                pic = next((m["thumbnail"] for m in live if m["thumbnail"]), None)
                theirs.append(
                    {
                        **p,
                        "models": len(live),
                        "size": sum(m["size"] for m in inside),
                        # The project's cover, or else the newest picture of a model inside it.
                        "thumbnail": p["cover"] or pic,
                    }
                )
            out.append(
                {
                    "id": a["id"],
                    "username": a["name"],
                    "email": a["email"],
                    "joined": a["created"],
                    "last_seen": a["last_seen"],
                    "last_active": a["last_active"],
                    "visits": visits.get(a["id"], []),
                    "visits_month": counts.get(a["id"], 0),
                    # Accounts from before kevsrobots.com sign-in sit at negative ids until someone claims them.
                    "set_aside": a["id"] < 0,
                    "last_saved": mine[0]["modified"] if mine else None,
                    "size": sum(m["size"] for m in mine),
                    "projects": theirs,
                    "models": mine,
                }
            )
        out.sort(
            key=lambda u: max(u["last_active"] or u["last_seen"] or "", u["last_saved"] or "", u["joined"] or ""),
            reverse=True,
        )
        return {
            "users": out,
            "totals": {"users": len(out), "models": sum(len(u["models"]) for u in out), "size": sum(u["size"] for u in out)},
        }

    @r.get("/models/{model_id}/thumbnail")
    def thumbnail(model_id: str, request: Request, user: CurrentUser) -> Response:
        need_admin(request, user)
        row = conn(request).execute("SELECT thumbnail FROM models WHERE id = ?", (model_id,)).fetchone()
        return image(row["thumbnail"] if row else None, "private, max-age=86400")

    @r.get("/projects/{project_id}/cover")
    def cover(project_id: str, request: Request, user: CurrentUser) -> Response:
        need_admin(request, user)
        row = conn(request).execute("SELECT cover FROM projects WHERE id = ?", (project_id,)).fetchone()
        return image(row["cover"] if row else None, "private, max-age=86400")

    return r
