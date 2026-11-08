import json
import sqlite3
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest
from conftest import BCAD, sign_up
from fastapi.testclient import TestClient

from bettercad import auth
from bettercad.main import create_app
from bettercad.settings import Settings


def test_signed_out_session_points_at_kevsrobots(make_client):
    with make_client(public_url="https://bettercad.kevsrobots.com") as client:
        s = client.get("/api/auth/session?next=%23%2Faccount").json()
        assert s["user"] is None and s["csrf_token"] == ""
        assert s["signin_url"] == (
            "https://chatter.kevsrobots.com/login?return_to=https%3A%2F%2Fbettercad.kevsrobots.com%2F%23%2Faccount"
        )
        assert s["signup_url"].startswith("https://chatter.kevsrobots.com/register?return_to=")
        assert client.get("/api/account").status_code == 401
        # Anything but a hash route falls back to the library, so the link can't be bent elsewhere.
        assert "%23%2Flibrary" in client.get("/api/auth/session?next=https://evil.example").json()["signin_url"]


def test_the_kevsrobots_cookie_signs_you_in(make_client):
    with make_client() as client:
        me = sign_up(client)
        assert me["username"] == "Kev" and me["name"] == "Kev" and me["email"] == "kev@example.com" and me["csrf"]
        assert client.get("/api/auth/session").json()["user"]["username"] == "Kev"
        # The account row is made on first sight, keyed by the kevsrobots.com id.
        assert [tuple(r) for r in client.app.state.db.execute("SELECT id, name FROM accounts")] == [(100, "Kev")]
        # An Authorization header works too.
        token = client.cookies.get("access_token").strip('"')[7:]
        client.cookies.clear()
        assert client.get("/api/account", headers={"Authorization": f"Bearer {token}"}).status_code == 200
        assert client.get("/api/account", headers={"Authorization": "Bearer nope"}).status_code == 401


def test_changes_need_the_csrf_token(user):
    token = user.headers.pop("X-CSRF-Token")
    assert user.patch("/api/account", json={"theme": "dark"}).status_code == 403
    user.headers["X-CSRF-Token"] = token
    assert user.patch("/api/account", json={"theme": "holodeck"}).json()["theme"] == "holodeck"
    assert user.get("/api/account").json()["theme"] == "holodeck"


def test_sign_out_clears_the_suite_cookie(make_client):
    with make_client(cookie_domain=".kevsrobots.com") as client:
        sign_up(client)
        r = client.post("/api/auth/logout")
        assert r.status_code == 200
        cookies = r.headers.get_list("set-cookie")
        assert any(c.startswith("access_token=") and "Domain=.kevsrobots.com" in c and "Max-Age=0" in c for c in cookies)


def test_kevsrobots_being_down_is_a_503_not_a_sign_out(make_client):
    with make_client() as client:
        sign_up(client)
        client.kevsrobots.down = True
        r = client.get("/api/account")
        assert r.status_code == 503 and "kevsrobots.com" in r.json()["detail"]


def test_leaving_deletes_bettercad_data_only(user):
    m = user.post("/api/models", json={"name": "Box", "bcad": BCAD}).json()
    assert user.request("DELETE", "/api/account", json={"confirm_username": "nope"}).status_code == 400
    assert user.request("DELETE", "/api/account", json={"confirm_username": "kev"}).status_code == 200
    db: sqlite3.Connection = user.app.state.db
    assert db.execute("SELECT COUNT(*) FROM models WHERE id = ?", (m["id"],)).fetchone()[0] == 0
    # Still signed in to kevsrobots.com: coming back starts a fresh, empty BetterCad account.
    assert user.get("/api/models").json()["total"] == 0


def test_accounts_from_another_sign_in_are_refused(tmp_path):
    with TestClient(create_app(Settings(data_dir=tmp_path, version="test", jobs=False))) as client:
        db = client.app.state.db
        with db:
            db.execute("INSERT INTO accounts (id, name) VALUES (1, 'old')")
            db.execute("UPDATE meta SET value = 'local' WHERE key = 'auth_source'")
    with pytest.raises(RuntimeError, match="empty database"):
        with TestClient(create_app(Settings(data_dir=tmp_path, version="test", jobs=False))):
            pass


class Chatter(BaseHTTPRequestHandler):
    calls = 0

    def do_GET(self):  # noqa: N802
        Chatter.calls += 1
        if self.path != "/accounts/me":
            self.send_response(404)
            self.end_headers()
            return
        tok = self.headers.get("Authorization", "")
        if tok == "Bearer good":
            body = json.dumps({"id": 7, "username": "maker", "email": "m@example.com", "firstname": "M"}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(body)
        elif tok == "Bearer broken":
            self.send_response(500)
            self.end_headers()
        else:
            self.send_response(401)
            self.end_headers()

    def log_message(self, *args):
        pass


def test_chatter_lookup_and_cache():
    server = HTTPServer(("127.0.0.1", 0), Chatter)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        identify = auth.chatter_identify(f"http://127.0.0.1:{server.server_port}")
        assert identify("good") == {"id": 7, "username": "maker", "email": "m@example.com"}
        assert identify("good")["id"] == 7
        assert Chatter.calls == 1
        assert identify("expired") is None
        with pytest.raises(OSError):
            identify("broken")
    finally:
        server.shutdown()
    with pytest.raises(OSError):
        auth.chatter_identify("http://127.0.0.1:9", timeout=1)("x")
