"""SQLite in WAL mode with numbered .sql migrations. No ORM: plain sqlite3 keeps the Pi build small."""

import sqlite3
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

MIGRATIONS = Path(__file__).parent / "migrations"


class Rows:
    """A query's results, read in full while the connection's lock is held, so no other thread can step the same
    connection while these rows are being fetched. Offers the parts of sqlite3.Cursor the app uses."""

    def __init__(self, cur: sqlite3.Cursor) -> None:
        self.description = cur.description
        self.rowcount = cur.rowcount
        self.lastrowid = cur.lastrowid
        self._rows = cur.fetchall() if cur.description else []
        self._next = 0

    def fetchone(self):
        if self._next >= len(self._rows):
            return None
        self._next += 1
        return self._rows[self._next - 1]

    def fetchall(self) -> list:
        rest, self._next = self._rows[self._next :], len(self._rows)
        return rest

    def __iter__(self):
        return iter(self.fetchall())


class Connection(sqlite3.Connection):
    """One connection shared by every request. FastAPI runs sync routes and dependencies in a pool of worker threads,
    and a sqlite3 connection used by two threads at once fails with "bad parameter or other API misuse". So every use
    takes a lock, and a `with conn:` transaction holds it until it commits, keeping other threads' statements out."""

    def __init__(self, *args, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        self._lock = threading.RLock()

    def execute(self, sql, params=(), /):  # type: ignore[override]
        with self._lock:
            return Rows(super().execute(sql, params))

    def executemany(self, sql, params, /):  # type: ignore[override]
        with self._lock:
            return Rows(super().executemany(sql, params))

    def executescript(self, script, /):  # type: ignore[override]
        with self._lock:
            return Rows(super().executescript(script))

    def commit(self) -> None:
        with self._lock:
            super().commit()

    def rollback(self) -> None:
        with self._lock:
            super().rollback()

    def backup(self, *args, **kwargs) -> None:
        with self._lock:
            super().backup(*args, **kwargs)

    def __enter__(self):
        self._lock.acquire()
        try:
            return super().__enter__()
        except BaseException:
            self._lock.release()
            raise

    def __exit__(self, *exc):
        try:
            return super().__exit__(*exc)
        finally:
            self._lock.release()


def connect(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, check_same_thread=False, factory=Connection)
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
