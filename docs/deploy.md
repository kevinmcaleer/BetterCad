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

## Reverse proxy and TLS

The hostname is a placeholder: **`bettercad.kevsrobots.com`**. When Kev picks the real one (#21), search and replace it in `deploy/` and `docker-compose.yml`.

Use whichever proxy already fronts the Pi (the one markdown-studio sits behind):

- Caddy: [`deploy/Caddyfile`](../deploy/Caddyfile). Certificates are automatic.
- nginx: [`deploy/nginx.conf`](../deploy/nginx.conf), with `certbot --nginx -d <host>` for the certificate.

Both:

- forward to `127.0.0.1:8000` and pass `X-Forwarded-Proto` and `X-Forwarded-For` (uvicorn runs with `--proxy-headers`);
- allow request bodies of 60 MB, above `MAX_UPLOAD_MB` (50);
- set `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`, which the kernel needs (FastAPI sets them too);
- compress responses, including `.wasm`.

Steps once the name is chosen:

1. Add a DNS `A`/`AAAA` record (or a CNAME to the Pi's existing name) for the host.
2. Drop in the proxy block above and reload the proxy.
3. Check from outside the network: `curl https://<host>/api/health` returns `{"ok":true,...}`.

## Live preview

`.github/workflows/pages.yml` publishes the web app (no server) to GitHub Pages on every push to `main`. Turn it on once in Settings → Pages → Source: GitHub Actions.
