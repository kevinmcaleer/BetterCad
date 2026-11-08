"""Accounts made before kevsrobots.com sign-in (#88): kept, set aside, and handed over on request.

The ids of the old sign-in (the stand-in login, then powertools-auth) aren't kevsrobots.com user ids, so an old
account 5 must not become whoever has id 5 on kevsrobots.com. On first start with kevsrobots.com sign-in, every old
account moves to a negative id ("set aside"): its models, versions, share links, imported files and printer profiles
stay as they were, and nobody can sign in to them. Share links keep working.

To get your models back, sign in to BetterCad once with kevsrobots.com, then run

    docker compose exec bettercad python -m bettercad.accounts                 # lists the set-aside accounts
    docker compose exec bettercad python -m bettercad.accounts claim OLD NEW    # OLD: old name, NEW: kevsrobots.com username

which moves everything from the old account onto the new one.
"""

import shutil
import sqlite3
import sys
from pathlib import Path

SOURCE = "kevsrobots"


def _move_blob_dir(blobs: Path, old: int, new: int) -> None:
    src, dest = blobs / str(old), blobs / str(new)
    if not src.is_dir():
        return
    if not dest.exists():
        src.rename(dest)
        return
    for f in src.iterdir():
        if not (dest / f.name).exists():
            f.rename(dest / f.name)
    shutil.rmtree(src, ignore_errors=True)


def _move(db: sqlite3.Connection, old: int, new: int) -> None:
    """Moves everything owned by account `old` onto account `new` (which must exist) and deletes `old`."""
    db.execute("UPDATE models SET user_id = ? WHERE user_id = ?", (new, old))
    db.execute("UPDATE OR IGNORE blobs SET user_id = ? WHERE user_id = ?", (new, old))
    db.execute("UPDATE OR IGNORE printer_profiles SET user_id = ? WHERE user_id = ?", (new, old))
    db.execute("DELETE FROM accounts WHERE id = ?", (old,))


def set_aside(db: sqlite3.Connection, blobs: Path) -> int:
    """Gives every account from another sign-in a negative id, so no kevsrobots.com user can land on it."""
    row = db.execute("SELECT value FROM meta WHERE key = 'auth_source'").fetchone()
    olds: list[int] = []
    with db:
        if row is not None and row[0] != SOURCE:
            olds = [r[0] for r in db.execute("SELECT id FROM accounts WHERE id > 0").fetchall()]
            for old in olds:
                db.execute(
                    "INSERT INTO accounts (id, name, theme, created) SELECT ?, name, theme, created FROM accounts WHERE id = ?",
                    (-old, old),
                )
                _move(db, old, -old)
        db.execute("INSERT OR REPLACE INTO meta VALUES ('auth_source', ?)", (SOURCE,))
    for old in olds:
        _move_blob_dir(blobs, old, -old)
    return len(olds)


def set_aside_accounts(db: sqlite3.Connection) -> list[sqlite3.Row]:
    return db.execute(
        "SELECT a.id, a.name, a.created, (SELECT COUNT(*) FROM models m WHERE m.user_id = a.id) AS models "
        "FROM accounts a WHERE a.id < 0 ORDER BY a.id DESC"
    ).fetchall()


def claim(db: sqlite3.Connection, blobs: Path, old_name: str, username: str) -> int:
    """Hands a set-aside account's models to a kevsrobots.com account that has signed in here. Returns the model count."""
    olds = db.execute("SELECT id FROM accounts WHERE id < 0 AND lower(name) = lower(?)", (old_name,)).fetchall()
    if not olds:
        raise LookupError(f"No set-aside account is called {old_name!r}.")
    if len(olds) > 1:
        raise LookupError(f"More than one set-aside account is called {old_name!r}; claim by id (e.g. {olds[0][0]}).")
    new = db.execute("SELECT id FROM accounts WHERE id > 0 AND lower(name) = lower(?)", (username,)).fetchone()
    if new is None:
        raise LookupError(f"{username!r} hasn't signed in to BetterCad yet. Sign in once with kevsrobots.com, then try again.")
    return _claim_ids(db, blobs, olds[0][0], new[0])


def _claim_ids(db: sqlite3.Connection, blobs: Path, old: int, new: int) -> int:
    with db:
        n = db.execute("SELECT COUNT(*) FROM models WHERE user_id = ?", (old,)).fetchone()[0]
        _move(db, old, new)
    _move_blob_dir(blobs, old, new)
    return n


def main(argv: list[str]) -> int:
    from . import db as dbm
    from .settings import get_settings

    settings = get_settings()
    conn = dbm.connect(settings.db_path)
    dbm.migrate(conn)
    set_aside(conn, settings.blob_dir)
    if not argv or argv[0] == "list":
        rows = set_aside_accounts(conn)
        if not rows:
            print("No accounts are set aside.")
        for r in rows:
            print(f"{r['name']}  (id {r['id']}, {r['models']} models, made {r['created']})")
        return 0
    if argv[0] == "claim" and len(argv) == 3:
        try:
            old = argv[1]
            if old.lstrip("-").isdigit() and int(old) < 0:
                new = conn.execute("SELECT id FROM accounts WHERE id > 0 AND lower(name) = lower(?)", (argv[2],)).fetchone()
                if new is None:
                    raise LookupError(f"{argv[2]!r} hasn't signed in to BetterCad yet.")
                n = _claim_ids(conn, settings.blob_dir, int(old), new[0])
            else:
                n = claim(conn, settings.blob_dir, old, argv[2])
        except LookupError as e:
            print(e, file=sys.stderr)
            return 1
        print(f"Moved {n} models to {argv[2]}.")
        return 0
    print(__doc__.split("To get")[1].strip(), file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
