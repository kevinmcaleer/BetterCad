-- The shared parts catalogue (#625, #629): electronics components people publish from their own libraries. A part goes
-- live straight away marked 'unreviewed', and an admin approves or rejects it. `data` is a one-part library pack, the
-- same JSON the editor keeps, so the editor can add fields without a migration. `search` is the lower-case text a
-- search looks in.
CREATE TABLE part_catalogue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  part_id TEXT NOT NULL,
  name TEXT NOT NULL,
  search TEXT NOT NULL,
  licence TEXT NOT NULL,
  credit TEXT NOT NULL,
  data TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unreviewed' CHECK (status IN ('unreviewed', 'approved', 'rejected')),
  created TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  modified TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  UNIQUE (user_id, part_id)
);
CREATE INDEX part_catalogue_status ON part_catalogue (status, name);

-- A link to someone's whole library (#629): whoever has the token can read the library as it is now.
CREATE TABLE part_library_shares (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  created TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
);
