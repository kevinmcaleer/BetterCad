# Deploying

The image is `ghcr.io/kevinmcaleer/bettercad`, built for `linux/amd64` and `linux/arm64` by `.github/workflows/release.yml` when you push a `v*` tag.

On the Pi:

```sh
# once
mkdir -p ~/bettercad && cd ~/bettercad
curl -O https://raw.githubusercontent.com/kevinmcaleer/BetterCad/main/docker-compose.yml
echo "SECRET_KEY=$(openssl rand -hex 32)" > .env

# each update
docker compose pull && docker compose up -d
```

## Reverse proxy

Still to do (#21): pick the hostname (`bettercad.kevsrobots.com` is the placeholder) and copy the proxy block markdown-studio uses. The proxy must:

- forward to `127.0.0.1:8000` and pass `X-Forwarded-Proto` and `X-Forwarded-For`;
- allow request bodies of at least `MAX_UPLOAD_MB`;
- keep `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` (FastAPI sets them; the proxy must not strip them);
- compress `.wasm` responses (gzip or brotli).

## Live preview

`.github/workflows/pages.yml` publishes the web app (no server) to GitHub Pages on every push to `main`. Turn it on once in Settings → Pages → Source: GitHub Actions.
