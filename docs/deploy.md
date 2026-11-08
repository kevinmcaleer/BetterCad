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
4. In `.env`, set `CLOUDFLARE_TUNNEL_TOKEN=<token>`.

The token only works for a tunnel managed from the dashboard. A tunnel made with `cloudflared tunnel create` and a
local `config.yml` is managed locally instead: migrate it in the dashboard (Tunnels → the tunnel → Migrate), or
make a new one there.

To run the app without the tunnel: `docker compose up -d bettercad`.

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

If the machine is fronted by a proxy of its own, start only the app (`docker compose up -d bettercad`), publish the port as above, and use:

- Caddy: [`deploy/Caddyfile`](../deploy/Caddyfile). Certificates are automatic.
- nginx: [`deploy/nginx.conf`](../deploy/nginx.conf), with `certbot --nginx -d <host>` for the certificate.

Whichever route you use:

- forward to `127.0.0.1:8010` and pass `X-Forwarded-Proto` and `X-Forwarded-For` (uvicorn runs with `--proxy-headers`);
- allow request bodies of 60 MB, above `MAX_UPLOAD_MB` (50), the largest single save;
- set `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`, which the kernel needs (FastAPI sets them too);
- compress responses, including `.wasm`.

Check from outside the network: `curl https://bettercad.kevsrobots.com/api/health` returns `{"ok":true,...}`, and
`curl -sI https://bettercad.kevsrobots.com/ | grep -i cross-origin` shows both COOP and COEP.

## Signing in with kevsrobots.com

People sign in with their kevsrobots.com account, kept by Chatter (docs/accounts.md). docker-compose sets
`COOKIE_DOMAIN=.kevsrobots.com` and `CHATTER_URL=https://chatter.kevsrobots.com`, so nothing needs adding to `.env`.
The server checks each sign-in with Chatter. By default it goes to `https://chatter.kevsrobots.com`, through
Cloudflare, which can refuse server-to-server calls: the log then says `kevsrobots.com answered 530` (or 403) and the
sign-in page says kevsrobots.com can't be reached. When Chatter runs on the same machine, set `CHATTER_API_URL` in
`.env` to Chatter's address from inside the BetterCad container, such as `http://172.17.0.1:<Chatter's host port>`,
and `docker compose up -d`. Check it with
`docker compose exec bettercad python -c "import urllib.request as u; u.urlopen('$CHATTER_API_URL/accounts/me')"`,
which should fail with 401 Unauthorized.

Account ids are kevsrobots.com user ids, so accounts made with an earlier sign-in can't carry over by id. On the
first start they are set aside instead: their models, versions, share links and files stay, share links keep working,
and nobody can sign in to them. To take yours back, sign in to BetterCad once with kevsrobots.com, then run

```sh
docker compose exec bettercad python -m bettercad.accounts                     # lists set-aside accounts
docker compose exec bettercad python -m bettercad.accounts claim Kevin kevsrobots_username
```

which moves everything from the old account `Kevin` onto your kevsrobots.com account.

## Backups

Each night at 03:00 UTC the server copies the database (SQLite's online backup, safe while it runs) and the imported
files into `BACKUP_DIR/<date>/`, and removes folders older than `BACKUP_DAYS` (14). docker-compose mounts
`BACKUP_PATH` from `.env` (default `./backups` beside the compose file) there; point it at a USB disk or a synced
folder to keep a copy off the machine. The app runs as user 10001, so make the folder writable once:
`mkdir -p backups && sudo chown 10001 backups`.

To restore: stop the app, copy `<date>/bettercad.db` over the volume's `bettercad.db` (and `<date>/blobs/` over
`blobs/`), and start it again:

```sh
docker compose stop bettercad
docker run --rm -v bettercad_bettercad-data:/data -v "$PWD/backups:/backups" alpine \
  sh -c 'cp /backups/2026-11-07/bettercad.db /data/ && rm -f /data/bettercad.db-wal /data/bettercad.db-shm && cp -r /backups/2026-11-07/blobs /data/'
docker compose start bettercad
```

## Problem reports

Help → Report a problem sends a note, the browser and version, the last error, the last 20 edits (ids and types only)
and, if the person ticks it, the model. The server keeps each one in `DATA_DIR/reports/<id>/` (five per IP per hour,
2 MB at most) and, when `.env` sets them, emails it (`REPORT_EMAIL` and `SMTP_*`) or files it as an issue
(`GITHUB_REPORT_TOKEN`, `GITHUB_REPORT_REPO`). Use a private repository: a report can hold someone's model. If the
server can't be reached, the dialog offers the same report as a zip to download.

## Page counts

The app pings `POST /api/ping` once per page per browser session, and the server adds one to that page's count for the
day (`page_counts` in SQLite). No cookie, IP address, user agent or account is stored with it; the privacy page says
so. To read the counts, list your account's email in `STATS_EMAILS` in `.env`, sign in, and open
`/api/stats?days=30`.

## Live preview

`.github/workflows/pages.yml` publishes the web app (no server) to GitHub Pages on every push to `main`. Turn it on once in Settings → Pages → Source: GitHub Actions.
