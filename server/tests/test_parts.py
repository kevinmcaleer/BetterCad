from conftest import sign_up

PACK = {
    "pack": 1,
    "name": "Your parts",
    "licence": "Each part keeps its own licence.",
    "credits": [{"name": "You", "licence": "CC0 1.0", "url": ""}],
    "symbols": {"S": {"name": "S", "units": 1, "shapes": [], "pins": []}},
    "footprints": {},
    "parts": [{"id": "mine", "name": "Mine", "category": "Your parts", "prefix": "U", "symbol": "S", "packages": [], "from": 0}],
}


def test_the_library_needs_a_session(make_client):
    with make_client() as client:
        assert client.get("/api/parts-library").status_code == 401
        assert client.put("/api/parts-library", json={"pack": PACK}).status_code == 401


def test_writes_need_the_csrf_token(user):
    del user.headers["X-CSRF-Token"]
    assert user.put("/api/parts-library", json={"pack": PACK}).status_code == 403


def test_save_and_read_back(user):
    assert user.get("/api/parts-library").json() == {"pack": None, "removed": [], "modified": None}
    r = user.put("/api/parts-library", json={"pack": PACK, "removed": ["old"]})
    assert r.status_code == 200, r.text
    got = user.get("/api/parts-library").json()
    assert got["pack"] == PACK and got["removed"] == ["old"] and got["modified"] == r.json()["modified"]
    user.put("/api/parts-library", json={"pack": {**PACK, "parts": []}})
    assert user.get("/api/parts-library").json()["pack"]["parts"] == []


def test_people_only_see_their_own_library(make_client):
    with make_client() as a, make_client() as b:
        sign_up(a, "a@example.com", "alice")
        sign_up(b, "b@example.com", "bob")
        a.put("/api/parts-library", json={"pack": PACK})
        assert b.get("/api/parts-library").json()["pack"] is None


def test_only_a_library_is_kept(user):
    assert user.put("/api/parts-library", json={"pack": {"pack": 2, "parts": []}}).status_code == 422
    assert user.put("/api/parts-library", json={"pack": {"pack": 1}}).status_code == 422
    big = {**PACK, "symbols": {"S": {"name": "S" * 4_100_000}}}
    assert user.put("/api/parts-library", json={"pack": big}).status_code == 413
