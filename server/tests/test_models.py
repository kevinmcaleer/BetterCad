import json

from conftest import BCAD, sign_up


def bcad(name: str = "Box", n: int = 0) -> str:
    data = json.loads(BCAD)
    data["name"] = name
    data["document"]["features"] = [{"id": f"f{i}"} for i in range(n)]
    return json.dumps(data)


def create(client, name="Box", **extra) -> dict:
    r = client.post("/api/models", json={"name": name, "bcad": bcad(name), **extra})
    assert r.status_code == 201, r.text
    return r.json()


def test_everything_needs_a_session(make_client):
    with make_client() as client:
        for method, path in [
            ("get", "/api/models"),
            ("post", "/api/models"),
            ("get", "/api/models/x"),
            ("put", "/api/models/x"),
            ("patch", "/api/models/x"),
            ("delete", "/api/models/x"),
            ("get", "/api/models/x/versions"),
            ("put", "/api/blobs/abcdefgh"),
            ("get", "/api/blobs/abcdefgh"),
            ("get", "/api/me/usage"),
        ]:
            assert getattr(client, method)(path).status_code == 401, (method, path)


def test_writes_need_the_csrf_token(user):
    del user.headers["X-CSRF-Token"]
    r = user.post("/api/models", json={"name": "Box", "bcad": bcad()})
    assert r.status_code == 403 and "Reload" in r.json()["detail"]


def test_create_get_and_list(user):
    m = create(user)
    assert m["version"] == 1 and m["thumbnail"].startswith(f"/api/models/{m['id']}/thumbnail?v=1.")
    got = user.get(f"/api/models/{m['id']}").json()
    assert json.loads(got["bcad"])["name"] == "Box"
    create(user, "Alpha")
    listed = user.get("/api/models").json()
    assert listed["total"] == 2 and [x["name"] for x in listed["models"]] == ["Alpha", "Box"]
    assert [x["name"] for x in user.get("/api/models?sort=name").json()["models"]] == ["Alpha", "Box"]
    assert [x["name"] for x in user.get("/api/models?q=alp").json()["models"]] == ["Alpha"]
    assert user.get("/api/models?q=%25").json()["total"] == 0
    page = user.get("/api/models?limit=1&offset=1").json()
    assert page["total"] == 2 and len(page["models"]) == 1
    thumb = user.get(m["thumbnail"])
    assert thumb.headers["content-type"] == "image/png" and thumb.content.startswith(b"\x89PNG")


def test_a_rendered_thumbnail_replaces_the_saved_one(user):
    m = create(user)
    url = f"/api/models/{m['id']}"
    assert user.put(url, json={"bcad": bcad(n=1)}).json() == {"version": 2}
    before = user.get(url).json()["thumbnail"]
    jpeg = "data:image/jpeg;base64,/9j/4AAQ"
    after = user.put(f"{url}/versions/2/thumbnail", json={"thumbnail": jpeg}).json()["thumbnail"]
    # A new address, so a cached picture isn't shown again.
    assert after != before and after.startswith(f"{url}/thumbnail?v=2.")
    got = user.get(after)
    assert got.headers["content-type"] == "image/jpeg" and got.content.startswith(b"\xff\xd8")
    assert user.get(f"{url}/versions/2/thumbnail").headers["content-type"] == "image/jpeg"
    # An older version's picture changes only that version.
    user.put(f"{url}/versions/1/thumbnail", json={"thumbnail": "data:image/webp;base64,UklGRg=="})
    assert user.get(url).json()["thumbnail"] == after
    assert user.get(f"{url}/versions/1/thumbnail").headers["content-type"] == "image/webp"
    assert user.put(f"{url}/versions/2/thumbnail", json={"thumbnail": "javascript:alert(1)"}).status_code == 422
    big = "data:image/jpeg;base64," + "A" * 300_000
    assert user.put(f"{url}/versions/2/thumbnail", json={"thumbnail": big}).status_code == 422
    assert user.put(f"{url}/versions/9/thumbnail", json={"thumbnail": jpeg}).status_code == 404
    assert user.put("/api/models/nope/versions/1/thumbnail", json={"thumbnail": jpeg}).status_code == 404


def test_refuses_text_that_is_not_a_model(user):
    assert user.post("/api/models", json={"name": "x", "bcad": "not json"}).status_code == 422
    assert user.post("/api/models", json={"name": "x", "bcad": "[1, 2]"}).status_code == 422


def test_save_makes_versions_and_detects_other_tabs(user):
    m = create(user)
    url = f"/api/models/{m['id']}"
    r = user.put(url, json={"bcad": bcad(n=1), "note": "Added a hole"}, headers={"If-Match": "1"})
    assert r.json() == {"version": 2}
    r = user.put(url, json={"bcad": bcad(n=2)}, headers={"If-Match": "1"})
    assert r.status_code == 409 and r.json()["detail"]["version"] == 2
    # Save anyway: no If-Match.
    assert user.put(url, json={"bcad": bcad(n=3), "name": "Bracket"}).json() == {"version": 3}
    assert user.get(url).json()["name"] == "Bracket"
    versions = user.get(f"{url}/versions").json()["versions"]
    assert [v["number"] for v in versions] == [3, 2, 1]
    assert versions[1]["note"] == "Added a hole"
    v2 = user.get(f"{url}/versions/2").json()
    assert len(json.loads(v2["bcad"])["document"]["features"]) == 1
    assert user.get(f"{url}/versions/9").status_code == 404
    assert user.get(f"{url}/versions/2/thumbnail").status_code == 200
    assert user.patch(f"{url}/versions/3", json={"note": "Final"}).json()["note"] == "Final"


def test_restore_a_version_copies_it_forward(user):
    m = create(user)
    url = f"/api/models/{m['id']}"
    user.put(url, json={"bcad": bcad(n=5)})
    assert user.post(f"{url}/versions/1/restore").json() == {"version": 3}
    latest = user.get(url).json()
    assert latest["note"] == "Restored version 1"
    assert json.loads(latest["bcad"])["document"]["features"] == []


def test_rename_duplicate_delete_and_bin(user):
    m = create(user)
    url = f"/api/models/{m['id']}"
    assert user.patch(url, json={"name": "Bracket"}).json()["name"] == "Bracket"
    copy = user.post(f"{url}/duplicate").json()
    assert copy["name"] == "Bracket copy" and copy["version"] == 1
    assert user.delete(url).status_code == 200
    assert user.get(url).status_code == 404
    binned = user.get("/api/models?bin=true").json()["models"]
    assert [x["id"] for x in binned] == [m["id"]]
    assert user.post(f"{url}/restore").json()["deleted_at"] is None
    assert user.post(f"{url}/restore").status_code == 404
    assert user.delete(f"{url}?forever=true").status_code == 200
    assert user.get("/api/models?bin=true").json()["total"] == 0
    assert user.get("/api/models").json()["total"] == 1


def test_other_users_get_404(make_client):
    with make_client() as a:
        sign_up(a)
        m = create(a)
        a.put("/api/blobs/abcdef123456", content=b"solid")
    with make_client() as b:
        sign_up(b, "other@example.com", "Other")
        url = f"/api/models/{m['id']}"
        for r in [
            b.get(url),
            b.put(url, json={"bcad": bcad()}),
            b.patch(url, json={"name": "Mine"}),
            b.delete(url),
            b.post(f"{url}/duplicate"),
            b.get(f"{url}/versions"),
            b.get(f"{url}/versions/1"),
            b.get(f"{url}/thumbnail"),
            b.post(f"{url}/share"),
            b.get("/api/blobs/abcdef123456"),
        ]:
            assert r.status_code == 404, r.request.url
        assert b.get("/api/models").json()["total"] == 0


def test_upload_limit_and_quota(make_client):
    with make_client(max_upload_mb=1, user_quota_mb=2) as client:
        sign_up(client)
        big = bcad() + " " * (1024 * 1024)
        r = client.post("/api/models", json={"name": "Big", "bcad": big})
        assert r.status_code == 413 and "1 MB limit" in r.json()["detail"]
        assert client.put("/api/blobs/abcdef123456", content=b"x" * (1024 * 1024 + 1)).status_code == 413
        half = bcad() + " " * (700 * 1024)
        for _ in range(2):
            assert client.post("/api/models", json={"name": "Half", "bcad": half}).status_code == 201
        r = client.post("/api/models", json={"name": "Over", "bcad": half})
        assert r.status_code == 413 and "used your 2 MB" in r.json()["detail"]
        usage = client.get("/api/me/usage").json()
        assert usage["models"] == 2 and usage["quota"] == 2 * 1024 * 1024 and usage["bytes"] > 1400 * 1024


def test_writes_are_rate_limited(user):
    m = create(user)
    codes = [user.patch(f"/api/models/{m['id']}/versions/1", json={"note": "x"}).status_code for _ in range(3)]
    assert codes == [200, 200, 200]
    for _ in range(60):
        r = user.put(f"/api/models/{m['id']}", json={"bcad": bcad()})
    assert r.status_code == 429 and "Wait a minute" in r.json()["detail"]


def test_blobs_by_hash(user):
    r = user.put("/api/blobs/b0123456789abcdef", content=b"solid cube", headers={"Content-Type": "model/stl"})
    assert r.json() == {"hash": "b0123456789abcdef", "stored": True}
    assert user.put("/api/blobs/b0123456789abcdef", content=b"solid cube").json()["stored"] is False
    got = user.get("/api/blobs/b0123456789abcdef")
    assert got.content == b"solid cube" and got.headers["content-type"] == "model/stl"
    head = user.head("/api/blobs/b0123456789abcdef")
    assert head.status_code == 200 and head.headers["content-length"] == "10"
    assert user.get("/api/blobs/missing00").status_code == 404
    assert user.get("/api/blobs/..%2F..%2Fetc").status_code == 404
    assert user.put("/api/blobs/bad!hash", content=b"x").status_code == 404
    assert user.get("/api/me/usage").json()["bytes"] == 10


def test_share_links(user, make_client):
    m = create(user)
    url = f"/api/models/{m['id']}"
    token = user.post(f"{url}/share").json()["token"]
    assert len(token) == 22
    assert user.post(f"{url}/share").json()["token"] == token
    with make_client() as anon:
        shared = anon.get(f"/api/shared/{token}")
        assert shared.status_code == 200 and shared.headers["cache-control"] == "private, no-store"
        assert shared.json()["owner"] == "Kev" and json.loads(shared.json()["bcad"])["name"] == "Box"
        assert anon.get(f"/api/shared/{token}/thumbnail").status_code == 200
        user.put("/api/blobs/abcdef123456", content=b"solid", headers={"Content-Type": "model/stl"})
        assert anon.get(f"/api/shared/{token}/blobs/abcdef123456").content == b"solid"
        assert anon.get(f"/api/shared/{token}/blobs/nothere00").status_code == 404
        user.delete(f"{url}/share")
        r = anon.get(f"/api/shared/{token}")
        assert r.status_code == 404 and r.json()["detail"] == "This link isn't active any more."


def test_thumbnail_missing(user):
    data = json.loads(BCAD)
    del data["thumbnail"]
    m = user.post("/api/models", json={"name": "Plain", "bcad": json.dumps(data)}).json()
    assert m["thumbnail"] is None
    assert user.get(f"/api/models/{m['id']}/thumbnail").status_code == 404


def test_docs_only_in_development(make_client):
    with make_client() as client:
        assert client.get("/api/openapi.json").status_code == 200
    with make_client(env="production", secret_key="x") as client:
        assert client.get("/api/openapi.json").status_code == 404


def test_view_page_previews_and_redirects(user, make_client):
    m = create(user)
    token = user.post(f"/api/models/{m['id']}/share").json()["token"]
    with make_client() as anon:
        page = anon.get(f"/view/{token}")
        assert page.status_code == 200
        assert 'og:title" content="Box by Kev · BetterCad"' in page.text
        assert f"/api/shared/{token}/thumbnail" in page.text
        assert f"url=/#/view/{token}" in page.text
        assert "frame-ancestors" in page.headers["content-security-policy"]
        odd = anon.get("/view/%3Cscript%3E%22x")
        assert odd.status_code == 200 and '<script>"x' not in odd.text and "BetterCad" in odd.text
