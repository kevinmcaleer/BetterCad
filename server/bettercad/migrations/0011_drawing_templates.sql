-- Drawing templates (#575): a person's sheet set-ups (page, standard, title block, logo, first views), kept as JSON
-- so the editor can add fields without a migration. Ids are made in the browser, so one made offline keeps its id.
CREATE TABLE drawing_templates (
  user_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  data TEXT NOT NULL,
  modified TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  PRIMARY KEY (user_id, id)
);
