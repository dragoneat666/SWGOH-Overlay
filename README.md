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
  counter editor (defense team + counter squads with notes and stats),
  screenshot import (face recognition + OCR), "To identify" faces queue,
  units library (import from game, add/edit/delete, portraits)
- Counters ranked automatically from battle stats (win rate, sample size,
  average banners)
- docker-compose stack: Postgres + api (+ web UI) + Comlink
- Android overlay app: floating bubble, type the enemy team (names or
  initials) or **Scan screen** to read it off the GAC map, best-match counters
  from the server filtered by your roster and by units already used this round

What's **stubbed / not yet built**:

- The Android app has only been tested on an emulator (Android 16) against a
  local backend, not yet on a real phone with the game running
- Screen reading covers the GAC character map (opponent's defense squads);
  fleets and other game modes aren't read yet

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

Tabs:

- **Defense** - search the defense team you're facing to see the squads
  that beat it, best first (ranked from win rate and average banners).
- **Offense** - build an attack squad (leader + up to 4) and see which
  defense teams it beats and its win rate against each; below, the squads
  that counter the most defense teams in your data.
- **Import**, **Faces**, **Units** - see below.

First time: go to **Units → Import from game** to load every character and
ship from the game's own data (takes a minute). Then add counters with
**New counter** on the Defense tab, or:

**Import** - paste (Ctrl+V) or drop a screenshot of a swgoh.gg GAC counters
list (the rows between two ads). The app reads both squads and the Seen /
Win % / Avg ⚑ numbers, asks "who is this?" once for each face it doesn't
know yet (or parks them on the **Faces** list for later), and shows every
row for checking before saving. Counters are then ranked automatically
from their stats.

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

## Android app

Plain Kotlin + XML layouts (no Compose). Build with JDK 17 and the Android
SDK:

```bash
cd android
./gradlew testDebugUnitTest assembleDebug   # APK: app/build/outputs/apk/debug/app-debug.apk
```

First run on the phone: **Settings** → enter your ally code, the server URL
(`http://<netbird-ip>:4001` or your domain) and the API token → **Save & test
connection** (checks the server, the token, the units library and your
roster). Then **Open Overlay** and allow "Display over other apps".

In game (manual mode):

1. Tap the bubble (drag it anywhere - it remembers where).
2. Type an enemy unit - name or initials (`SLKR`, `JMK`) - and press ✓.
   The title bar shows which unit ✓ will add, since in landscape the
   keyboard covers the list. Keep typing more members; close the keyboard to
   see counters.
3. The closest saved defense team is shown with its counters, best first.
   Counters needing a unit you don't own, or a unit you already attacked
   with this round, are dimmed with the reason.
4. **Use** marks that squad used for the round (every unit in it). The panel's
   home view lists used squads, with **Reset round**.

Picks reset automatically if the panel has been closed for 90+ seconds.

Scanning the screen (GAC map, with the opponent's defense squads showing):

1. Open the panel → **Scan screen**. The first time per overlay session,
   Android asks to "Start recording or casting" - that's the app taking a
   one-off picture of the screen; nothing is recorded or kept on the phone.
2. Lit squads are read (darkened ones are already beaten and skipped). If
   two are on screen it asks which one you're attacking.
3. Faces it doesn't know yet show with its best guesses - tap the right one,
   or **Someone else…** to search. Each answer is saved to the face library,
   so the next scan knows that face.
4. Once every face is known you get the counters, exactly as in manual mode.

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
│       ├── counterQueries.js  # counter lookups shared by routes
│       └── routes/ (units, counters, portraits, scan, roster)
├── shared/scan/               # pixel code used by the web UI and the API
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
