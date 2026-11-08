-- Sign-in moves to kevsrobots.com accounts (#88): powertools-auth's tables and the stand-in's leftovers go. `accounts`
-- stays, now keyed by the kevsrobots.com user id (auth.check_auth_source refuses to mix the two).
DROP TABLE IF EXISTS password_resets;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS legacy_logins;
DROP TABLE IF EXISTS schema_migrations;
