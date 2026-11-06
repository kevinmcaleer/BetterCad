# Deploying

The image is `ghcr.io/kevinmcaleer/bettercad`, built for `linux/amd64` and `linux/arm64` by `.github/workflows/release.yml` when you push a `v*` tag.

On the Pi:

```sh
# once
mkdir -p ~/bettercad && cd ~/bettercad
curl -O https://raw.githubusercontent.com/kevinmcaleer/BetterCad/main/docker-compose.yml
curl -O https://raw.githubusercontent.com/kevinmcaleer/BetterCad/main/.env.example
cp .env.example .env    # set SECRET_KEY, e.g. openssl rand -hex 32; every other setting is explained in the file

# each update
docker compose pull && docker compose up -d
```

Until the first `v*` tag is released there is no published image; build it on the machine instead with
`docker compose up -d --build` from a checkout of the repository.

## Cloudflare Tunnel

`docker compose up -d` starts two containers: the app, and `cloudflared`, which connects to Cloudflare and serves
**`bettercad.kevsrobots.com`** (chosen by Kev, 6 November 2026). They talk over the project's own Docker network,
so no port is opened on the machine. Cloudflare issues and renews the certificate.

Once:

1. In Zero Trust → Networks → Tunnels, open the tunnel (or create one, type Cloudflared).
2. Copy its token: Configure, then the long string after `--token` in the install command.
3. Under Public Hostname, add `bettercad.kevsrobots.com` → Service `HTTP` → URL `bettercad:8000`.
4. In `.env`, set `CLOUDFLARE_TUNNEL_TOKEN=<token>` (and keep `COMPOSE_PROFILES=tunnel`).

The token only works for a tunnel managed from the dashboard. A tunnel made with `cloudflared tunnel create` and a
local `config.yml` is managed locally instead: migrate it in the dashboard (Tunnels → the tunnel → Migrate), or
make a new one there.

To run the app without the tunnel, remove `COMPOSE_PROFILES=tunnel` from `.env`.

### Reaching it locally

Nothing is published on the host. For a quick look on the machine itself, add a `docker-compose.override.yml`
(git ignores it) with:

```yaml
services:
  bettercad:
    ports:
      - "127.0.0.1:8010:8000"
```

## Another proxy instead of the tunnel

If the machine is fronted by a proxy of its own, drop the tunnel profile, publish the port as above, and use:

- Caddy: [`deploy/Caddyfile`](../deploy/Caddyfile). Certificates are automatic.
- nginx: [`deploy/nginx.conf`](../deploy/nginx.conf), with `certbot --nginx -d <host>` for the certificate.

Whichever route you use:

- forward to `127.0.0.1:8010` and pass `X-Forwarded-Proto` and `X-Forwarded-For` (uvicorn runs with `--proxy-headers`);
- allow request bodies of 60 MB, above `MAX_UPLOAD_MB` (50);
- set `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`, which the kernel needs (FastAPI sets them too);
- compress responses, including `.wasm`.

Check from outside the network: `curl https://bettercad.kevsrobots.com/api/health` returns `{"ok":true,...}`, and
`curl -sI https://bettercad.kevsrobots.com/ | grep -i cross-origin` shows both COOP and COEP.

## Live preview

`.github/workflows/pages.yml` publishes the web app (no server) to GitHub Pages on every push to `main`. Turn it on once in Settings → Pages → Source: GitHub Actions.
