import zlib
from datetime import UTC, datetime

from bettercad import db, jobs
from bettercad.settings import Settings


def setup(tmp_path):
    conn = db.connect(tmp_path / "t.db")
    db.migrate(conn)
    conn.execute("INSERT INTO users (id, email, name, password) VALUES (1, 'a@b.co', 'A', 'x')")
    conn.execute("INSERT INTO models (id, user_id, name, version) VALUES ('m', 1, 'Box', 30)")
    for n in range(1, 31):
        # Versions 1 to 25 are 60 days old, 26 to 30 are recent.
        age = "-60 days" if n <= 25 else "-1 days"
        conn.execute(
            "INSERT INTO versions (model_id, number, bcad_json, size, created) VALUES ('m', ?, ?, 2, datetime('now', ?))",
            (n, zlib.compress(b"{}"), age),
        )
    conn.commit()
    return conn


def numbers(conn):
    return [r[0] for r in conn.execute("SELECT number FROM versions ORDER BY number")]


def test_thinning_keeps_recent_the_last_ten_old_and_shared(tmp_path):
    conn = setup(tmp_path)
    conn.execute("INSERT INTO shares (token, model_id, version) VALUES ('t', 'm', 3)")
    conn.commit()
    assert jobs.thin(conn) == 14
    assert numbers(conn) == [3, *range(16, 31)]
    assert jobs.thin(conn) == 0


def test_bin_is_emptied_after_30_days(tmp_path):
    conn = setup(tmp_path)
    conn.execute("INSERT INTO models (id, user_id, name, deleted_at) VALUES ('old', 1, 'Old', datetime('now', '-31 days'))")
    conn.execute("INSERT INTO models (id, user_id, name, deleted_at) VALUES ('new', 1, 'New', datetime('now', '-1 days'))")
    conn.commit()
    assert jobs.empty_bin(conn) == 1
    assert {r[0] for r in conn.execute("SELECT id FROM models")} == {"m", "new"}


def test_backup_copies_and_rotates(tmp_path):
    conn = setup(tmp_path)
    blobs = tmp_path / "blobs"
    (blobs / "1").mkdir(parents=True)
    (blobs / "1" / "abc").write_bytes(b"solid")
    (blobs / "9").mkdir()
    dest = tmp_path / "backups"
    (dest / "2026-01-01").mkdir(parents=True)
    out = jobs.backup(conn, blobs, dest, days=14, now=datetime(2026, 11, 7, tzinfo=UTC))
    assert out.name == "2026-11-07"
    copy = db.connect(out / "bettercad.db")
    assert copy.execute("SELECT COUNT(*) FROM versions").fetchone()[0] == 30
    assert (out / "blobs" / "1" / "abc").read_bytes() == b"solid"
    assert not (dest / "2026-01-01").exists()
    assert jobs.forget_orphan_blobs(conn, blobs) == 1
    assert not (blobs / "9").exists() and (blobs / "1").exists()


def test_nightly_runs_everything(tmp_path):
    conn = setup(tmp_path)
    settings = Settings(data_dir=tmp_path, backup_dir=tmp_path / "backups")
    done = jobs.nightly(conn, settings)
    assert done["thinned"] == 15 and done["binned"] == 0 and "backup" in done
    assert jobs.forget_orphan_blobs(conn, tmp_path / "none") == 0
