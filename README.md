# SWGOH Overlay

A self-hosted counter-lookup system for Star Wars: Galaxy of Heroes, made of two
pieces:

- **backend/** — Node.js/Express API + PostgreSQL. This is the "source of truth" —
  units, squads, counters, and cached roster data all live here, in your own
  Docker stack, same as Denflix/FORGE/PokeCard Tracker.
- **android/** — the Android overlay app (floating bubble) that talks to the
  backend while you're in-game.

See `docs/ARCHITECTURE.md` for the full design rationale (this came out of a long
planning conversation — that doc is the record of every decision and why it was
made, so future-you doesn't have to re-derive it).

## Status

This is a first coding pass, not a finished app. What's real and working:

- Full DB schema (units, squads, counters w/ pending→approved workflow, roster
  snapshots + normalized roster cache)
- Backend API: units CRUD, counters CRUD + approve/reject, ally-code roster
  pull via a self-hosted SWGoH Comlink instance, image upload for unit portraits
- docker-compose stack: Postgres + backend + Comlink, ready to `docker compose up`
- Android app skeleton: launcher screen (Open Overlay / Settings), Settings
  screen (ally code, API URL, bubble position placeholder, Reset Squads), and
  the OverlayService with a working floating bubble + expandable panel shell

What's **stubbed / not yet built** — this is the next chunk of work, and it's
the hardest part on purpose (better to get the foundation solid first):

- The icon-matching engine itself (perceptual-hash comparison of cropped
  portraits against the units library) — `IconMatcher.kt` has the interface
  and a TODO where the real comparison goes
- Screen capture (MediaProjection) wiring to actually grab a screenshot from
  within the overlay service
- The bulk "Import Units from Screenshot" registration tool in the admin side
- The admin frontend UI itself (right now, unit/counter entry has to go
  through the raw API — a proper React admin panel is the next piece, same
  stack as PokeCard Tracker's frontend)

## Quick start (backend)

```bash
cp .env.example .env
# edit .env: set POSTGRES_PASSWORD and API_TOKEN to your own values
docker compose up -d --build
```

This starts three containers: `db` (Postgres), `comlink` (SWGoH Comlink, talks
to the game's own public API), and `api` (this backend, port 4001 by default).

Every request to the API needs `Authorization: Bearer <API_TOKEN>` (the value
you set in `.env`). Swap this for real per-device tokens later if you end up
sharing this with your friend — noted in ARCHITECTURE.md.

## Quick start (Android)

Open `android/` in Android Studio. It's a plain-Kotlin, XML-layout project
(no Compose, no unusual Gradle plugins) to keep the initial build friction
low. Set the backend's URL and your ally code from the Settings screen once
it's installed on your phone.

## Repo layout

```
SWGOH-Overlay/
├── docker-compose.yml
├── .env.example
├── backend/
│   ├── Dockerfile
│   ├── package.json
│   └── src/
│       ├── index.js
│       ├── db.js
│       ├── comlinkClient.js
│       ├── middleware/auth.js
│       └── routes/ (units, squads, counters, roster)
├── db/
│   └── init.sql
├── android/
│   └── app/src/main/java/club/denflix/swgohoverlay/
└── docs/
    └── ARCHITECTURE.md
```
