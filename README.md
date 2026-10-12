# SWGOH Overlay

A self-hosted counter-lookup system for Star Wars: Galaxy of Heroes, made of
three pieces:

- **backend/** — Node.js/Express API + PostgreSQL. This is the "source of truth" —
  units, squads, counters, and cached roster data all live here, in your own
  Docker stack, same as Denflix/FORGE/PokeCard Tracker.
- **frontend/** — the web admin UI (React + Vite) for building counters and
  managing the units library. Mobile-first, so it works from your phone, and
  installable to the home screen. Served by the same container as the API.
- **android/** — the Android overlay app (floating bubble) that talks to the
  backend while you're in-game.

See `docs/ARCHITECTURE.md` for the full design rationale (this came out of a long
planning conversation — that doc is the record of every decision and why it was
made, so future-you doesn't have to re-derive it).

## Status

What's real and working:

- Full DB schema (units, squads, counters w/ pending→approved workflow, roster
  snapshots + normalized roster cache). The api container creates the tables
  itself on first start and applies later schema changes on every start
  (`backend/src/migrate.js`).
- Backend API: units CRUD + "import every unit from the game" via Comlink,
  counters CRUD + approve/reject, exact and best-match ("closest known team")
  counter lookup, ally-code roster pull via a self-hosted SWGoH Comlink
  instance, image upload for unit portraits
- Web admin UI: counters list/search (by name or initials, e.g. "SLKR"),
  counter editor (defense team + ranked counter squads with notes), units
  library (import from game, add/edit/delete, portraits), review queue
- docker-compose stack: Postgres + api (+ web UI) + Comlink
- Android app skeleton: launcher screen (Open Overlay / Settings), Settings
  screen (ally code, API URL, bubble position placeholder, Reset Squads), and
  the OverlayService with a working floating bubble + expandable panel shell

What's **stubbed / not yet built**:

- The Android app hasn't been built or run against the real backend yet
- The icon-matching engine itself (perceptual-hash comparison of cropped
  portraits against the units library) — `IconMatcher.kt` has the interface
  and a TODO where the real comparison goes
- Screen capture (MediaProjection) wiring to actually grab a screenshot from
  within the overlay service
- The bulk "Import Units from Screenshot" registration tool (portraits)

## Deploying (Dockge, published image)

Every push to `main` that touches the backend, frontend, db or Dockerfile runs
the tests and publishes `ghcr.io/dragoneat666/swgoh-overlay-backend:latest`.

1. In Dockge, create a stack and paste in `docker-compose.ghcr.yml`.
2. Set the env vars from `.env.example` in the stack's env editor —
   at minimum `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` and a long
   random `API_TOKEN`.
3. Deploy. Nothing else needs copying to the server.

To update later: pull the new image in Dockge and restart the `api` container.

## Using the web UI

Open `http://<server>:4001/` (or wherever your reverse proxy points at port
4001) and sign in with your `API_TOKEN`. The browser remembers it.

First time: go to **Units → Import from game** to load every character and
ship from the game's own data (takes a minute). Then add counters from the
**Counters** tab.

**On your phone:** open the same address over Netbird or your domain, then in
Chrome use **⋮ → Add to Home screen** — it opens full-screen like an app.

## Building from source

```bash
cp .env.example .env
# edit .env: set POSTGRES_PASSWORD and API_TOKEN to your own values
docker compose up -d --build
```

This starts three containers: `db` (Postgres), `comlink` (SWGoH Comlink, talks
to the game's own public API), and `api` (API + web UI, port 4001 by default).

Every `/api` request needs `Authorization: Bearer <API_TOKEN>`. Swap this for
real per-device tokens later if you end up sharing this with your friend —
noted in ARCHITECTURE.md.

## Local development (no Docker needed)

Needs Node 22+.

```bash
cd backend && npm install && npm run dev:db
```

That starts a throwaway Postgres (PGlite) on port 54329. In a second terminal:

```bash
cd backend
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54329/postgres PG_POOL_MAX=1 \
  API_TOKEN=dev UPLOAD_DIR=./uploads npm run dev
```

And for the web UI with hot reload (proxies `/api` to the backend on 4001):

```bash
cd frontend && npm install && npm run dev
```

## Tests

```bash
cd backend && npm test     # API tests against a real (in-process) Postgres + fake Comlink
cd frontend && npm test    # unit search logic
```

CI runs both before publishing the image.

## Quick start (Android)

Open `android/` in Android Studio. It's a plain-Kotlin, XML-layout project
(no Compose, no unusual Gradle plugins) to keep the initial build friction
low. Set the backend's URL and your ally code from the Settings screen once
it's installed on your phone.

## Repo layout

```
SWGOH-Overlay/
├── Dockerfile                 # one image: API + built web UI
├── docker-compose.yml         # build from source
├── docker-compose.ghcr.yml    # pull the published image (Dockge)
├── .env.example
├── backend/
│   ├── package.json
│   ├── scripts/dev-db.mjs     # local Postgres without Docker
│   ├── test/                  # API tests
│   └── src/
│       ├── index.js / app.js
│       ├── migrate.js         # creates/updates the schema on startup
│       ├── comlinkClient.js / unitImport.js
│       ├── squadHelpers.js
│       ├── middleware/auth.js
│       └── routes/ (units, counters, roster)
├── frontend/
│   ├── public/                # manifest + icons (home-screen install)
│   └── src/ (pages, components)
├── db/
│   └── init.sql
├── android/
│   └── app/src/main/java/club/denflix/swgohoverlay/
└── docs/
    └── ARCHITECTURE.md
```
