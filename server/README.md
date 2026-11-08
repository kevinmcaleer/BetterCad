# BetterCad server

A thin FastAPI app. It stores accounts and saved models (epic #9) and serves the built web app. Geometry never needs it: the editor and kernel run in the browser.

```sh
uv sync
uv run uvicorn bettercad.main:app --reload   # http://127.0.0.1:8000/api/health
uv run pytest --cov=bettercad
uv run ruff check . && uv run ruff format --check .
```

| Variable | Default | What it does |
| --- | --- | --- |
| `ENV` | `development` | `production` turns off CORS and requires `SECRET_KEY` |
| `DATA_DIR` | `data` | Where the database and uploads live |
| `DATABASE_PATH` | `$DATA_DIR/bettercad.db` | SQLite file (WAL mode) |
| `MAX_UPLOAD_MB` | `50` | Largest saved model |
| `USER_QUOTA_MB` | `500` | Storage per account: models, versions and imported files |
| `BACKUP_DIR` | (none) | Where the nightly backup goes; unset means none |
| `BACKUP_DAYS` | `14` | How many daily backups to keep |
| `SECRET_KEY` | (none) | Signs sessions; required in production |
| `ALLOWED_ORIGINS` | `http://localhost:5173` | CORS origins in development, comma separated |
| `WEB_DIST` | `../web/dist` | The built web app to serve |
| `VERSION` | git sha | Reported by `/api/health` |

Migrations are numbered `.sql` files in `bettercad/migrations/`, applied on start and recorded in `schema_version`.

## API

Interactive docs are at `/api/docs` in development. Everything under `/api/models`, `/api/blobs`, `/api/me` and `/api/account`
needs the kevsrobots.com `access_token` cookie, and every change needs the `X-CSRF-Token` header from `/api/auth/session`. Another account's ids answer
404.

| Route | Does |
| --- | --- |
| `GET /api/auth/session?next=`, `POST /api/auth/logout` | Who is signed in (kevsrobots.com, via Chatter), the CSRF token and kevsrobots.com's sign-in links; sign out (`auth.py`, #88) |
| `GET`, `PATCH`, `DELETE /api/account` | The signed-in account: theme; delete your BetterCad data |
| `GET /api/models?q=&sort=modified\|name&bin=&limit=&offset=` | My models, newest first |
| `POST /api/models` | A new model with its first version: `{name, bcad, note?}` |
| `GET`, `PUT`, `PATCH`, `DELETE /api/models/{id}` | Latest version; save a new one (`If-Match: <version>`, 409 if it moved on); rename; to the bin (`?forever=true` deletes) |
| `POST /api/models/{id}/duplicate`, `/restore` | "Name copy"; out of the bin |
| `GET /api/models/{id}/versions[/{n}]`, `PATCH .../{n}`, `POST .../{n}/restore` | History, a note, restore as a new version |
| `GET /api/models/{id}/thumbnail` | The latest picture, from the `.bcad` |
| `POST`, `DELETE /api/models/{id}/share`; `GET /api/shared/{token}` | View-only links, no session needed to read |
| `PUT`, `GET`, `HEAD /api/blobs/{hash}` | Imported files, stored once per account |
| `GET /api/me/usage` | `{models, bytes, quota}` |

Every save is a version. Each night (03:00 UTC) the server keeps every version from the last 30 days and the newest
10 older ones (never the latest or a shared one), empties bin entries older than 30 days, and backs up.
