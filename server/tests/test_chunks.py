import json
import zlib

from conftest import BCAD

from bettercad import chunks, db, jobs

PIC = "data:image/png;base64,iVBORw0KGgo="


def model(steps: int = 30, changed: int = -1) -> str:
    """A model with `steps` sketches big enough to matter; step `changed` differs from the others' first save."""
    data = json.loads(BCAD)
    data["document"]["features"] = [
        {
            "id": f"f{i}",
            "type": "sketch",
            "name": f"Sketch {i}" + ("!" if i == changed else ""),
            "points": [[i * 0.5 + k, k * 1.25] for k in range(200)],
        }
        for i in range(steps)
    ]
    data["document"]["looks"] = {"b1": {"colour": "#ff8800"}}
    return json.dumps(data, indent=2) + "\n"


def test_split_and_join_give_the_model_back():
    data = json.loads(model())
    data["document"]["blobs"] = {"abc": "c29saWQ=", "def": ""}
    text = json.dumps(data)
    manifest, pieces = chunks.split(text, PIC)
    assert json.loads(dict(pieces)[manifest["head"]])["thumbnail"] is None
    assert json.loads(chunks.join(manifest, dict(pieces), PIC)) == data
    # A rendered picture that replaced the saved one comes back instead.
    jpeg = "data:image/jpeg;base64,AAAA"
    assert json.loads(chunks.join(manifest, dict(pieces), jpeg))["thumbnail"] == jpeg
    # A picture that isn't the version's stays in the file.
    manifest, pieces = chunks.split(text, None)
    assert json.loads(chunks.join(manifest, dict(pieces), None)) == data


def test_pack_leaves_tiny_pieces_as_they_are():
    assert chunks.pack("1") == b"1"
    big = json.dumps(["x" * 500])
    assert chunks.pack(big)[:1] == b"\x78" and chunks.unpack(chunks.pack(big)) == big


def test_versions_share_the_steps_they_didnt_change(user):
    m = user.post("/api/models", json={"name": "Rover", "bcad": model()}).json()
    first = user.get("/api/models").json()["models"][0]["size"]
    for i in range(20):
        assert user.put(f"/api/models/{m['id']}", json={"bcad": model(changed=i)}).status_code == 200
    listed = user.get("/api/models").json()["models"][0]
    assert listed["versions"] == 21
    # Twenty more versions cost a fraction of twenty more copies.
    assert listed["size"] - first < 20 * first / 10
    assert user.get("/api/me/usage").json()["bytes"] == listed["size"]
    v5 = json.loads(user.get(f"/api/models/{m['id']}/versions/6").json()["bcad"])
    assert v5 == json.loads(model(changed=4))


def test_a_copy_costs_a_manifest_and_deleting_sweeps_its_pieces(user):
    m = user.post("/api/models", json={"name": "Rover", "bcad": model()}).json()
    before = user.get("/api/me/usage").json()["bytes"]
    copy = user.post(f"/api/models/{m['id']}/duplicate").json()
    after = user.get("/api/me/usage").json()["bytes"]
    assert 0 < after - before < 2000
    assert json.loads(user.get(f"/api/models/{copy['id']}").json()["bcad"]) == json.loads(model())
    # Deleting the original keeps the pieces the copy uses; deleting both lets them go.
    user.delete(f"/api/models/{m['id']}?forever=true")
    assert json.loads(user.get(f"/api/models/{copy['id']}").json()["bcad"]) == json.loads(model())
    user.delete(f"/api/models/{copy['id']}?forever=true")
    assert user.get("/api/me/usage").json()["bytes"] == 0


def test_restoring_a_version_costs_a_manifest(user):
    m = user.post("/api/models", json={"name": "Rover", "bcad": model()}).json()
    user.put(f"/api/models/{m['id']}", json={"bcad": model(changed=3)})
    before = user.get("/api/me/usage").json()["bytes"]
    assert user.post(f"/api/models/{m['id']}/versions/1/restore").json() == {"version": 3}
    assert 0 < user.get("/api/me/usage").json()["bytes"] - before < 2000
    assert json.loads(user.get(f"/api/models/{m['id']}").json()["bcad"]) == json.loads(model())


def setup_legacy(tmp_path):
    conn = db.connect(tmp_path / "t.db")
    db.migrate(conn)
    with conn:
        conn.execute("INSERT INTO accounts (id, name) VALUES (1, 'kev')")
        conn.execute("INSERT INTO models (id, user_id, name, version) VALUES ('m', 1, 'Rover', 3)")
        for n in range(1, 4):
            text = model(changed=n)
            conn.execute(
                "INSERT INTO versions (model_id, number, bcad_json, size, thumbnail) VALUES ('m', ?, ?, ?, ?)",
                (n, zlib.compress(text.encode(), 6), len(text), None),
            )
        conn.execute(
            "INSERT INTO versions (model_id, number, bcad_json, size) VALUES ('m', 4, ?, 8)", (zlib.compress(b"not json"),)
        )
    return conn


def test_saved_versions_are_converted_once(tmp_path):
    conn = setup_legacy(tmp_path)
    whole = chunks.used(conn, 1)
    assert chunks.convert(conn) == 3
    assert chunks.convert(conn) == 0
    assert chunks.used(conn, 1) < whole
    for n in range(1, 4):
        v = conn.execute("SELECT * FROM versions WHERE number = ?", (n,)).fetchone()
        assert v["chunked"] == 1 and json.loads(chunks.load(conn, 1, v)) == json.loads(model(changed=n))
    odd = conn.execute("SELECT * FROM versions WHERE number = 4").fetchone()
    assert odd["chunked"] == -1 and chunks.load(conn, 1, odd) == "not json"


def test_nightly_sweeps_pieces_of_thinned_versions(tmp_path):
    conn = setup_legacy(tmp_path)
    chunks.convert(conn)
    pieces = conn.execute("SELECT COUNT(*) FROM chunks").fetchone()[0]
    with conn:
        conn.execute("DELETE FROM versions WHERE number IN (1, 2)")
    # Sketch 1 and 2 as changed there, and sketch 3 as it was before version 3 changed it.
    assert chunks.sweep(conn) == 3
    assert conn.execute("SELECT COUNT(*) FROM chunks").fetchone()[0] == pieces - 3
    with conn:
        conn.execute("DELETE FROM models")
    assert chunks.sweep(conn) == pieces - 3
    assert jobs.chunks is chunks
