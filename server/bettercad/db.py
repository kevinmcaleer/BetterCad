"""SQLite in WAL mode with numbered .sql migrations. No ORM: plain sqlite3 keeps the Pi build small."""

import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

MIGRATIONS = Path(__file__).parent / "migrations"


def connect(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def migrate(conn: sqlite3.Connection) -> list[int]:
    """Applies every migration newer than the recorded schema version. Returns the versions applied."""
    conn.execute("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)")
    done = {row[0] for row in conn.execute("SELECT version FROM schema_version")}
    applied = []
    for sql in sorted(MIGRATIONS.glob("*.sql")):
        version = int(sql.name.split("_", 1)[0])
        if version in done:
            continue
        with conn:
            conn.executescript(sql.read_text())
            conn.execute("INSERT INTO schema_version VALUES (?, datetime('now'))", (version,))
        applied.append(version)
    return applied


@contextmanager
def transaction(conn: sqlite3.Connection) -> Iterator[sqlite3.Connection]:
    with conn:
        yield conn
