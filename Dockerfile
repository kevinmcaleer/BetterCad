# One image for the Pi and for x86: build the web app with Node, serve it and the API with uvicorn.
FROM --platform=$BUILDPLATFORM node:22-alpine AS web
WORKDIR /src
COPY package.json package-lock.json ./
COPY web/package.json web/
COPY packages/ui/package.json packages/ui/
COPY packages/kernel/package.json packages/kernel/
COPY packages/sketch/package.json packages/sketch/
RUN npm ci
COPY . .
ARG VERSION=""
RUN VITE_VERSION=$VERSION npm run build

# powertools-auth (#88) comes from git, so the Python packages are installed in a stage that has git.
FROM python:3.13-slim AS py
ENV PYTHONDONTWRITEBYTECODE=1
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:0.11 /uv /usr/local/bin/uv
WORKDIR /app/server
COPY server/pyproject.toml server/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY server/ ./
RUN uv sync --frozen --no-dev

FROM python:3.13-slim AS app
ARG VERSION=""
ENV VERSION=$VERSION
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 ENV=production DATA_DIR=/data WEB_DIST=/app/web/dist
COPY --from=py /app/server /app/server
WORKDIR /app/server
COPY --from=web /src/web/dist /app/web/dist
RUN useradd --system --uid 10001 bettercad && mkdir -p /data && chown bettercad /data
USER bettercad
VOLUME ["/data"]
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health').status == 200 else 1)"
CMD ["/app/server/.venv/bin/uvicorn", "bettercad.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
