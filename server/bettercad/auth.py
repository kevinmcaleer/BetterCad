"""Accounts (#88): BetterCad signs people in with their kevsrobots.com account.

kevsrobots.com's accounts live in Chatter (https://chatter.kevsrobots.com). Signing in there sets an `access_token`
cookie on `.kevsrobots.com`, so the browser sends it to bettercad.kevsrobots.com too. BetterCad never sees a password:
it asks Chatter who the cookie belongs to (`GET /accounts/me`, cached for a minute) and keeps what only it needs in
`accounts`, keyed by the kevsrobots.com user id: the theme and the name shown on share links. Models, imported files
and printer profiles hang off that row.

Changes carry a CSRF token: an HMAC of the cookie with BetterCad's SECRET_KEY, handed out by `/api/auth/session`.
"""

import hashlib
import hmac
import json
import logging
import sqlite3
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass
from typing import Annotated

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request, Response
from pydantic import BaseModel, Field

from .settings import Settings

log = logging.getLogger("bettercad.auth")

COOKIE = "access_token"
CSRF_HEADER = "X-CSRF-Token"
CACHE_SECONDS = 60
UNREACHABLE = "kevsrobots.com sign-in can't be reached just now. Try again in a minute."

# Asks kevsrobots.com who a token belongs to: the user (id, username, email), None when it isn't signed in, or an
# OSError when kevsrobots.com can't be reached. Tests swap it for a fake on app.state.identify.
Identify = Callable[[str], dict | None]


@dataclass
class User:
    id: int
    username: str
    email: str | None
    theme: str | None
    token: str

    @property
    def name(self) -> str:
        return self.username


def conn(request: Request) -> sqlite3.Connection:
    return request.app.state.db


def bearer(request: Request) -> str | None:
    """The kevsrobots.com token from the cookie (`Bearer <jwt>`) or an Authorization header."""
    for raw in (request.cookies.get(COOKIE, ""), request.headers.get("authorization", "")):
        raw = raw.strip().strip('"')
        if raw.lower().startswith("bearer ") and raw[7:].strip():
            return raw[7:].strip()
    return None


def chatter_identify(base: str, timeout: float = 5) -> Identify:
    """Looks the token up with Chatter's `/accounts/me`, remembering answers for a minute."""
    cache: dict[str, tuple[float, dict | None]] = {}
    lock = threading.Lock()

    def identify(token: str) -> dict | None:
        key = hashlib.sha256(token.encode()).hexdigest()
        now = time.monotonic()
        with lock:
            hit = cache.get(key)
            if hit and hit[0] > now:
                return hit[1]
        req = urllib.request.Request(
            f"{base.rstrip('/')}/accounts/me",
            headers={"Authorization": f"Bearer {token}", "Accept": "application/json", "User-Agent": "BetterCad"},
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:  # noqa: S310 (a fixed https URL from settings)
                data = json.loads(r.read())
            user = {"id": int(data["id"]), "username": str(data["username"]), "email": data.get("email")}
        except urllib.error.HTTPError as e:
            if e.code not in (401, 403, 404):
                raise OSError(f"kevsrobots.com answered {e.code}") from e
            user = None
        except (ValueError, KeyError, TypeError) as e:
            raise OSError("kevsrobots.com sent an answer BetterCad doesn't understand") from e
        with lock:
            if len(cache) > 10_000:
                cache.clear()
            cache[key] = (now + CACHE_SECONDS, user)
        return user

    return identify


def _who(request: Request) -> dict | None:
    """The kevsrobots.com user behind this request, once per request."""
    if not hasattr(request.state, "who"):
        token = bearer(request)
        try:
            request.state.who = request.app.state.identify(token) if token else None
        except OSError as e:
            log.warning("couldn't check a sign-in with kevsrobots.com: %s", e)
            raise HTTPException(503, UNREACHABLE) from None
    return request.state.who


def current_user(request: Request) -> User:
    """The signed-in user, or 401. Their BetterCad account row is made the first time they arrive."""
    who = _who(request)
    if who is None:
        raise HTTPException(401, "Sign in to do that.")
    db = conn(request)
    acct = db.execute("SELECT name, theme FROM accounts WHERE id = ?", (who["id"],)).fetchone()
    if acct is None or acct["name"] != who["username"]:
        with db:
            db.execute(
                "INSERT INTO accounts (id, name) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET name = excluded.name",
                (who["id"], who["username"]),
            )
    return User(who["id"], who["username"], who.get("email"), acct["theme"] if acct else None, bearer(request) or "")


CurrentUser = Annotated[User, Depends(current_user)]


def csrf_for(request: Request, token: str) -> str:
    return hmac.new(request.app.state.secret.encode(), f"csrf:{token}".encode(), hashlib.sha256).hexdigest()


def writer(request: Request, user: CurrentUser) -> User:
    """The signed-in user, for a request that changes something: it must carry the CSRF token."""
    if not hmac.compare_digest(request.headers.get(CSRF_HEADER, ""), csrf_for(request, user.token)):
        raise HTTPException(403, "This page is out of date. Reload it and try again.")
    return user


Writer = Annotated[User, Depends(writer)]


def account_json(request: Request, user: User) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "name": user.username,
        "email": user.email,
        "theme": user.theme,
        "csrf": csrf_for(request, user.token),
    }


class AccountChange(BaseModel):
    theme: str | None = Field(default=None, max_length=20)


class Forget(BaseModel):
    confirm_username: str = ""


def check_auth_source(main: sqlite3.Connection, source: str) -> None:
    """Account ids are user ids of the sign-in in use, so changing sign-in would hand models to strangers."""
    row = main.execute("SELECT value FROM meta WHERE key = 'auth_source'").fetchone()
    if row is None or row[0] == source or not main.execute("SELECT 1 FROM accounts LIMIT 1").fetchone():
        with main:
            main.execute("INSERT OR REPLACE INTO meta VALUES ('auth_source', ?)", (source,))
        return
    raise RuntimeError(
        f"BetterCad's accounts were made with the {row[0]} sign-in, not {source}. Their ids don't carry over, so "
        "start from an empty database (docs/deploy.md, 'Signing in with kevsrobots.com')."
    )


def install(app: FastAPI, settings: Settings) -> None:
    app.state.identify = chatter_identify(settings.chatter_url)
    app.state.secret = settings.secret_key or "dev-only-secret"
    here = settings.public_url.rstrip("/")

    def links(next_hash: str = "#/library") -> dict:
        back = urllib.parse.quote(f"{here}/{next_hash}" if here else "", safe="")
        tail = f"?return_to={back}" if here else ""
        base = settings.chatter_url.rstrip("/")
        return {"signin_url": f"{base}/login{tail}", "signup_url": f"{base}/register{tail}", "account_url": f"{base}/account"}

    r = APIRouter(prefix="/api/auth", tags=["auth"])

    @r.get("/session")
    def session(request: Request, next: str = "#/library") -> dict:
        """Who is signed in, the CSRF token for their changes, and where to sign in on kevsrobots.com."""
        who = _who(request)
        token = bearer(request)
        safe_next = next if next.startswith("#/") and len(next) < 200 else "#/library"
        return {
            "user": who,
            "csrf_token": csrf_for(request, token) if who and token else "",
            **links(safe_next),
        }

    @r.post("/logout")
    def logout(response: Response, user: Writer) -> dict:
        """Signs out of kevsrobots.com here: the cookie is the suite's, so this signs out of every kevsrobots app."""
        for name in (COOKIE, "username"):
            response.delete_cookie(name, path="/", domain=settings.cookie_domain or None)
        return {"user": None, "csrf_token": ""}

    app.include_router(r)

    acc = APIRouter(prefix="/api/account", tags=["auth"])

    @acc.get("")
    def get_account(request: Request, user: CurrentUser) -> dict:
        return account_json(request, user)

    @acc.patch("")
    def change(body: AccountChange, request: Request, user: Writer) -> dict:
        if body.theme is not None:
            db = conn(request)
            with db:
                db.execute("UPDATE accounts SET theme = ? WHERE id = ?", (body.theme, user.id))
            user.theme = body.theme
        return account_json(request, user)

    @acc.delete("")
    def leave(body: Forget, request: Request, user: Writer) -> dict:
        """Deletes your models, files and settings here. Your kevsrobots.com account stays."""
        if body.confirm_username.strip().lower() != user.username.lower():
            raise HTTPException(400, "Type your username exactly to confirm.")
        db = conn(request)
        with db:
            db.execute("DELETE FROM accounts WHERE id = ?", (user.id,))
        request.app.state.blobs.forget_user(user.id)
        return {"ok": True}

    app.include_router(acc)
