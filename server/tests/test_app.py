import sqlite3

import pytest

from bettercad import db
from bettercad.settings import Settings


def test_health(make_client):
    with make_client() as client:
        r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"ok": True, "version": "test"}
    assert r.headers["Cross-Origin-Opener-Policy"] == "same-origin"
    assert r.headers["Cross-Origin-Embedder-Policy"] == "require-corp"


def test_unknown_api_path_is_json_404(make_client):
    with make_client() as client:
        r = client.get("/api/nope")
    assert r.status_code == 404
    assert r.json() == {"detail": "Not found"}


def test_serves_web_app_with_fallback(make_client, tmp_path):
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html><title>BetterCad</title>")
    (dist / "assets" / "app-abc.js").write_text("console.log(1)")
    with make_client(web_dist=dist) as client:
        assert "BetterCad" in client.get("/").text
        deep = client.get("/models/123")
        assert "BetterCad" in deep.text
        assert deep.headers["Cache-Control"] == "no-cache"
        asset = client.get("/assets/app-abc.js")
        assert asset.headers["Cache-Control"].startswith("public, max-age=31536000")
        assert "BetterCad" in client.get("/../../etc/passwd").text


def test_production_needs_secret_key(tmp_path):
    with pytest.raises(RuntimeError, match="SECRET_KEY"):
        Settings(env="production", data_dir=tmp_path).check()
    Settings(env="production", secret_key="x", data_dir=tmp_path).check()


def test_database_is_wal_and_migrated_once(tmp_path):
    conn = db.connect(tmp_path / "t.db")
    assert conn.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
    assert conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1
    assert db.migrate(conn) == [1, 2]
    assert db.migrate(conn) == []
    assert conn.execute("SELECT name FROM sqlite_master WHERE name='meta'").fetchone()
    conn.close()
    assert isinstance(sqlite3.connect(tmp_path / "t.db"), sqlite3.Connection)


def test_serves_precompressed_assets(make_client, tmp_path):
    import gzip

    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html>")
    (dist / "assets" / "k-abc.wasm").write_bytes(b"\0asm" + b"x" * 100)
    (dist / "assets" / "k-abc.wasm.gz").write_bytes(gzip.compress(b"\0asm" + b"x" * 100))
    with make_client(web_dist=dist) as client:
        zipped = client.get("/assets/k-abc.wasm", headers={"Accept-Encoding": "gzip"})
        assert zipped.headers["Content-Encoding"] == "gzip"
        assert zipped.headers["Content-Type"] == "application/wasm"
        assert zipped.content == b"\0asm" + b"x" * 100
        plain = client.get("/assets/k-abc.wasm", headers={"Accept-Encoding": "identity"})
        assert "Content-Encoding" not in plain.headers
        assert plain.headers["Content-Type"] == "application/wasm"


def test_prefers_brotli_when_the_browser_takes_it(make_client, tmp_path):
    import gzip

    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html>")
    (dist / "assets" / "app-abc.js").write_text("console.log(1)")
    (dist / "assets" / "app-abc.js.gz").write_bytes(gzip.compress(b"console.log(1)"))
    (dist / "assets" / "app-abc.js.br").write_bytes(b"BROTLI")
    with make_client(web_dist=dist) as client:
        with client.stream("GET", "/assets/app-abc.js", headers={"Accept-Encoding": "gzip, deflate, br"}) as r:
            assert r.headers["Content-Encoding"] == "br"
            assert r.headers["Content-Type"].startswith("text/javascript")
            assert b"".join(r.iter_raw()) == b"BROTLI"
        assert client.get("/assets/app-abc.js", headers={"Accept-Encoding": "gzip"}).headers["Content-Encoding"] == "gzip"
