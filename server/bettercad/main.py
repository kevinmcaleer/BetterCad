"""App factory: /api routes, request logging, and the built web app with an index.html fallback."""

import logging
import subprocess
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from . import __version__, db
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
        # The build writes a .gz beside large assets (the kernel WASM is 23 MB, 7 MB zipped); send it when we can.
        accepts = b"gzip" in dict(scope.get("headers", [])).get(b"accept-encoding", b"")
        zipped = accepts and path.startswith("assets/") and self.directory and (Path(self.directory) / f"{path}.gz").is_file()
        response = await super().get_response(f"{path}.gz" if zipped else path, scope)
        if zipped:
            response.headers["Content-Encoding"] = "gzip"
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
        yield
        conn.close()

    app = FastAPI(title="BetterCad", version=version, lifespan=lifespan, docs_url="/api/docs", openapi_url="/api/openapi.json")

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

    @app.api_route("/api/{rest:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
    def api_not_found(rest: str) -> JSONResponse:
        return JSONResponse({"detail": "Not found"}, status_code=404)

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
