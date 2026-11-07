"""Analytics (#111), kept small enough for the privacy page to describe in two sentences: the app pings once per page
per browser session, and the server adds one to that page's count for the day. Nothing else is stored: no cookie,
no IP address, no user agent, no account.

`GET /api/stats` shows the counts to the accounts named in STATS_EMAILS.
"""

from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field

from .auth import CurrentUser, conn
from .settings import Settings

# The pages there are. Anything else counts as "other", so the table can't grow without bound.
ROUTES = {"editor", "sample", "view", "library", "account", "signin", "signup", "privacy", "terms"}


class Ping(BaseModel):
    route: str = Field(max_length=40)


def today() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%d")


def router(settings: Settings) -> APIRouter:
    r = APIRouter(prefix="/api")
    allowed = {e.strip().lower() for e in settings.stats_emails.split(",") if e.strip()}

    @r.post("/ping", status_code=204)
    def ping(body: Ping, request: Request) -> Response:
        route = body.route if body.route in ROUTES else "other"
        with conn(request) as db:
            db.execute(
                "INSERT INTO page_counts (day, route, count) VALUES (?, ?, 1) "
                "ON CONFLICT (day, route) DO UPDATE SET count = count + 1",
                (today(), route),
            )
        return Response(status_code=204)

    @r.get("/stats")
    def stats(request: Request, user: CurrentUser, days: int = 30) -> dict:
        if user.email.lower() not in allowed:
            raise HTTPException(403, "Only the accounts in STATS_EMAILS can see the stats.")
        days = max(1, min(days, 366))
        since = (datetime.now(UTC) - timedelta(days=days - 1)).strftime("%Y-%m-%d")
        rows = (
            conn(request)
            .execute("SELECT day, route, count FROM page_counts WHERE day >= ? ORDER BY day, route", (since,))
            .fetchall()
        )
        by_day: dict[str, dict[str, int]] = {}
        totals: dict[str, int] = {}
        for row in rows:
            by_day.setdefault(row["day"], {})[row["route"]] = row["count"]
            totals[row["route"]] = totals.get(row["route"], 0) + row["count"]
        return {"since": since, "days": by_day, "totals": totals}

    return r
