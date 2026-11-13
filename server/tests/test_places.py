"""Folders and projects (#273, #274)."""

from conftest import sign_up
from test_models import create

PNG = "data:image/png;base64,iVBORw0KGgo="


def folder(client, name="Parts", **where) -> dict:
    r = client.post("/api/folders", json={"name": name, **where})
    assert r.status_code == 201, r.text
    return r.json()


def project(client, name="Rover", readme="") -> dict:
    r = client.post("/api/projects", json={"name": name, "readme": readme})
    assert r.status_code == 201, r.text
    return r.json()


def names(client, query="") -> list[str]:
    return sorted(m["name"] for m in client.get(f"/api/models{query}").json()["models"])


def places(client, bin=False) -> dict:
    return client.get(f"/api/places{'?bin=true' if bin else ''}").json()


def test_places_need_a_session(make_client):
    with make_client() as client:
        for method, path in [
            ("get", "/api/places"),
            ("post", "/api/folders"),
            ("patch", "/api/folders/x"),
            ("post", "/api/folders/x/move"),
            ("delete", "/api/folders/x"),
            ("post", "/api/projects"),
            ("get", "/api/projects/x"),
            ("patch", "/api/projects/x"),
            ("get", "/api/projects/x/cover"),
            ("post", "/api/models/x/move"),
        ]:
            assert getattr(client, method)(path).status_code == 401, (method, path)


def test_existing_models_stay_at_the_top_and_new_ones_land_where_asked(user):
    loose = create(user, "Loose")
    assert loose["folder_id"] is None and loose["project_id"] is None
    parts = folder(user)
    rover = project(user)
    inner = create(user, "Wheel", folder_id=parts["id"])
    in_project = create(user, "Chassis", project_id=rover["id"])
    assert inner["folder_id"] == parts["id"] and inner["project_id"] is None
    assert in_project["project_id"] == rover["id"] and in_project["folder_id"] is None
    # Every model, then each place on its own.
    assert names(user) == ["Chassis", "Loose", "Wheel"]
    assert names(user, "?top=true") == ["Loose"]
    assert names(user, f"?folder={parts['id']}") == ["Wheel"]
    assert names(user, f"?project={rover['id']}") == ["Chassis"]
    tree = places(user)
    assert [(f["name"], f["models"]) for f in tree["folders"]] == [("Parts", 1)]
    assert [(p["name"], p["models"]) for p in tree["projects"]] == [("Rover", 1)]
    assert user.post("/api/models", json={"name": "X", "bcad": "{}", "folder_id": "nope"}).status_code in (404, 422)


def test_folders_nest_inside_projects_and_carry_their_project(user):
    rover = project(user)
    arm = folder(user, "Arm", project_id=rover["id"])
    gripper = folder(user, "Gripper", parent_id=arm["id"])
    assert gripper["project_id"] == rover["id"] and gripper["parent_id"] == arm["id"]
    claw = create(user, "Claw", folder_id=gripper["id"])
    assert claw["project_id"] == rover["id"]
    # The project counts every model in it, at any depth.
    assert user.get(f"/api/projects/{rover['id']}").json()["models"] == 1
    tree = {f["name"]: f for f in places(user)["folders"]}
    assert tree["Arm"]["folders"] == 1 and tree["Gripper"]["models"] == 1


def test_rename_and_move_a_folder(user):
    rover = project(user)
    a = folder(user, "A")
    b = folder(user, "B", parent_id=a["id"])
    m = create(user, "Bolt", folder_id=b["id"])
    assert user.patch(f"/api/folders/{a['id']}", json={"name": " Arm "}).json()["name"] == "Arm"
    # A folder can't go inside itself or one of its own folders.
    assert user.post(f"/api/folders/{a['id']}/move", json={"folder_id": b["id"]}).status_code == 422
    assert user.post(f"/api/folders/{a['id']}/move", json={"folder_id": a["id"]}).status_code == 422
    # Into a project: everything inside follows.
    moved = user.post(f"/api/folders/{a['id']}/move", json={"project_id": rover["id"]}).json()
    assert moved["project_id"] == rover["id"] and moved["parent_id"] is None
    assert user.get(f"/api/models/{m['id']}").json()["project_id"] == rover["id"]
    assert {f["name"]: f["project_id"] for f in places(user)["folders"]} == {"Arm": rover["id"], "B": rover["id"]}
    # Back out to My models.
    user.post(f"/api/folders/{b['id']}/move", json={})
    assert user.get(f"/api/models/{m['id']}").json()["project_id"] is None
    assert {f["name"]: f["parent_id"] for f in places(user)["folders"]} == {"Arm": None, "B": None}


def test_move_a_model(user):
    rover = project(user)
    parts = folder(user, "Parts", project_id=rover["id"])
    m = create(user, "Wheel")
    url = f"/api/models/{m['id']}/move"
    got = user.post(url, json={"folder_id": parts["id"]}).json()
    assert got["folder_id"] == parts["id"] and got["project_id"] == rover["id"]
    got = user.post(url, json={"project_id": rover["id"]}).json()
    assert got["folder_id"] is None and got["project_id"] == rover["id"]
    got = user.post(url, json={}).json()
    assert got["folder_id"] is None and got["project_id"] is None
    assert user.post(url, json={"folder_id": "missing"}).status_code == 404
    # A duplicate sits beside its original.
    user.post(url, json={"folder_id": parts["id"]})
    copy = user.post(f"/api/models/{m['id']}/duplicate").json()
    assert copy["folder_id"] == parts["id"]


def test_bin_a_folder_with_everything_in_it_then_restore_it(user):
    a = folder(user, "A")
    b = folder(user, "B", parent_id=a["id"])
    create(user, "In A", folder_id=a["id"])
    create(user, "In B", folder_id=b["id"])
    already = create(user, "Binned first", folder_id=b["id"])
    user.delete(f"/api/models/{already['id']}")
    create(user, "Outside")
    assert user.delete(f"/api/folders/{a['id']}").json() == {"ok": True}
    assert names(user) == ["Outside"]
    assert places(user)["folders"] == []
    # The bin shows the folder and the model binned on its own, not what went with the folder.
    assert [f["name"] for f in places(user, bin=True)["folders"]] == ["A"]
    assert names(user, "?bin=true") == ["Binned first"]
    assert user.get("/api/me/usage").json()["models"] == 1
    user.post(f"/api/folders/{a['id']}/restore")
    assert names(user) == ["In A", "In B", "Outside"]
    assert names(user, "?bin=true") == ["Binned first"]


def test_restoring_something_whose_folder_has_gone_brings_it_up_a_level(user):
    rover = project(user)
    a = folder(user, "A", project_id=rover["id"])
    b = folder(user, "B", parent_id=a["id"])
    m = create(user, "Wheel", folder_id=b["id"])
    user.delete(f"/api/models/{m['id']}")
    user.delete(f"/api/folders/{b['id']}")
    user.delete(f"/api/folders/{a['id']}")
    got = user.post(f"/api/models/{m['id']}/restore").json()
    assert got["folder_id"] is None and got["project_id"] == rover["id"]
    back = user.post(f"/api/folders/{b['id']}/restore").json()
    assert back["parent_id"] is None and back["project_id"] == rover["id"]
    user.delete(f"/api/projects/{rover['id']}")
    user.post(f"/api/folders/{a['id']}/restore")
    assert {f["name"]: (f["parent_id"], f["project_id"]) for f in places(user)["folders"]} == {"A": (None, None)}


def test_delete_a_folder_for_ever(user):
    a = folder(user, "A")
    b = folder(user, "B", parent_id=a["id"])
    m = create(user, "In B", folder_id=b["id"])
    user.delete(f"/api/folders/{a['id']}")
    user.delete(f"/api/folders/{a['id']}?forever=true")
    assert places(user, bin=True)["folders"] == []
    assert user.get(f"/api/models/{m['id']}").status_code == 404
    assert names(user, "?bin=true") == []


def test_projects_have_a_readme_and_a_cover(user):
    p = project(user, "Rover", "# Rover\n\nSix wheels.")
    assert p["readme"].startswith("# Rover") and p["cover"] is None
    url = f"/api/projects/{p['id']}"
    got = user.patch(url, json={"name": "Mars rover", "cover": PNG}).json()
    assert got["name"] == "Mars rover" and got["readme"].startswith("# Rover")
    pic = user.get(got["cover"])
    assert pic.headers["content-type"] == "image/png"
    assert user.patch(url, json={"cover": "javascript:alert(1)"}).status_code == 422
    assert user.patch(url, json={"cover": ""}).json()["cover"] is None
    assert user.get(f"{url}/cover").status_code == 404
    assert user.patch(url, json={"readme": "x" * 20_001}).status_code == 422


def test_bin_restore_and_forget_a_project(user):
    p = project(user)
    f = folder(user, "Arm", project_id=p["id"])
    create(user, "Claw", folder_id=f["id"])
    create(user, "Chassis", project_id=p["id"])
    user.delete(f"/api/projects/{p['id']}")
    assert names(user) == [] and places(user) == {"folders": [], "projects": []}
    binned = places(user, bin=True)
    assert [x["name"] for x in binned["projects"]] == ["Rover"] and binned["folders"] == []
    assert user.get(f"/api/projects/{p['id']}").status_code == 404
    assert user.post(f"/api/projects/{p['id']}/restore").json()["models"] == 2
    assert names(user) == ["Chassis", "Claw"]
    user.delete(f"/api/projects/{p['id']}")
    user.delete(f"/api/projects/{p['id']}?forever=true")
    assert places(user, bin=True)["projects"] == [] and names(user, "?bin=true") == []


def test_another_persons_folders_and_projects_are_not_there(make_client):
    with make_client() as a, make_client() as b:
        sign_up(a, "a@example.com", "Ann")
        sign_up(b, "b@example.com", "Bob")
        f = folder(a)
        p = project(a)
        m = create(b, "Bobs")
        assert b.post(f"/api/models/{m['id']}/move", json={"folder_id": f["id"]}).status_code == 404
        assert b.post(f"/api/models/{m['id']}/move", json={"project_id": p["id"]}).status_code == 404
        assert b.patch(f"/api/folders/{f['id']}", json={"name": "Mine"}).status_code == 404
        assert b.delete(f"/api/folders/{f['id']}").status_code == 404
        assert b.get(f"/api/projects/{p['id']}").status_code == 404
        assert b.delete(f"/api/projects/{p['id']}").status_code == 404
        assert b.post("/api/folders", json={"name": "X", "parent_id": f["id"]}).status_code == 404
        assert places(b) == {"folders": [], "projects": []}


def test_the_bin_empties_folders_and_projects_after_30_days(user):
    from bettercad import jobs

    p = project(user)
    f = folder(user, "A")
    user.delete(f"/api/projects/{p['id']}")
    user.delete(f"/api/folders/{f['id']}")
    db = user.app.state.db
    with db:
        db.execute("UPDATE folders SET deleted_at = datetime('now', '-31 days')")
        db.execute("UPDATE projects SET deleted_at = datetime('now', '-31 days')")
    jobs.empty_bin(db)
    assert places(user, bin=True) == {"folders": [], "projects": []}
