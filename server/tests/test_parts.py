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


# --- A link to a library (#629) -------------------------------------------------------------------------------


def test_share_a_library_by_link_and_take_the_link_back(make_client):
    with make_client() as a, make_client() as b:
        sign_up(a, "a@example.com", "alice")
        a.put("/api/parts-library", json={"pack": PACK})
        assert a.get("/api/parts-library/share").json() == {"token": None}
        token = a.post("/api/parts-library/share").json()["token"]
        # Asking again gives the same link.
        assert a.post("/api/parts-library/share").json()["token"] == token
        assert a.get("/api/parts-library/share").json() == {"token": token}
        # Anyone with the link reads it, signed in or not, and sees whose it is.
        got = b.get(f"/api/parts-library/shared/{token}")
        assert got.status_code == 200 and got.json() == {"pack": PACK, "by": "alice"}
        assert got.headers["cache-control"] == "private, no-store"
        assert b.get("/api/parts-library/shared/nope").status_code == 404
        a.delete("/api/parts-library/share")
        assert b.get(f"/api/parts-library/shared/{token}").status_code == 404


def test_a_link_to_an_empty_library_reads_as_nothing(user):
    token = user.post("/api/parts-library/share").json()["token"]
    assert user.get(f"/api/parts-library/shared/{token}").json()["pack"] is None


def test_sharing_needs_a_session_and_the_csrf_token(make_client, user):
    with make_client() as anon:
        assert anon.post("/api/parts-library/share").status_code == 401
    del user.headers["X-CSRF-Token"]
    assert user.post("/api/parts-library/share").status_code == 403


# --- The catalogue (#625, #629) -------------------------------------------------------------------------------


def one(name: str = "Level shifter", **part) -> dict:
    """A pack holding one part, as the editor publishes it."""
    return {
        **PACK,
        "parts": [
            {
                **PACK["parts"][0],
                "id": "p",
                "name": name,
                "keywords": ["i2c"],
                "supplier": {"mpn": "TXS0102"},
                "packages": [{"footprint": "SOIC-8"}],
                **part,
            }
        ],
    }


def publish(client, part_id: str = "shifter", licence: str = "CC-BY 4.0", **kw):
    return client.post("/api/parts-catalogue", json={"id": part_id, "pack": one(**kw), "licence": licence})


def test_a_published_part_is_live_and_unreviewed_until_an_admin_approves_it(make_client):
    with (
        make_client(admin_emails="kev@example.com") as ada,
        make_client(admin_emails="kev@example.com") as kev,
        make_client() as anon,
    ):
        sign_up(ada, "ada@example.com", "ada")
        r = publish(ada)
        assert r.status_code == 200, r.text
        entry = r.json()
        assert entry["status"] == "unreviewed"
        # Anyone can find it, signed in or not, by any of its words, and sees it is unreviewed and whose it is.
        found = anon.get("/api/parts-catalogue", params={"q": "txs0102 soic"}).json()
        assert [(p["name"], p["status"], p["by"], p["licence"], p["credit"]) for p in found["parts"]] == [
            ("Level shifter", "unreviewed", "ada", "CC-BY 4.0", "ada")
        ]
        assert found["parts"][0]["pack"]["parts"][0]["name"] == "Level shifter"
        assert "CC0 1.0 (no rights kept)" in found["licences"]
        assert anon.get("/api/parts-catalogue", params={"q": "relay"}).json()["parts"] == []

        # Only an admin reviews.
        assert ada.get("/api/admin/parts-catalogue").status_code == 403
        assert ada.post(f"/api/admin/parts-catalogue/{entry['id']}", json={"status": "approved"}).status_code == 403
        sign_up(kev)
        assert [p["status"] for p in kev.get("/api/admin/parts-catalogue").json()["parts"]] == ["unreviewed"]
        assert kev.post(f"/api/admin/parts-catalogue/{entry['id']}", json={"status": "maybe"}).status_code == 422
        assert kev.post("/api/admin/parts-catalogue/999", json={"status": "approved"}).status_code == 404
        assert kev.post(f"/api/admin/parts-catalogue/{entry['id']}", json={"status": "approved"}).json() == {
            "id": entry["id"],
            "status": "approved",
        }
        assert anon.get("/api/parts-catalogue").json()["parts"][0]["status"] == "approved"

        # Publishing it again after a change puts it back to unreviewed, as one entry.
        assert publish(ada, name="Level shifter, 2 channel").json() == {"id": entry["id"], "status": "unreviewed"}
        assert [p["name"] for p in anon.get("/api/parts-catalogue").json()["parts"]] == ["Level shifter, 2 channel"]

        # A rejected part is not found, but its owner still sees what happened to it.
        kev.post(f"/api/admin/parts-catalogue/{entry['id']}", json={"status": "rejected"})
        assert anon.get("/api/parts-catalogue").json()["parts"] == []
        mine = ada.get("/api/parts-catalogue/mine").json()["parts"]
        assert [(p["part"], p["status"]) for p in mine] == [("shifter", "rejected")] and "pack" not in mine[0]


def test_approved_parts_come_first_and_a_search_matches_every_word(make_client):
    with make_client(admin_emails="kev@example.com") as kev:
        sign_up(kev)
        publish(kev, "a", name="Zener 5V1")
        b = publish(kev, "b", name="Buck module 5 V").json()
        publish(kev, "c", name="100%_odd")
        kev.post(f"/api/admin/parts-catalogue/{b['id']}", json={"status": "approved"})
        assert [p["name"] for p in kev.get("/api/parts-catalogue").json()["parts"]] == [
            "Buck module 5 V",
            "100%_odd",
            "Zener 5V1",
        ]
        assert [p["name"] for p in kev.get("/api/parts-catalogue", params={"q": "5 module"}).json()["parts"]] == [
            "Buck module 5 V"
        ]
        # % and _ are letters here, not wildcards.
        assert [p["name"] for p in kev.get("/api/parts-catalogue", params={"q": "%_"}).json()["parts"]] == ["100%_odd"]
        assert len(kev.get("/api/parts-catalogue", params={"limit": 1}).json()["parts"]) == 1


def test_only_one_open_licensed_part_of_a_sane_size_is_published(user):
    assert publish(user, licence="All rights reserved").status_code == 422
    assert user.post("/api/parts-catalogue", json={"id": "x", "pack": PACK | {"parts": []}, "licence": "MIT"}).status_code == 422
    assert user.post("/api/parts-catalogue", json={"id": "x", "pack": {"pack": 2}, "licence": "MIT"}).status_code == 422
    assert publish(user, name="  ").status_code == 422
    big = one() | {"symbols": {"S": {"name": "S" * 400_100}}}
    assert user.post("/api/parts-catalogue", json={"id": "x", "pack": big, "licence": "MIT"}).status_code == 413
    # The credit is yours unless you say whose the part is.
    user.post("/api/parts-catalogue", json={"id": "x", "pack": one(), "licence": "MIT", "credit": " SparkFun "})
    assert user.get("/api/parts-catalogue").json()["parts"][0]["credit"] == "SparkFun"


def test_unpublish_takes_your_own_part_out(make_client):
    with make_client() as a, make_client() as b:
        sign_up(a, "a@example.com", "alice")
        sign_up(b, "b@example.com", "bob")
        publish(a)
        assert b.delete("/api/parts-catalogue/mine/shifter").status_code == 404
        assert a.delete("/api/parts-catalogue/mine/shifter").json() == {"ok": True}
        assert a.get("/api/parts-catalogue").json()["parts"] == []
        assert a.get("/api/parts-catalogue/mine").json()["parts"] == []


def test_publishing_needs_a_session(make_client):
    with make_client() as anon:
        assert publish(anon).status_code == 401
        assert anon.get("/api/parts-catalogue/mine").status_code == 401


def test_a_parts_body_file_is_served_with_the_part_and_the_library_link(make_client):
    body = {"model": {"source": {"kind": "step", "blob": "babcdef0123456789"}}, "footprint": "SOIC-8"}
    with make_client() as a, make_client() as anon:
        sign_up(a, "a@example.com", "alice")
        assert (
            a.put("/api/blobs/babcdef0123456789", content=b"ISO-10303-21;", headers={"content-type": "model/step"}).status_code
            == 200
        )
        a.put("/api/blobs/bother0123456789ab", content=b"secret", headers={"content-type": "model/step"})
        entry = publish(a, packages=[body, "odd", {"footprint": "DIP-8"}]).json()
        got = anon.get(f"/api/parts-catalogue/{entry['id']}/blobs/babcdef0123456789")
        assert got.status_code == 200 and got.content == b"ISO-10303-21;" and got.headers["content-type"] == "model/step"
        # Only the files the part names: nothing else of its publisher's.
        assert anon.get(f"/api/parts-catalogue/{entry['id']}/blobs/bother0123456789ab").status_code == 404
        assert anon.get("/api/parts-catalogue/999/blobs/babcdef0123456789").status_code == 404
        # A part that names a file its publisher never uploaded.
        gone = publish(a, "ghost", packages=[{"model": {"source": {"kind": "step", "blob": "bmissing012345678"}}}]).json()
        assert anon.get(f"/api/parts-catalogue/{gone['id']}/blobs/bmissing012345678").status_code == 404

        # The same file by a link to the library that holds the part.
        a.put("/api/parts-library", json={"pack": one(packages=[body])})
        token = a.post("/api/parts-library/share").json()["token"]
        assert anon.get(f"/api/parts-library/shared/{token}/blobs/babcdef0123456789").content == b"ISO-10303-21;"
        assert anon.get(f"/api/parts-library/shared/{token}/blobs/bother0123456789ab").status_code == 404
        assert anon.get(f"/api/parts-library/shared/{token}/blobs/bad hash!").status_code == 404
        assert anon.get("/api/parts-library/shared/nope/blobs/babcdef0123456789").status_code == 404
