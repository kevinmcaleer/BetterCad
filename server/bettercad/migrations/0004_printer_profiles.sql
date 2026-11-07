-- Printer profiles (#180): a person's printers with their bed, hole offset and fit gaps, kept as JSON so the
-- editor can add fields without a migration. Ids are made in the browser, so a profile made offline keeps its id.
CREATE TABLE printer_profiles (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  data TEXT NOT NULL,
  modified TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  PRIMARY KEY (user_id, id)
);
