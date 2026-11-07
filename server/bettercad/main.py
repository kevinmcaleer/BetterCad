"""App factory: /api routes, request logging, and the built web app with an index.html fallback."""

import asyncio
import html
import json
import logging
import subprocess
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from . import __version__, auth, db, jobs, models, printers, reports, stats
from .settings import Settings, get_settings

log = logging.getLogger("bettercad")

# The kernel (#4) needs cross-origin isolation for SharedArrayBuffer and WASM threads.
ISOLATION = {"Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp"}


def _version(settings: Settings) -> str:
    if settings.version:
        return settings.version
    try:
        sha = subprocess.run(["git", "rev-parse", "--short", "HEAD"], capture_output=True, text=True, timeout=2)
        if sha.returncode == 0 and sha.stdout.strip():
            return sha.stdout.strip()
    except (OSError, subprocess.SubprocessError):
        pass
    return __version__


class CachedStatic(StaticFiles):
    """Hashed assets are cached for a year; everything else is revalidated."""

    async def get_response(self, path: str, scope) -> Response:  # type: ignore[override]
        # The build writes a .br and a .gz beside large assets (#97); send the smallest the browser takes.
        accepts = dict(scope.get("headers", [])).get(b"accept-encoding", b"")
        encoding = None
        if path.startswith("assets/") and self.directory:
            for name, ext in (("br", ".br"), ("gzip", ".gz")):
                if name.encode() in accepts and (Path(self.directory) / f"{path}{ext}").is_file():
                    encoding = (name, ext)
                    break
        response = await super().get_response(f"{path}{encoding[1]}" if encoding else path, scope)
        if encoding:
            response.headers["Content-Encoding"] = encoding[0]
            response.headers["Vary"] = "Accept-Encoding"
            kind = {".wasm": "application/wasm", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8"}
            response.headers["Content-Type"] = next((v for k, v in kind.items() if path.endswith(k)), "application/octet-stream")
        if path.startswith("assets/"):
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        else:
            response.headers["Cache-Control"] = "no-cache"
        if path.endswith(".wasm"):
            response.headers["Content-Type"] = "application/wasm"
        return response


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    settings.check()
    version = _version(settings)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        conn = db.connect(settings.db_path)
        applied = db.migrate(conn)
        if applied:
            log.info("applied migrations %s", applied)
        app.state.db = conn
        app.state.blobs = models.BlobStore(settings.blob_dir)
        task = asyncio.create_task(jobs.run_daily(conn, settings)) if settings.jobs else None
        yield
        if task:
            task.cancel()
        conn.close()

    app = FastAPI(
        title="BetterCad",
        version=version,
        lifespan=lifespan,
        docs_url=None if settings.production else "/api/docs",
        openapi_url=None if settings.production else "/api/openapi.json",
    )

    if not settings.production:
        app.add_middleware(CORSMiddleware, allow_origins=settings.origins, allow_methods=["*"], allow_headers=["*"])

    @app.middleware("http")
    async def log_and_isolate(request: Request, call_next):
        start = time.perf_counter()
        response = await call_next(request)
        for k, v in ISOLATION.items():
            response.headers.setdefault(k, v)
        ms = (time.perf_counter() - start) * 1000
        log.info("%s %s %s %.1fms", request.method, request.url.path, response.status_code, ms)
        return response

    @app.get("/api/health")
    def health() -> dict:
        return {"ok": True, "version": version}

    app.include_router(auth.router(secure=settings.production))
    app.include_router(models.router(settings))
    app.include_router(printers.router())
    app.include_router(reports.router(settings))
    app.include_router(stats.router(settings))

    @app.api_route("/api/{rest:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"], include_in_schema=False)
    def api_not_found(rest: str) -> JSONResponse:
        return JSONResponse({"detail": "Not found"}, status_code=404)

    # A share link (#92) is /view/<token>: a page with Open Graph tags, so a pasted link previews in Discord and
    # Slack, that sends the browser on to the viewer at /#/view/<token>. kevsrobots.com may frame it (#93).
    @app.get("/view/{token}", include_in_schema=False)
    def view(token: str, request: Request) -> HTMLResponse:
        row = request.app.state.db.execute(
            "SELECT m.name, m.thumbnail, u.name AS owner FROM shares s JOIN models m ON m.id = s.model_id "
            "JOIN users u ON u.id = m.user_id WHERE s.token = ? AND m.deleted_at IS NULL",
            (token,),
        ).fetchone()
        base = str(request.base_url).rstrip("/")
        safe = html.escape(token, quote=True)
        js = json.dumps(token).replace("<", "\\u003c")
        title = html.escape(f"{row['name']} by {row['owner']} · BetterCad" if row else "BetterCad", quote=True)
        image = f'<meta property="og:image" content="{base}/api/shared/{safe}/thumbnail">' if row and row["thumbnail"] else ""
        page = f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><title>{title}</title>
<meta property="og:title" content="{title}"><meta property="og:type" content="website">
<meta property="og:description" content="A 3D model made in BetterCad. Open it to look around, measure and download.">
<meta property="og:url" content="{base}/view/{safe}">{image}<meta name="twitter:card" content="summary_large_image">
<meta http-equiv="refresh" content="0; url=/#/view/{safe}"></head>
<body><script>location.replace("/#/view/" + encodeURIComponent({js}));</script>
<a href="/#/view/{safe}">Open the model</a></body></html>"""
        return HTMLResponse(
            page,
            headers={
                "Cache-Control": "no-cache",
                "Content-Security-Policy": "frame-ancestors 'self' https://www.kevsrobots.com https://kevsrobots.com",
            },
        )

    dist: Path = settings.web_dist
    if dist.is_dir():
        index = dist / "index.html"
        static = CachedStatic(directory=dist, html=False)

        @app.get("/{path:path}", include_in_schema=False)
        async def web(path: str, request: Request) -> Response:
            file = (dist / path).resolve()
            if path and file.is_file() and dist.resolve() in file.parents:
                return await static.get_response(path, request.scope)
            return FileResponse(index, headers={"Cache-Control": "no-cache"})

    return app


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
app = create_app()
