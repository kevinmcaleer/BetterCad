-- The first migration only records server metadata. Accounts and saved models arrive with epic #9.
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
