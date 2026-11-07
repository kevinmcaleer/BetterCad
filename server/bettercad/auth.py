"""Accounts and sessions (#88).

A small stand-in for markdown-studio's powertools-auth with the same shape: server-side sessions in SQLite, an
HttpOnly cookie, a CSRF token on every change, and a limit on failed sign-ins. Passwords use scrypt from the
standard library. Whether BetterCad shares kevsrobots' login is Kev's call; swapping this module for
powertools-auth keeps the `current_user` and `writer` dependencies the rest of the API uses.
"""

import hashlib
import hmac
import secrets
import sqlite3
import time
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

COOKIE = "bc_session"
CSRF_HEADER = "X-CSRF-Token"
SESSION_DAYS = 30
FAIL_LIMIT = 10
FAIL_WINDOW = 15 * 60
WAIT = "Too many tries. Wait 15 minutes, then try again."
WRONG = "That email and password don't match."


@dataclass
class User:
    id: int
    email: str
    name: str
    theme: str | None
    csrf: str
    token: str


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    key = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1, dklen=32)
    return f"scrypt${salt.hex()}${key.hex()}"


def check_password(password: str, stored: str) -> bool:
    try:
        _, salt, key = stored.split("$")
        got = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=2**14, r=8, p=1, dklen=32)
    except ValueError:
        return False
    return hmac.compare_digest(got.hex(), key)


def conn(request: Request) -> sqlite3.Connection:
    return request.app.state.db


def _now() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%d %H:%M:%S")


def current_user(request: Request) -> User:
    """The signed-in user, or 401."""
    token = request.cookies.get(COOKIE)
    if token:
        row = (
            conn(request)
            .execute(
                "SELECT u.id, u.email, u.name, u.theme, s.csrf FROM sessions s JOIN users u ON u.id = s.user_id "
                "WHERE s.token = ? AND s.expires > ?",
                (token, _now()),
            )
            .fetchone()
        )
        if row:
            return User(row["id"], row["email"], row["name"], row["theme"], row["csrf"], token)
    raise HTTPException(401, "Sign in to do that.")


CurrentUser = Annotated[User, Depends(current_user)]


def writer(request: Request, user: CurrentUser) -> User:
    """The signed-in user, for a request that changes something: it must carry the session's CSRF token."""
    sent = request.headers.get(CSRF_HEADER, "")
    if not hmac.compare_digest(sent, user.csrf):
        raise HTTPException(403, "This page is out of date. Reload it and try again.")
    return user


Writer = Annotated[User, Depends(writer)]


class SignUp(BaseModel):
    email: str = Field(min_length=3, max_length=200, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    name: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=8, max_length=200)


class SignIn(BaseModel):
    email: str = Field(max_length=200)
    password: str = Field(max_length=200)


class AccountChange(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    theme: str | None = Field(default=None, max_length=20)
    password: str | None = Field(default=None, min_length=8, max_length=200)
    current_password: str | None = Field(default=None, max_length=200)


def me(user: User) -> dict:
    return {"id": user.id, "email": user.email, "name": user.name, "theme": user.theme, "csrf": user.csrf}


def router(secure: bool) -> APIRouter:
    r = APIRouter(prefix="/api/auth", tags=["auth"])

    def start_session(response: Response, db: sqlite3.Connection, user_id: int) -> User:
        token = secrets.token_urlsafe(32)
        csrf = secrets.token_urlsafe(24)
        expires = (datetime.now(UTC) + timedelta(days=SESSION_DAYS)).strftime("%Y-%m-%d %H:%M:%S")
        with db:
            db.execute(
                "INSERT INTO sessions (token, user_id, csrf, expires) VALUES (?, ?, ?, ?)", (token, user_id, csrf, expires)
            )
        response.set_cookie(COOKIE, token, max_age=SESSION_DAYS * 86400, httponly=True, secure=secure, samesite="lax", path="/")
        row = db.execute("SELECT id, email, name, theme FROM users WHERE id = ?", (user_id,)).fetchone()
        return User(row["id"], row["email"], row["name"], row["theme"], csrf, token)

    def too_many(db: sqlite3.Connection, keys: list[str]) -> bool:
        since = time.time() - FAIL_WINDOW
        for key in keys:
            n = db.execute("SELECT COUNT(*) FROM sign_in_failures WHERE key = ? AND at > ?", (key, since)).fetchone()[0]
            if n >= FAIL_LIMIT:
                return True
        return False

    @r.post("/signup", status_code=201)
    def signup(body: SignUp, request: Request, response: Response) -> dict:
        db = conn(request)
        try:
            with db:
                cur = db.execute(
                    "INSERT INTO users (email, name, password) VALUES (?, ?, ?)",
                    (body.email.strip(), body.name.strip(), hash_password(body.password)),
                )
        except sqlite3.IntegrityError:
            raise HTTPException(409, "There's already an account with that email. Sign in instead.") from None
        return me(start_session(response, db, cur.lastrowid or 0))

    @r.post("/signin")
    def signin(body: SignIn, request: Request, response: Response) -> dict:
        db = conn(request)
        ip = request.client.host if request.client else "unknown"
        keys = [f"ip:{ip}", f"email:{body.email.strip().lower()}"]
        if too_many(db, keys):
            raise HTTPException(429, WAIT)
        row = db.execute("SELECT id, password FROM users WHERE email = ?", (body.email.strip(),)).fetchone()
        if not row or not check_password(body.password, row["password"]):
            with db:
                db.executemany("INSERT INTO sign_in_failures VALUES (?, ?)", [(k, time.time()) for k in keys])
            raise HTTPException(401, WRONG)
        return me(start_session(response, db, row["id"]))

    @r.post("/signout")
    def signout(request: Request, response: Response, user: Writer) -> dict:
        db = conn(request)
        with db:
            db.execute("DELETE FROM sessions WHERE token = ?", (user.token,))
        response.delete_cookie(COOKIE, path="/")
        return {"ok": True}

    @r.get("/me")
    def get_me(user: CurrentUser) -> dict:
        return me(user)

    @r.patch("/me")
    def change(body: AccountChange, request: Request, user: Writer) -> dict:
        db = conn(request)
        with db:
            if body.password is not None:
                row = db.execute("SELECT password FROM users WHERE id = ?", (user.id,)).fetchone()
                if not check_password(body.current_password or "", row["password"]):
                    raise HTTPException(400, "Your current password isn't right.")
                db.execute("UPDATE users SET password = ? WHERE id = ?", (hash_password(body.password), user.id))
                db.execute("DELETE FROM sessions WHERE user_id = ? AND token != ?", (user.id, user.token))
            if body.name is not None:
                db.execute("UPDATE users SET name = ? WHERE id = ?", (body.name.strip(), user.id))
            if body.theme is not None:
                db.execute("UPDATE users SET theme = ? WHERE id = ?", (body.theme, user.id))
        return get_me(current_user(request))

    @r.delete("/me")
    def delete_account(request: Request, response: Response, user: Writer) -> dict:
        db = conn(request)
        with db:
            db.execute("DELETE FROM users WHERE id = ?", (user.id,))
        request.app.state.blobs.forget_user(user.id)
        response.delete_cookie(COOKIE, path="/")
        return {"ok": True}

    return r
