-- Shared login (#88): powertools-auth now owns users, sessions and password resets, possibly in another database.
-- BetterCad keeps `accounts`, one row per person who has used it, keyed by their user id there. The stand-in login's
-- credentials wait in `legacy_logins` until the server moves them into the auth tables (auth.adopt_legacy_logins).
DROP TABLE sessions;
DROP TABLE sign_in_failures;

CREATE TABLE legacy_logins (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  password TEXT NOT NULL,
  created TEXT NOT NULL
);
INSERT INTO legacy_logins SELECT id, email, name, password, created FROM users;

-- Renaming rewrites the foreign keys of models, blobs and printer_profiles to point at `accounts`. The rebuild after it
-- runs with foreign keys off (no cascade on the drop) and the legacy rename (nothing else is rewritten).
ALTER TABLE users RENAME TO accounts;
PRAGMA foreign_keys = OFF;
CREATE TABLE accounts_new (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  theme TEXT,
  created TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO accounts_new SELECT id, name, theme, created FROM accounts;
DROP TABLE accounts;
PRAGMA legacy_alter_table = ON;
ALTER TABLE accounts_new RENAME TO accounts;
PRAGMA legacy_alter_table = OFF;
PRAGMA foreign_keys = ON;
