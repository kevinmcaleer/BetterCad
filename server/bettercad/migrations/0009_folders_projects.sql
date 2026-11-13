-- Folders and projects (#273, #274; epic #271: projects hold folders). A project is a space for one build with a
-- readme and cover; folders sit inside a project or at the top of My models, and nest. A model lives in one place:
-- `folder_id` (whose project it shares) or `project_id` alone (the project's top level), or neither (My models).
-- Binning a folder or project bins everything inside it too, tagged `binned_by` with its id, so restoring it brings
-- back exactly that. Existing models land at the top level.
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  readme TEXT NOT NULL DEFAULT '',
  cover TEXT,
  created TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  modified TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  deleted_at TEXT
);
CREATE INDEX projects_user ON projects(user_id);

CREATE TABLE folders (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES folders(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  modified TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  deleted_at TEXT,
  binned_by TEXT
);
CREATE INDEX folders_user ON folders(user_id);
CREATE INDEX folders_parent ON folders(parent_id);

ALTER TABLE models ADD COLUMN folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL;
ALTER TABLE models ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE SET NULL;
ALTER TABLE models ADD COLUMN binned_by TEXT;
CREATE INDEX models_folder ON models(folder_id);
CREATE INDEX models_project ON models(project_id);
