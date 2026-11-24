-- Electronics part libraries (#629): each person's own components, one document per account, kept as JSON the editor
-- owns (a library pack and the ids removed from it), so the editor can add fields without a migration.
CREATE TABLE part_libraries (
  user_id INTEGER PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  modified TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
);
