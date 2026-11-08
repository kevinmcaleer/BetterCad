"""Accounts and sessions (#88): powertools-auth, the login Kev's other apps use.

The package (from kevinmcaleer/markdown-studio) owns the `users`, `sessions` and `password_resets` tables, argon2id
passwords, the session cookie, CSRF tokens and the sign-in rate limit, and serves `/api/auth/*`. BetterCad adds:

- `accounts`: one row per person who has used BetterCad, keyed by their shared user id, holding what only BetterCad
  needs (the theme, and the name shown on share links). Models, blobs and printer profiles hang off it.
- Sign-in by username *or* email, and upgrading a password made by the old stand-in login (scrypt) to argon2id.
- `/api/account`: the theme, and deleting your BetterCad data.

Shared login: point `AUTH_DATABASE_PATH` at the database that holds the suite's users (the same SQLite file the other
apps open), and set `COOKIE_DOMAIN` and `COOKIE_PREFIX` to theirs. One account then works across the apps, and a
session started in one is a session in all of them. Left unset, the auth tables live in BetterCad's own database.
"""

import hashlib
import hmac
import sqlite3
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated

import powertools_auth
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request, Response
from powertools_auth import Auth, AuthSettings, SmtpMailer, store
from powertools_auth.api import LoginBody
from powertools_auth.security import hash_password, new_token
from pydantic import BaseModel, Field

from .settings import Settings

# The stand-in login's hashes, kept until each person signs in once more.
LEGACY = "scrypt$"


@dataclass
class User:
    id: int
    username: str
    email: str | None
    theme: str | None

    @property
    def name(self) -> str:
        return self.username


def conn(request: Request) -> sqlite3.Connection:
    return request.app.state.db


def check_legacy_password(password: str, stored: str) -> bool:
    try:
        _, salt, key = stored.split("$")
        got = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=2**14, r=8, p=1, dklen=32)
    except ValueError:
        return False
    return hmac.compare_digest(got.hex(), key)


# ----------------------------------------------------------------------------------------------- database


def open_auth_db(path: Path) -> sqlite3.Connection:
    """A connection to the auth database in autocommit mode, as powertools-auth expects."""
    path.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(path, timeout=15, check_same_thread=False, isolation_level=None)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA foreign_keys = ON")
    c.execute("PRAGMA journal_mode = WAL")
    c.execute("PRAGMA busy_timeout = 15000")
    return c


def migrate_auth(c: sqlite3.Connection) -> list[str]:
    """Applies powertools-auth's migrations, recorded the way markdown-studio records them (`schema_migrations`,
    component `auth`), so whichever app opens a shared database first sets it up and the others agree."""
    c.execute(
        "CREATE TABLE IF NOT EXISTS schema_migrations (component TEXT NOT NULL, version INTEGER NOT NULL, "
        "name TEXT NOT NULL, applied_at TEXT NOT NULL, PRIMARY KEY (component, version))"
    )
    done = {r[0] for r in c.execute("SELECT version FROM schema_migrations WHERE component = 'auth'")}
    applied = []
    for file in sorted(powertools_auth.migrations_dir().glob("*.sql")):
        version = int(file.name.split("_", 1)[0])
        if version in done:
            continue
        try:
            c.executescript(
                "BEGIN;\n" + file.read_text(encoding="utf-8") + "\nINSERT INTO schema_migrations VALUES "
                f"('auth', {version}, '{file.stem}', '{store.utcnow()}');\nCOMMIT;"
            )
        except sqlite3.Error:
            if c.in_transaction:
                c.execute("ROLLBACK")
            raise
        applied.append(f"auth/{file.stem}")
    return applied


def _username(seed: str, taken: set[str]) -> str:
    base = "".join(ch if ch.isalnum() or ch in "._-" else "-" for ch in seed).strip("-.")[:28] or "maker"
    base = base if len(base) >= 3 else f"{base}-bc"
    name, n = base, 1
    while name.lower() in taken:
        n += 1
        name = f"{base}{n}"
    taken.add(name.lower())
    return name


def adopt_legacy_logins(main: sqlite3.Connection, auth_db: sqlite3.Connection, shared: bool) -> int:
    """Moves accounts made by the stand-in login into the auth tables, keeping their ids, so their models stay theirs.
    Each gets a username from the part of their email before the @; they can sign in with their email as before."""
    rows = main.execute("SELECT id, email, name, password, created FROM legacy_logins").fetchall()
    if not rows:
        return 0
    if shared:
        raise RuntimeError(
            "BetterCad has accounts from before the shared login. Start it once without AUTH_DATABASE_PATH to move "
            "them over, or remove them, before pointing it at the shared users."
        )
    taken = {r[0].lower() for r in auth_db.execute("SELECT username FROM users")}
    auth_db.execute("BEGIN IMMEDIATE")
    try:
        for r in rows:
            username = _username(r["email"].split("@")[0], taken)
            when = r["created"].replace(" ", "T") + ".000Z"
            auth_db.execute(
                "INSERT INTO users (id, username, email, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
                (r["id"], username, r["email"], r["password"], when, when),
            )
        auth_db.execute("COMMIT")
    except BaseException:
        auth_db.execute("ROLLBACK")
        raise
    with main:
        main.execute("DELETE FROM legacy_logins")
    return len(rows)


def check_auth_source(main: sqlite3.Connection, source: str) -> None:
    """Account ids are user ids in the auth database, so moving to a different one would hand models to strangers."""
    row = main.execute("SELECT value FROM meta WHERE key = 'auth_source'").fetchone()
    if row is None:
        with main:
            main.execute("INSERT INTO meta VALUES ('auth_source', ?)", (source,))
    elif row[0] != source and main.execute("SELECT 1 FROM accounts LIMIT 1").fetchone():
        raise RuntimeError(
            f"BetterCad's accounts belong to the users in {row[0]}, not {source}. Moving accounts between user "
            "databases isn't supported: set AUTH_DATABASE_PATH back, or start from an empty database."
        )
    elif row[0] != source:
        with main:
            main.execute("UPDATE meta SET value = ? WHERE key = 'auth_source'", (source,))


# ----------------------------------------------------------------------------------------------- the app's auth


def make_auth(settings: Settings) -> Auth:
    path = settings.auth_db_path

    def get_db() -> Iterator[sqlite3.Connection]:
        c = open_auth_db(path)
        try:
            yield c
        finally:
            c.close()

    mailer = None
    if settings.smtp_host and (settings.smtp_from or settings.smtp_user):
        mailer = SmtpMailer(
            host=settings.smtp_host,
            port=settings.smtp_port,
            sender=settings.smtp_from or settings.smtp_user,
            username=settings.smtp_user,
            password=settings.smtp_password,
        )
    return Auth(
        AuthSettings(
            secret_key=settings.secret_key or "dev-only-secret",
            https=settings.production,
            remember_me_max_age=60 * 60 * 24 * 30,
            # Ten tries in fifteen minutes from one address (#88).
            login_rate_limit=10,
            login_rate_window=15 * 60,
            cookie_prefix=settings.cookie_prefix,
            cookie_domain=settings.cookie_domain or None,
            app_name="BetterCad",
            public_url=settings.public_url,
            reset_path="/#/reset-password",
        ),
        get_db,
        mailer,
    )


def auth_of(request: Request) -> Auth:
    return request.app.state.auth


def _user_row(request: Request) -> sqlite3.Row | None:
    """The signed-in user from the auth database, once per request."""
    if not hasattr(request.state, "user"):
        auth = auth_of(request)
        c = open_auth_db(request.app.state.auth_path)
        try:
            request.state.user = store.session_user(c, request.cookies.get(auth.session_cookie))
        finally:
            c.close()
    return request.state.user


def current_user(request: Request) -> User:
    """The signed-in user, or 401. Their BetterCad account row is made the first time they arrive."""
    row = _user_row(request)
    if row is None:
        raise HTTPException(401, "Sign in to do that.")
    db = conn(request)
    acct = db.execute("SELECT name, theme FROM accounts WHERE id = ?", (row["id"],)).fetchone()
    if acct is None or acct["name"] != row["username"]:
        with db:
            db.execute(
                "INSERT INTO accounts (id, name) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET name = excluded.name",
                (row["id"], row["username"]),
            )
    return User(row["id"], row["username"], row["email"], acct["theme"] if acct else None)


CurrentUser = Annotated[User, Depends(current_user)]


async def verify_csrf(request: Request) -> None:
    try:
        await auth_of(request).verify_csrf(request)
    except HTTPException:
        raise HTTPException(403, "This page is out of date. Reload it and try again.") from None


def writer(user: CurrentUser, _: None = Depends(verify_csrf)) -> User:
    """The signed-in user, for a request that changes something: it must carry the CSRF token."""
    return user


Writer = Annotated[User, Depends(writer)]


def account_json(request: Request, user: User) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "name": user.username,
        "email": user.email,
        "theme": user.theme,
        "csrf": auth_of(request).csrf_token_for(request),
    }


class AccountChange(BaseModel):
    theme: str | None = Field(default=None, max_length=20)


class Forget(BaseModel):
    confirm_username: str = ""


def install(app: FastAPI, auth: Auth) -> None:
    """Mounts powertools-auth's routes under /api/auth, with BetterCad's sign-in in front, and /api/account."""

    # Like the package's install(), but the anonymous cookie (which lets the sign-in forms carry a CSRF token) is only
    # handed out by the sign-in API: the editor and page counts set no cookie for people who never sign in.
    @app.middleware("http")
    async def anon_cookie(request: Request, call_next):
        existing = request.cookies.get(auth.anon_cookie)
        request.state.anon_id = existing or new_token(16)
        response = await call_next(request)
        if not existing and request.url.path.startswith("/api/auth/"):
            auth._set_cookie(request, response, auth.anon_cookie, request.state.anon_id)
        return response

    guard = [Depends(auth.verify_csrf)]

    ours = APIRouter(prefix="/api/auth", tags=["auth"], dependencies=guard)

    @ours.post("/login")
    def login(
        body: LoginBody, request: Request, response: Response, c: Annotated[sqlite3.Connection, Depends(auth.get_db)]
    ) -> dict:
        """The package's sign-in, taking an email address as well as a username."""
        auth._rate_limit(request, "login")
        found = store.find_user_by_login(c, body.username) if body.username.strip() else None
        if found is not None and found["password_hash"].startswith(LEGACY):
            if check_legacy_password(body.password, found["password_hash"]):
                c.execute(
                    "UPDATE users SET password_hash = ? WHERE id = ?",
                    (hash_password(body.password), found["id"]),
                )
        user = store.authenticate(c, found["username"] if found else body.username, body.password)
        if user is None:
            raise HTTPException(401, "That username and password don't match.")
        store.delete_session(c, request.cookies.get(auth.session_cookie))
        token = auth.start_session(request, response, c, user["id"], body.remember)
        return {"user": store.public_user(user), "csrf_token": auth.csrf_token_for(request, token)}

    app.include_router(ours)
    # Deleting the shared account from here would delete it from every app, so /api/account handles leaving instead.
    replaced = {"/api/auth/login", "/api/auth/delete-account"}
    auth.router.routes = [r for r in auth.router.routes if getattr(r, "path", "") not in replaced]
    app.include_router(auth.router, dependencies=guard)

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
    def leave(body: Forget, request: Request, response: Response, user: Writer) -> dict:
        """Deletes your models, files and settings here. With BetterCad's own users it deletes the login too; with
        the shared login the account stays for the other apps, and you are signed out."""
        if body.confirm_username.strip().lower() != user.username.lower():
            raise HTTPException(400, "Type your username exactly to confirm.")
        db = conn(request)
        with db:
            db.execute("DELETE FROM accounts WHERE id = ?", (user.id,))
        request.app.state.blobs.forget_user(user.id)
        c = open_auth_db(request.app.state.auth_path)
        try:
            if not request.app.state.shared_login:
                store.delete_user(c, user.id)
            auth.end_session(request, response, c)
        finally:
            c.close()
        return {"ok": True, "csrf_token": auth.csrf_token_for(None, request.state.anon_id)}

    app.include_router(acc)
