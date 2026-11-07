-- Accounts and saved models (#87, #88). Model documents are zlib-compressed .bcad text; import files live on disk
-- under DATA_DIR/blobs/<user>/<hash> with a row here as the index.
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password TEXT NOT NULL,
  theme TEXT,
  created TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL,
  created TEXT NOT NULL DEFAULT (datetime('now')),
  expires TEXT NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE sign_in_failures (
  key TEXT NOT NULL,
  at REAL NOT NULL
);
CREATE INDEX sign_in_failures_key ON sign_in_failures(key, at);

CREATE TABLE models (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  thumbnail TEXT,
  version INTEGER NOT NULL DEFAULT 0,
  created TEXT NOT NULL DEFAULT (datetime('now')),
  modified TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);
CREATE INDEX models_user ON models(user_id, modified);

CREATE TABLE versions (
  id INTEGER PRIMARY KEY,
  model_id TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  bcad_json BLOB NOT NULL,
  size INTEGER NOT NULL,
  thumbnail TEXT,
  created TEXT NOT NULL DEFAULT (datetime('now')),
  note TEXT,
  UNIQUE (model_id, number)
);
CREATE INDEX versions_model ON versions(model_id, number);

CREATE TABLE shares (
  token TEXT PRIMARY KEY,
  model_id TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  version INTEGER,
  created TEXT NOT NULL DEFAULT (datetime('now')),
  expires TEXT
);
CREATE INDEX shares_model ON shares(model_id);

CREATE TABLE blobs (
  hash TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  size INTEGER NOT NULL,
  mime TEXT NOT NULL,
  created TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (hash, user_id)
);
CREATE INDEX blobs_user ON blobs(user_id);
