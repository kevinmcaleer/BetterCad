"""Nightly housekeeping (#87): thin old versions, empty the bin, and back up the database and blobs."""

import asyncio
import logging
import shutil
import sqlite3
from datetime import UTC, datetime, timedelta
from pathlib import Path

log = logging.getLogger("bettercad.jobs")

KEEP_DAYS = 30
KEEP_OLD = 10
BIN_DAYS = 30


def thin(db: sqlite3.Connection, keep_days: int = KEEP_DAYS, keep_old: int = KEEP_OLD) -> int:
    """Keeps every version from the last `keep_days`, then the newest `keep_old` of the older ones. The latest
    version and any version a share link points to always stay. Returns how many were deleted."""
    with db:
        cur = db.execute(
            """
            DELETE FROM versions WHERE id IN (
              SELECT v.id FROM (
                SELECT id, model_id, number, created,
                       ROW_NUMBER() OVER (PARTITION BY model_id ORDER BY number DESC) AS rank
                FROM versions WHERE created < datetime('now', ?)
              ) v
              JOIN models m ON m.id = v.model_id
              WHERE v.rank > ? AND v.number != m.version
                AND NOT EXISTS (SELECT 1 FROM shares s WHERE s.model_id = v.model_id AND s.version = v.number)
            )
            """,
            (f"-{keep_days} days", keep_old),
        )
    return cur.rowcount


def empty_bin(db: sqlite3.Connection, days: int = BIN_DAYS) -> int:
    """Deletes models, folders and projects that have been in the bin longer than `days`. Returns the models."""
    age = (f"-{days} days",)
    with db:
        cur = db.execute("DELETE FROM models WHERE deleted_at IS NOT NULL AND deleted_at < datetime('now', ?)", age)
        db.execute("DELETE FROM folders WHERE deleted_at IS NOT NULL AND deleted_at < datetime('now', ?)", age)
        db.execute("DELETE FROM projects WHERE deleted_at IS NOT NULL AND deleted_at < datetime('now', ?)", age)
    return cur.rowcount


def forget_orphan_blobs(db: sqlite3.Connection, blobs: Path) -> int:
    """Removes blob files whose user has gone."""
    if not blobs.is_dir():
        return 0
    users = {str(row[0]) for row in db.execute("SELECT id FROM accounts")}
    gone = [d for d in blobs.iterdir() if d.is_dir() and d.name not in users]
    for d in gone:
        shutil.rmtree(d, ignore_errors=True)
    return len(gone)


def backup(db: sqlite3.Connection, blobs: Path, dest: Path, days: int = 14, now: datetime | None = None) -> Path:
    """A consistent copy of the database (SQLite's online backup) and the blob folder into `dest/<date>/`,
    keeping `days` of them."""
    now = now or datetime.now(UTC)
    target = dest / now.strftime("%Y-%m-%d")
    target.mkdir(parents=True, exist_ok=True)
    out = sqlite3.connect(target / "bettercad.db")
    try:
        db.backup(out)
    finally:
        out.close()
    if blobs.is_dir():
        shutil.copytree(blobs, target / "blobs", dirs_exist_ok=True)
    cutoff = (now - timedelta(days=days)).strftime("%Y-%m-%d")
    for old in dest.iterdir():
        if old.is_dir() and len(old.name) == 10 and old.name < cutoff:
            shutil.rmtree(old, ignore_errors=True)
    return target


def nightly(db: sqlite3.Connection, settings) -> dict:
    done = {"thinned": thin(db), "binned": empty_bin(db), "orphans": forget_orphan_blobs(db, settings.blob_dir)}
    if settings.backup_dir:
        done["backup"] = str(backup(db, settings.blob_dir, Path(settings.backup_dir), settings.backup_days))
    return done


async def run_daily(db: sqlite3.Connection, settings, hour: int = 3) -> None:  # pragma: no cover - a timer
    """Runs `nightly` at `hour` UTC each day for as long as the app is up."""
    while True:
        now = datetime.now(UTC)
        next_run = now.replace(hour=hour, minute=0, second=0, microsecond=0)
        if next_run <= now:
            next_run += timedelta(days=1)
        await asyncio.sleep((next_run - now).total_seconds())
        try:
            log.info("nightly %s", nightly(db, settings))
        except Exception:
            log.exception("nightly jobs failed")
