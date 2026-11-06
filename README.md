# BetterCad

[![CI](https://github.com/kevinmcaleer/BetterCad/actions/workflows/ci.yml/badge.svg)](https://github.com/kevinmcaleer/BetterCad/actions/workflows/ci.yml)

## What it is

BetterCad is a free CAD tool for 3D printing that runs in your browser. Draw a sketch, constrain and dimension it the way Fusion 360 does, then extrude it. Or push, pull and combine shapes the way Tinkercad does. Save to your computer, or sign in and save to your account. It is made for kevsrobots makers first, and for anyone who has only used Tinkercad.

It is early. Right now you get the editor's frame: the top bar, the panels, the tool bars, three themes, the command palette and the keyboard shortcuts. The 3D view, the kernel and sketching arrive with the next epics.

## Run it

You need Node 22 and [uv](https://docs.astral.sh/uv/).

```sh
make install   # npm install + uv sync
make dev       # API on :8000, editor on http://localhost:5173
```

`make test`, `make lint`, `make typecheck`, `make build` and `npm run e2e` do what they say.

With Docker, on a Raspberry Pi or anywhere else:

```sh
cp .env.example .env   # then set SECRET_KEY (openssl rand -hex 32); the file explains each setting
docker compose up -d   # app plus the Cloudflare Tunnel; see docs/deploy.md
```

## Repo layout

| Folder | What lives there |
| --- | --- |
| `web/` | The React app: editor shell, command palette, component gallery (`#/gallery`) |
| `packages/ui` | The design system in code: tokens, component CSS, icons, React components |
| `packages/kernel` | The OpenCascade kernel in a Web Worker (epic #4) |
| `packages/sketch` | The planegcs sketch solver (epic #5) |
| `server/` | FastAPI + SQLite: accounts and saved models (epic #9), and the built app |

## Architecture

Everything that touches geometry runs in your browser: the editor, the OpenCascade kernel (WASM, in a worker) and the sketch solver. Nothing needs an account, and it keeps working offline. The server only stores accounts and the models you choose to save there, so it never sees your geometry unless you save to the cloud.

## Licences

BetterCad's own code is MIT (see [LICENSE](LICENSE)). It will ship OpenCascade (LGPL 2.1 with the OCCT exception), planegcs (LGPL 2.1) and three.js (MIT). LGPL libraries are fine in a free web app as long as they stay separate, replaceable files and their source stays available; we load their WASM builds unmodified. Details in [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).

## Design system

Colours, type, spacing, components and the brand book live in the [BetterCad design system](https://claude.ai/artifact/MfEzeMVbydgaztQzHAHKTN). `packages/ui` is generated from it; see its README to re-sync.

## Contributing

The build plan is the [epics](https://github.com/kevinmcaleer/BetterCad/issues?q=label%3Aepic). Read [CLAUDE.md](CLAUDE.md) for the conventions, run `make lint test` before you push, and keep UI text in the brand book's voice.
