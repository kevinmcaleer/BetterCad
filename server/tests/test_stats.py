import sqlite3

from conftest import sign_up


def test_a_ping_counts_the_page_for_today(make_client):
    with make_client() as client:
        for route in ["editor", "editor", "library", "/etc/passwd"]:
            assert client.post("/api/ping", json={"route": route}).status_code == 204
        db: sqlite3.Connection = client.app.state.db
        rows = {r["route"]: r["count"] for r in db.execute("SELECT route, count FROM page_counts")}
        assert rows == {"editor": 2, "library": 1, "other": 1}


def test_a_ping_stores_nothing_about_who_sent_it(make_client):
    with make_client() as client:
        r = client.post("/api/ping", json={"route": "editor"}, headers={"User-Agent": "Secret/1.0"})
        assert "set-cookie" not in r.headers
        db: sqlite3.Connection = client.app.state.db
        assert [c[1] for c in db.execute("PRAGMA table_info(page_counts)")] == ["day", "route", "count"]


def test_stats_need_a_listed_account(make_client):
    with make_client(stats_emails="kev@example.com") as client:
        assert client.get("/api/stats").status_code == 401
        client.post("/api/ping", json={"route": "editor"})
        sign_up(client)
        r = client.get("/api/stats")
        assert r.status_code == 200
        assert r.json()["totals"] == {"editor": 1}
    with make_client() as client:
        sign_up(client, email="someone@example.com", name="someone")
        assert client.get("/api/stats").status_code == 403
