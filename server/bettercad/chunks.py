"""Versions that share their unchanged parts (copy on write).

A saved .bcad is cut into pieces: each timeline step, each imported file or picture still carried inline, and the
rest of the document. Each piece is stored once per account, compressed, under the hash of its text. A version keeps
only a small manifest of hashes, so an autosave that changed one step costs that step and the manifest, not the
whole model again. The picture a version carries lives in its own column (versions.thumbnail), so the stored
document leaves it out and reading puts it back.

Pieces nothing refers to any more (thinned versions, deleted models) are swept away by `sweep`.
"""

import base64
import hashlib
import json
import sqlite3
import zlib

#: A manifest's format, so a later change can tell old ones apart.
FORMAT = 1
LEVEL = 9


def _text(piece) -> str:
    return json.dumps(piece, separators=(",", ":"), ensure_ascii=False)


def pack(text: str) -> bytes:
    """Compressed, unless that's no smaller (tiny pieces): JSON text never starts with zlib's 0x78 byte, so `unpack`
    can tell them apart."""
    raw = text.encode()
    small = zlib.compress(raw, LEVEL)
    return small if len(small) < len(raw) else raw


def unpack(data: bytes) -> str:
    return (zlib.decompress(data) if data[:1] == b"\x78" else data).decode()


def _hash(text: str) -> str:
    """120 bits of SHA-256, in 20 URL-safe characters: short, as a manifest is mostly hashes."""
    return base64.urlsafe_b64encode(hashlib.sha256(text.encode()).digest()[:15]).decode()


def split(bcad: str, thumbnail: str | None = None) -> tuple[dict, list[tuple[str, str]]]:
    """A .bcad's manifest and its pieces as (hash, text). The text must already be a BetterCad model. Its picture is
    left out when it is `thumbnail`, the one the version keeps beside it."""
    data = json.loads(bcad)
    pieces: dict[str, str] = {}

    def keep(piece) -> str:
        text = _text(piece)
        h = _hash(text)
        pieces.setdefault(h, text)
        return h

    head = dict(data)
    manifest: dict = {"format": FORMAT}
    if thumbnail and head.get("thumbnail") == thumbnail:
        head["thumbnail"] = None
        manifest["thumbnail"] = True
    doc = head.get("document")
    if isinstance(doc, dict):
        rest = dict(doc)
        features = rest.get("features")
        if isinstance(features, list):
            manifest["features"] = [keep(f) for f in features]
            rest["features"] = []
        blobs = rest.get("blobs")
        if isinstance(blobs, dict):
            inline = {k: v for k, v in blobs.items() if isinstance(v, str) and v}
            if inline:
                manifest["blobs"] = {k: keep(v) for k, v in inline.items()}
                rest["blobs"] = {k: ("" if k in inline else v) for k, v in blobs.items()}
        manifest["document"] = keep(rest)
        head["document"] = None
    manifest["head"] = keep(head)
    return manifest, list(pieces.items())


def join(manifest: dict, pieces: dict[str, str], thumbnail: str | None) -> str:
    """The .bcad text again, from its manifest and the pieces' text by hash."""
    head = json.loads(pieces[manifest["head"]])
    if "document" in manifest:
        doc = json.loads(pieces[manifest["document"]])
        if "features" in manifest:
            doc["features"] = [json.loads(pieces[h]) for h in manifest["features"]]
        if "blobs" in manifest:
            blobs = doc.get("blobs") or {}
            doc["blobs"] = {**blobs, **{k: json.loads(pieces[h]) for k, h in manifest["blobs"].items()}}
        head["document"] = doc
    if manifest.get("thumbnail"):
        if thumbnail:
            head["thumbnail"] = thumbnail
        else:
            head.pop("thumbnail", None)
    return json.dumps(head, indent=2, ensure_ascii=False) + "\n"


def hashes(manifest: dict) -> set[str]:
    out = {manifest["head"]}
    if "document" in manifest:
        out.add(manifest["document"])
    out.update(manifest.get("features", []))
    out.update(manifest.get("blobs", {}).values())
    return out


def store(db: sqlite3.Connection, user_id: int, version_id: int, bcad: str, thumbnail: str | None) -> bytes:
    """Saves a version's pieces for its account (the ones it doesn't have yet) and links them to the version.
    Returns the packed manifest, which goes in versions.bcad_json. Call inside a transaction."""
    manifest, pieces = split(bcad, thumbnail)
    for h, text in pieces:
        if db.execute("SELECT 1 FROM chunks WHERE user_id = ? AND hash = ?", (user_id, h)).fetchone():
            continue
        data = pack(text)
        db.execute("INSERT INTO chunks (user_id, hash, data, stored) VALUES (?, ?, ?, ?)", (user_id, h, data, len(data)))
    links = [(version_id, h) for h in hashes(manifest)]
    db.executemany("INSERT OR IGNORE INTO version_chunks (version_id, hash) VALUES (?, ?)", links)
    return pack(_text(manifest))


def load(db: sqlite3.Connection, user_id: int, version: sqlite3.Row) -> str:
    """A version's .bcad text, whichever way it was stored."""
    if version["chunked"] != 1:
        return zlib.decompress(version["bcad_json"]).decode()
    manifest = json.loads(unpack(version["bcad_json"]))
    want = sorted(hashes(manifest))
    rows = db.execute(
        f"SELECT hash, data FROM chunks WHERE user_id = ? AND hash IN ({','.join('?' * len(want))})", (user_id, *want)
    ).fetchall()
    pieces = {r["hash"]: unpack(r["data"]) for r in rows}
    return join(manifest, pieces, version["thumbnail"])


def convert(db: sqlite3.Connection, batch: int = 50) -> int:
    """Moves versions saved whole into shared pieces. Safe to run again; returns how many it converted."""
    done = 0
    while True:
        rows = db.execute(
            "SELECT v.id, v.bcad_json, v.thumbnail, m.user_id FROM versions v JOIN models m ON m.id = v.model_id"
            " WHERE v.chunked = 0 LIMIT ?",
            (batch,),
        ).fetchall()
        if not rows:
            return done
        with db:
            for v in rows:
                text = zlib.decompress(v["bcad_json"]).decode()
                try:
                    manifest = store(db, v["user_id"], v["id"], text, v["thumbnail"])
                except (ValueError, TypeError):
                    # Not JSON we can cut up: keep it whole, and don't look at it again.
                    db.execute("UPDATE versions SET chunked = -1 WHERE id = ?", (v["id"],))
                    continue
                db.execute("UPDATE versions SET bcad_json = ?, chunked = 1 WHERE id = ?", (manifest, v["id"]))
                done += 1


def sweep(db: sqlite3.Connection, user_id: int | None = None) -> int:
    """Deletes pieces no version of their account uses any more. Returns how many went."""
    where = "AND c.user_id = ?" if user_id is not None else ""
    with db:
        cur = db.execute(
            f"""
            DELETE FROM chunks WHERE rowid IN (
              SELECT c.rowid FROM chunks c WHERE NOT EXISTS (
                SELECT 1 FROM version_chunks vc JOIN versions v ON v.id = vc.version_id JOIN models m ON m.id = v.model_id
                WHERE vc.hash = c.hash AND m.user_id = c.user_id
              ) {where}
            )
            """,
            (user_id,) if user_id is not None else (),
        )
    return cur.rowcount


def used(db: sqlite3.Connection, user_id: int) -> int:
    """Bytes an account's models take: each piece once, plus every version's manifest (or whole text, if older)."""
    pieces = db.execute("SELECT COALESCE(SUM(stored), 0) FROM chunks WHERE user_id = ?", (user_id,)).fetchone()[0]
    versions = db.execute(
        "SELECT COALESCE(SUM(length(v.bcad_json)), 0) FROM versions v JOIN models m ON m.id = v.model_id WHERE m.user_id = ?",
        (user_id,),
    ).fetchone()[0]
    return pieces + versions


#: SQL for one model's size, `m` being the models row: the pieces its versions use, each once, and their manifests.
MODEL_BYTES = (
    "(SELECT COALESCE(SUM(c.stored), 0) FROM chunks c WHERE c.user_id = m.user_id AND c.hash IN ("
    " SELECT vc.hash FROM version_chunks vc JOIN versions v ON v.id = vc.version_id WHERE v.model_id = m.id))"
    " + (SELECT COALESCE(SUM(length(v.bcad_json)), 0) FROM versions v WHERE v.model_id = m.id)"
)
