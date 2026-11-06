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

Until the first `v*` tag is released there is no published image; build it on the machine instead with
`docker compose up -d --build` from a checkout of the repository.

## Reverse proxy and TLS

The hostname is **`bettercad.kevsrobots.com`** (chosen by Kev, 6 November 2026). It is served through a Cloudflare Tunnel:

- Cloudflare Tunnel: [`deploy/cloudflared.yml`](../deploy/cloudflared.yml). Add the `bettercad.kevsrobots.com` ingress rule to the tunnel's config, pointing at `http://localhost:8000`, and restart `cloudflared` (or set the same public hostname in the Zero Trust dashboard for a remotely managed tunnel). Cloudflare issues and renews the certificate; there is no DNS record to add by hand beyond the tunnel's CNAME, which `cloudflared tunnel route dns <tunnel> bettercad.kevsrobots.com` creates.

If the machine is instead fronted by a proxy of its own:

- Caddy: [`deploy/Caddyfile`](../deploy/Caddyfile). Certificates are automatic.
- nginx: [`deploy/nginx.conf`](../deploy/nginx.conf), with `certbot --nginx -d <host>` for the certificate.

Whichever route you use:

- forward to `127.0.0.1:8000` and pass `X-Forwarded-Proto` and `X-Forwarded-For` (uvicorn runs with `--proxy-headers`);
- allow request bodies of 60 MB, above `MAX_UPLOAD_MB` (50);
- set `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`, which the kernel needs (FastAPI sets them too);
- compress responses, including `.wasm`.

Check from outside the network: `curl https://bettercad.kevsrobots.com/api/health` returns `{"ok":true,...}`, and
`curl -sI https://bettercad.kevsrobots.com/ | grep -i cross-origin` shows both COOP and COEP.

## Live preview

`.github/workflows/pages.yml` publishes the web app (no server) to GitHub Pages on every push to `main`. Turn it on once in Settings → Pages → Source: GitHub Actions.
