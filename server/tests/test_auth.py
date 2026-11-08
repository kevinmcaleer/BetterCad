import hashlib
import secrets
import sqlite3

import pytest
from conftest import BCAD, PASSWORD, csrf, sign_up

from bettercad import auth
from bettercad.main import create_app
from bettercad.settings import Settings


def legacy_hash(password: str) -> str:
    salt = secrets.token_bytes(16)
    key = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1, dklen=32)
    return f"scrypt${salt.hex()}${key.hex()}"


def test_legacy_password_check():
    h = legacy_hash("hunter22")
    assert auth.check_legacy_password("hunter22", h)
    assert not auth.check_legacy_password("hunter23", h)
    assert not auth.check_legacy_password("x", "nonsense")


def test_sign_up_sign_in_and_out(make_client):
    with make_client() as client:
        me = sign_up(client)
        assert me["username"] == "Kev" and me["email"] == "kev@example.com"
        cookie = client.cookies.get("bc_session")
        assert cookie
        account = client.get("/api/account").json()
        assert account["name"] == "Kev" and account["theme"] is None and account["csrf"]
        # Sign out needs the CSRF token.
        token = client.headers.pop("X-CSRF-Token")
        assert client.post("/api/auth/logout").status_code == 403
        client.headers["X-CSRF-Token"] = token
        r = client.post("/api/auth/logout")
        assert r.status_code == 200 and r.json()["user"] is None
        assert client.get("/api/account").status_code == 401
        # The old cookie is dead on the server too.
        client.cookies.set("bc_session", cookie)
        assert client.get("/api/account").status_code == 401
        client.cookies.delete("bc_session")
        csrf(client)
        # By username or by email, any case.
        for login in ["kev", "KEV@example.com"]:
            r = client.post("/api/auth/login", json={"username": login, "password": PASSWORD})
            assert r.status_code == 200, r.text
            cookie = r.headers["set-cookie"].lower()
            assert "httponly" in cookie and "samesite=lax" in cookie
            client.headers["X-CSRF-Token"] = r.json()["csrf_token"]


def test_cookie_is_secure_in_production(make_client):
    with make_client(env="production", secret_key="x") as client:
        csrf(client)
        r = client.post("/api/auth/register", json={"username": "abc", "email": "a@b.co", "password": PASSWORD})
    assert "secure" in r.headers["set-cookie"].lower()


def test_sign_up_refuses_duplicates_and_bad_input(make_client):
    with make_client() as client:
        sign_up(client)
        client.post("/api/auth/logout")
        csrf(client)
        r = client.post("/api/auth/register", json={"username": "kev", "email": "x@y.co", "password": PASSWORD})
        assert r.status_code == 400 and "taken" in r.json()["detail"]
        r = client.post("/api/auth/register", json={"username": "other", "email": "kev@example.com", "password": PASSWORD})
        assert r.status_code == 400 and "already" in r.json()["detail"]
        assert client.post("/api/auth/register", json={"username": "ok-name", "password": "short"}).status_code == 400


def test_failed_sign_ins_are_limited(make_client):
    with make_client() as client:
        sign_up(client)
        client.post("/api/auth/logout")
        client.cookies.clear()
        csrf(client)
        for _ in range(10):
            r = client.post("/api/auth/login", json={"username": "kev", "password": "wrong"})
            assert r.status_code == 401
            assert r.json()["detail"] == "That username and password don't match."
        r = client.post("/api/auth/login", json={"username": "kev", "password": PASSWORD})
        assert r.status_code == 429 and "wait" in r.json()["detail"]


def test_theme_and_password_change(user):
    assert user.patch("/api/account", json={"theme": "holodeck"}).json()["theme"] == "holodeck"
    assert user.get("/api/account").json()["theme"] == "holodeck"
    r = user.post("/api/auth/password", json={"current_password": "nope", "new_password": "another long one"})
    assert r.status_code == 400
    r = user.post("/api/auth/password", json={"current_password": PASSWORD, "new_password": "another long one"})
    assert r.status_code == 200
    user.headers["X-CSRF-Token"] = r.json()["csrf_token"]
    assert user.get("/api/account").status_code == 200


def test_leaving_deletes_models_and_the_login(user):
    m = user.post("/api/models", json={"name": "Box", "bcad": BCAD}).json()
    assert user.request("DELETE", "/api/account", json={"confirm_username": "nope"}).status_code == 400
    assert user.request("DELETE", "/api/account", json={"confirm_username": "kev"}).status_code == 200
    db: sqlite3.Connection = user.app.state.db
    assert db.execute("SELECT COUNT(*) FROM models WHERE id = ?", (m["id"],)).fetchone()[0] == 0
    assert db.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 0
    assert user.get("/api/account").status_code == 401
    # The package's own delete is not mounted: leaving goes through /api/account.
    assert user.post("/api/auth/delete-account", json={"confirm_username": "kev"}).status_code == 404


def shared_settings(tmp_path, app: str, **extra) -> Settings:
    return Settings(
        data_dir=tmp_path / app,
        auth_database_path=tmp_path / "suite.db",
        cookie_prefix="ms",
        version="test",
        jobs=False,
        **extra,
    )


def test_shared_login_uses_the_suite_users(tmp_path):
    from fastapi.testclient import TestClient

    # Another app made the suite's users table first and signed someone up.
    suite = auth.open_auth_db(tmp_path / "suite.db")
    auth.migrate_auth(suite)
    from powertools_auth import store

    store.create_user(suite, "maker", PASSWORD, "maker@example.com")
    token = store.create_session(suite, 1, 3600)
    suite.close()

    with TestClient(create_app(shared_settings(tmp_path, "bc"))) as client:
        # A session from the other app is a session here.
        client.cookies.set("ms_session", token)
        account = client.get("/api/account").json()
        assert account["username"] == "maker"
        client.headers["X-CSRF-Token"] = account["csrf"]
        assert client.post("/api/models", json={"name": "Box", "bcad": BCAD}).status_code == 201
        # BetterCad's tables stay in its own database.
        own = sqlite3.connect(tmp_path / "bc" / "bettercad.db")
        assert own.execute("SELECT name FROM sqlite_master WHERE name = 'users'").fetchone() is None
        # Leaving deletes BetterCad's data but keeps the suite account for the other apps.
        assert client.request("DELETE", "/api/account", json={"confirm_username": "maker"}).status_code == 200
    suite = sqlite3.connect(tmp_path / "suite.db")
    assert suite.execute("SELECT username FROM users").fetchall() == [("maker",)]


def test_legacy_accounts_move_to_the_new_sign_in(tmp_path):
    from fastapi.testclient import TestClient

    from bettercad import db as dbmod

    # A database from before #88, with one stand-in account and a model.
    path = tmp_path / "bettercad.db"
    c = dbmod.connect(path)
    c.execute("CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)")
    for sql in sorted(dbmod.MIGRATIONS.glob("*.sql"))[:4]:
        with c:
            c.executescript(sql.read_text())
            c.execute("INSERT INTO schema_version VALUES (?, datetime('now'))", (int(sql.name[:4]),))
    with c:
        old = (legacy_hash("hunter22"),)
        c.execute("INSERT INTO users (id, email, name, password) VALUES (7, 'old@example.com', 'Old', ?)", old)
        c.execute("INSERT INTO models (id, user_id, name) VALUES ('m1', 7, 'Bracket')")
    c.close()

    with TestClient(create_app(Settings(data_dir=tmp_path, version="test", jobs=False))) as client:
        csrf(client)
        r = client.post("/api/auth/login", json={"username": "old@example.com", "password": "hunter22"})
        assert r.status_code == 200, r.text
        assert r.json()["user"] == {**r.json()["user"], "id": 7, "username": "old"}
        assert [m["name"] for m in client.get("/api/models").json()["models"]] == ["Bracket"]
        stored = client.app.state.db.execute("SELECT password_hash FROM users WHERE id = 7").fetchone()[0]
        assert stored.startswith("$argon2id$")

    # Pointing an install that has accounts at a different users database is refused.
    with pytest.raises(RuntimeError, match="isn't supported"):
        with TestClient(create_app(Settings(data_dir=tmp_path, auth_database_path=tmp_path / "x.db", jobs=False))):
            pass
