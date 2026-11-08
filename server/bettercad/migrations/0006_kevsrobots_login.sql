-- Sign-in moves to kevsrobots.com accounts (#88): powertools-auth's tables and the stand-in's leftovers go. `accounts`
-- stays, now keyed by the kevsrobots.com user id (accounts.set_aside moves older ones out of the way).
DROP TABLE IF EXISTS password_resets;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS legacy_logins;
DROP TABLE IF EXISTS schema_migrations;
