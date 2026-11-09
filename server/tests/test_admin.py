import sqlite3

from conftest import BCAD, sign_up


def save(client, name: str) -> dict:
    return client.post("/api/models", json={"name": name, "bcad": BCAD}).json()


def test_admins_see_every_user_and_their_models(make_client):
    with make_client(admin_emails="kev@example.com") as client:
        sign_up(client, email="ada@example.com", name="ada")
        save(client, "Gripper")
        rover = save(client, "Rover")
        client.delete(f"/api/models/{rover['id']}")
        assert client.get("/api/account").json()["admin"] is False
        assert client.get("/api/admin/users").status_code == 403

        client.cookies.clear()
        me = sign_up(client)
        assert me["admin"] is True
        r = client.get("/api/admin/users").json()
        assert r["totals"]["users"] == 2 and r["totals"]["models"] == 2
        ada = next(u for u in r["users"] if u["username"] == "ada")
        assert [m["name"] for m in ada["models"]] == ["Rover", "Gripper"]
        assert ada["models"][0]["deleted_at"] is not None and ada["models"][1]["deleted_at"] is None
        assert ada["models"][1]["versions"] == 1 and ada["size"] > 0
        assert ada["last_seen"] and not ada["set_aside"]
        assert "bcad" not in ada["models"][0]
        kev = next(u for u in r["users"] if u["username"] == "Kev")
        assert kev["models"] == []

        # A model's picture, for the admin only.
        pic = client.get(ada["models"][1]["thumbnail"])
        assert pic.status_code == 200 and pic.headers["content-type"] == "image/png"


def test_admin_falls_back_to_stats_emails_and_needs_a_sign_in(make_client):
    with make_client(stats_emails="kev@example.com") as client:
        assert client.get("/api/admin/users").status_code == 401
        sign_up(client)
        assert client.get("/api/admin/users").status_code == 200
    with make_client(admin_emails="someone@example.com", stats_emails="kev@example.com") as client:
        sign_up(client)
        assert client.get("/api/admin/users").status_code == 403
        assert client.get("/api/admin/models/nope/thumbnail").status_code == 403


def test_last_seen_is_written_once_a_day(make_client):
    with make_client() as client:
        sign_up(client)
        db: sqlite3.Connection = client.app.state.db
        db.execute("UPDATE accounts SET last_seen = '2020-01-01'")
        db.commit()
        client.get("/api/account")
        assert db.execute("SELECT last_seen FROM accounts").fetchone()[0] != "2020-01-01"
