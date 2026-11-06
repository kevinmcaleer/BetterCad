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
| `SECRET_KEY` | (none) | Signs sessions; required in production |
| `ALLOWED_ORIGINS` | `http://localhost:5173` | CORS origins in development, comma separated |
| `WEB_DIST` | `../web/dist` | The built web app to serve |
| `VERSION` | git sha | Reported by `/api/health` |

Migrations are numbered `.sql` files in `bettercad/migrations/`, applied on start and recorded in `schema_version`.
