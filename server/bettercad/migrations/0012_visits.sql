-- Admin console: sign-in history. A visit is a spell of use with no gap of 30 minutes or more; `ended` moves on at
-- most every 5 minutes, so a busy account costs one small write per 5 minutes. `last_active` is the moment behind that,
-- and `email` is what kevsrobots.com last said, so the admin can tell people apart. Earlier days stay in `last_seen`.
ALTER TABLE accounts ADD COLUMN last_active TEXT;
ALTER TABLE accounts ADD COLUMN email TEXT;
CREATE TABLE visits (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  started TEXT NOT NULL,
  ended TEXT NOT NULL
);
CREATE INDEX visits_user ON visits(user_id, started);
