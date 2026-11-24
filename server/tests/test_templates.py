from conftest import sign_up

TEMPLATE = {"name": "Workshop A3", "data": {"size": "A3", "standard": "iso", "views": "four", "title": {"approved": "Kev"}}}


def test_templates_need_a_session(make_client):
    with make_client() as client:
        assert client.get("/api/templates").status_code == 401
        assert client.put("/api/templates/t1", json=TEMPLATE).status_code == 401
        assert client.delete("/api/templates/t1").status_code == 401


def test_writes_need_the_csrf_token(user):
    del user.headers["X-CSRF-Token"]
    assert user.put("/api/templates/t1", json=TEMPLATE).status_code == 403


def test_save_list_update_and_delete(user):
    assert user.get("/api/templates").json() == {"templates": []}
    r = user.put("/api/templates/t1", json=TEMPLATE)
    assert r.status_code == 200, r.text
    saved = r.json()
    assert saved["id"] == "t1" and saved["name"] == "Workshop A3" and saved["title"] == {"approved": "Kev"}
    user.put("/api/templates/t1", json={**TEMPLATE, "name": "Workshop A4", "data": {**TEMPLATE["data"], "size": "A4"}})
    listed = user.get("/api/templates").json()["templates"]
    assert [(t["id"], t["name"], t["size"]) for t in listed] == [("t1", "Workshop A4", "A4")]
    assert user.delete("/api/templates/t1").json() == {"ok": True}
    assert user.get("/api/templates").json() == {"templates": []}
    assert user.delete("/api/templates/t1").status_code == 404


def test_people_only_see_their_own_templates(make_client):
    with make_client() as a, make_client() as b:
        sign_up(a, "a@example.com", "alice")
        sign_up(b, "b@example.com", "bob")
        a.put("/api/templates/t1", json=TEMPLATE)
        assert b.get("/api/templates").json() == {"templates": []}
        assert b.delete("/api/templates/t1").status_code == 404
        # The same id is a different template for someone else.
        b.put("/api/templates/t1", json={**TEMPLATE, "name": "B's template"})
        assert a.get("/api/templates").json()["templates"][0]["name"] == "Workshop A3"


def test_a_template_holds_a_logo(user):
    logo = {"data": "data:image/jpeg;base64," + "A" * 60_000, "w": 480, "h": 160}
    r = user.put("/api/templates/t1", json={**TEMPLATE, "data": {**TEMPLATE["data"], "logo": logo}})
    assert r.status_code == 200, r.text
    assert user.get("/api/templates").json()["templates"][0]["logo"]["w"] == 480


def test_keeps_up_to_twenty(user):
    for i in range(20):
        assert user.put(f"/api/templates/t{i}", json=TEMPLATE).status_code == 200
    r = user.put("/api/templates/one-more", json=TEMPLATE)
    assert r.status_code == 409 and "20 templates" in r.json()["detail"]
    # One that is already there can still be changed.
    assert user.put("/api/templates/t3", json={**TEMPLATE, "name": "Changed"}).status_code == 200


def test_refuses_bad_ids_and_big_templates(user):
    assert user.put("/api/templates/bad id!", json=TEMPLATE).status_code == 404
    huge = {"name": "Big", "data": {"notes": "x" * 200_001}}
    assert user.put("/api/templates/t2", json=huge).status_code == 413
    assert user.put("/api/templates/t3", json={"name": "", "data": {}}).status_code == 422
