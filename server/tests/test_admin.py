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


def test_admins_see_projects_with_sizes_and_pictures(make_client):
    from test_places import PNG, folder, project

    with make_client(admin_emails="kev@example.com") as client:
        sign_up(client, email="ada@example.com", name="ada")
        rover = project(client, "Rover")
        parts = folder(client, "Parts", project_id=rover["id"])
        client.post("/api/models", json={"name": "Wheel", "bcad": BCAD, "folder_id": parts["id"]})
        client.post("/api/models", json={"name": "Chassis", "bcad": BCAD, "project_id": rover["id"]})
        save(client, "Loose bolt")
        bare = project(client, "Empty")
        client.patch(f"/api/projects/{bare['id']}", json={"cover": PNG})

        client.cookies.clear()
        sign_up(client)
        ada = next(u for u in client.get("/api/admin/users").json()["users"] if u["username"] == "ada")
        assert ada["email"] == "ada@example.com"
        by_name = {p["name"]: p for p in ada["projects"]}
        assert by_name["Rover"]["models"] == 2
        assert by_name["Rover"]["size"] == sum(m["size"] for m in ada["models"] if m["project_id"] == rover["id"]) > 0
        # No cover: the newest model picture inside stands in.
        assert by_name["Rover"]["thumbnail"].startswith("/api/admin/models/")
        assert by_name["Empty"]["models"] == 0 and by_name["Empty"]["size"] == 0
        cover = client.get(by_name["Empty"]["thumbnail"])
        assert cover.status_code == 200 and cover.headers["content-type"] == "image/png"
        assert next(m for m in ada["models"] if m["name"] == "Loose bolt")["project_id"] is None


def test_sign_ins_are_recorded_as_visits(make_client):
    with make_client(admin_emails="kev@example.com") as client:
        sign_up(client)
        db: sqlite3.Connection = client.app.state.db
        client.get("/api/account")
        assert db.execute("SELECT COUNT(*) FROM visits").fetchone()[0] == 1
        # 10 minutes later the visit runs on; an hour later a new one starts.
        db.execute("UPDATE accounts SET last_active = datetime('now', '-10 minutes')")
        db.commit()
        client.get("/api/account")
        assert db.execute("SELECT COUNT(*) FROM visits").fetchone()[0] == 1
        db.execute("UPDATE accounts SET last_active = datetime('now', '-1 hour')")
        db.execute("UPDATE visits SET started = datetime('now', '-2 hours')")
        db.commit()
        client.get("/api/account")
        kev = client.get("/api/admin/users").json()["users"][0]
        assert len(kev["visits"]) == 2 and kev["visits_month"] == 2
        assert kev["visits"][0]["started"] > kev["visits"][1]["started"]
        assert kev["last_active"]


def test_admin_users_by_username(make_client):
    with make_client(admin_users="kev") as client:
        assert sign_up(client)["admin"] is True
        assert client.get("/api/admin/users").status_code == 200
    with make_client(admin_users="kev") as client:
        assert sign_up(client, email="ada@example.com", name="ada")["admin"] is False
