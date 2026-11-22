-- Versions share their unchanged parts (copy on write). A saved model is cut into pieces (each timeline step, each
-- inline file, the rest of the document), each stored once per account, compressed, by the hash of its text. A
-- chunked version's bcad_json holds only a compressed manifest of hashes; version_chunks says which pieces it uses,
-- so pieces nothing uses any more can be swept. chunked: 0 saved whole (converted at start-up), 1 in pieces,
-- -1 couldn't be cut up and stays whole.
CREATE TABLE chunks (
  user_id INTEGER NOT NULL,
  hash TEXT NOT NULL,
  data BLOB NOT NULL,
  stored INTEGER NOT NULL,
  PRIMARY KEY (user_id, hash)
);

CREATE TABLE version_chunks (
  version_id INTEGER NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
  hash TEXT NOT NULL,
  PRIMARY KEY (version_id, hash)
);
CREATE INDEX version_chunks_hash ON version_chunks(hash);

ALTER TABLE versions ADD COLUMN chunked INTEGER NOT NULL DEFAULT 0;
