from conftest import sign_up

PRINTER = {"name": "My A1", "data": {"printer": "bambu-a1", "holeOffset": 0.3, "fits": {"sliding": 0.2}}}


def test_printers_need_a_session(make_client):
    with make_client() as client:
        assert client.get("/api/printers").status_code == 401
        assert client.put("/api/printers/p1", json=PRINTER).status_code == 401
        assert client.delete("/api/printers/p1").status_code == 401


def test_writes_need_the_csrf_token(user):
    del user.headers["X-CSRF-Token"]
    assert user.put("/api/printers/p1", json=PRINTER).status_code == 403


def test_save_list_update_and_delete(user):
    assert user.get("/api/printers").json() == {"printers": []}
    r = user.put("/api/printers/p1", json=PRINTER)
    assert r.status_code == 200, r.text
    saved = r.json()
    assert saved["id"] == "p1" and saved["name"] == "My A1" and saved["fits"] == {"sliding": 0.2}
    user.put("/api/printers/p1", json={**PRINTER, "name": "Bambu A1", "data": {**PRINTER["data"], "holeOffset": 0.4}})
    listed = user.get("/api/printers").json()["printers"]
    assert [(p["id"], p["name"], p["holeOffset"]) for p in listed] == [("p1", "Bambu A1", 0.4)]
    assert user.delete("/api/printers/p1").json() == {"ok": True}
    assert user.get("/api/printers").json() == {"printers": []}
    assert user.delete("/api/printers/p1").status_code == 404


def test_people_only_see_their_own_printers(make_client):
    with make_client() as a, make_client() as b:
        sign_up(a, "a@example.com", "A")
        sign_up(b, "b@example.com", "B")
        a.put("/api/printers/p1", json=PRINTER)
        assert b.get("/api/printers").json() == {"printers": []}
        assert b.delete("/api/printers/p1").status_code == 404
        # The same id is a different profile for someone else.
        b.put("/api/printers/p1", json={**PRINTER, "name": "B's printer"})
        assert a.get("/api/printers").json()["printers"][0]["name"] == "My A1"


def test_refuses_bad_ids_and_big_profiles(user):
    assert user.put("/api/printers/bad id!", json=PRINTER).status_code == 404
    huge = {"name": "Big", "data": {"notes": "x" * 5000}}
    assert user.put("/api/printers/p2", json=huge).status_code == 413
    assert user.put("/api/printers/p3", json={"name": "", "data": {}}).status_code == 422
