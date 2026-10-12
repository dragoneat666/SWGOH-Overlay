# Architecture & Decisions

This is the record of the planning conversation that produced this repo — what
was decided, and why — so it doesn't have to be re-derived later.

## What the app is

An Android floating-bubble overlay for SWGoH. While in a GAC match, you tap the
bubble, pick which of the 2-3 defending teams you're facing, and get back the
top 3 recommended counter squads — filtered against your own roster (pulled by
ally code) and against squads you've already committed to this GAC round.

## Data sourcing (the part that took the longest to settle)

- **swgoh.gg has no public API for counters or GAC data**, confirmed directly
  from a maintainer response on GitHub ("we don't have anything officially
  supported for this"). Their GAC counters pages are real, aggregated,
  win-rate-based data — curated from top guilds/leaderboards, per their own
  GAC report page — but it's rendered as HTML for humans, not exposed as data.
- Scraping swgoh.gg was considered and explicitly **ruled out** — their
  robots.txt disallows the season-filtered counter URLs, and their Terms of
  Service separately and explicitly prohibit automated access "by means of any
  robot, spider, scraper, crawler... for any purpose." Decision: don't do this,
  full stop ("that is their algorithm, so they earned it").
- **What we use instead**: the official (unauthenticated, public) game API via
  a self-hosted **SWGoH Comlink** instance. Given any ally code, this returns
  full roster data (units, gear tier, relic tier, purchased/ultimate abilities)
  with no login, no password, no account risk. This is the same mechanism
  swgoh.gg itself and most community Discord bots use.
- Comlink does **not** expose win-rate/counter data for arbitrary players (only
  your own account gets season summaries, not per-match outcomes) — so
  **counters are built and maintained manually**, not computed or scraped.
  This app's counters database is its own asset, seeded and grown by hand.

## Data model philosophy

- Store the **full raw JSON** from every Comlink roster pull, timestamped,
  append-only, never overwritten — even fields we don't use yet. This is
  cheap (self-hosted, small payloads) and means a future feature can be
  backfilled from history instead of needing to have been planned for in
  advance. Only build normalized/typed columns for fields actually in use
  today (gear tier, relic tier, purchased abilities) — don't over-build the
  normalized schema ahead of need.
- Units are intentionally minimal: **name + picture only**. No gear/level
  gating on counter recommendations — "this is the team, this is the
  recommended counter," full stop. Simpler data model, and matches how a
  human would actually reason about a counter.

## Portrait images & the matching engine

- No clean source for character portrait images exists (nobody publishes a
  usable API/CDN for them). Plan: grab them straight from the game's own
  in-game "Characters" collection screen (a complete, always-current catalog,
  several dozen icons per screenshot) — no swgoh.gg dependency needed at all.
- **Matching must ignore the variable parts of the icon**: the colored
  ring around a portrait reflects gear tier / relic tier / (for Galactic
  Legends) whether their ultimate is unlocked — none of that is part of a
  character's *identity*, and if left in, it would break icon matching (same
  character, different ring, looks like a different image). The fix: crop
  to an inner circle that excludes the ring, and mask out the corner
  level/relic badge, **before** hashing/comparing. One reference image per
  unit, not one per unit per gear tier.
- Matching itself: perceptual-hash comparison, not a trained ML model —
  portraits are exact rendered assets (not photos), so this is a much easier
  problem than general image recognition.
- **Display still shows the ring** — just reconstructed, not baked into the
  stored image. At render time: base portrait (stored, identity only) + a
  ring image (chosen from a small fixed set, based on the *viewer's own*
  ally-code roster data: `currentTier`, `relic.currentTier`,
  `purchasedAbilityId` — confirmed real Comlink fields) + a level/relic
  number (drawn as text, or if font-matching isn't good enough, composed
  from individually-cropped digit-glyph sprites 0-9 rather than one image
  per possible number). This only applies to *your own* recommended squads —
  the enemy team you're matching only ever needs identity, never their real
  gear state.
- The same crop-and-hash logic doubles as a **bulk unit registration tool**:
  upload a screenshot of the in-game collection grid, the backend crops each
  icon, tries to match it against known units, and asks you to name anything
  it doesn't recognize. This bootstraps the units library and is also how
  new character releases get added later — same tool, ongoing job.

## Counters QA workflow

- Manual entries (drag/search-built squads, entered by a trusted source i.e.
  you) save directly to the live table — no review step needed.
- Anything from an automated/OCR pipeline lands in a **pending** status and
  must be approved before it's visible to the overlay. `counters.status` and
  `counters.source` columns exist for exactly this ('manual' entries can be
  auto-approved; 'ocr' or future crowd-submitted entries require review).
- **One approved counter entry per defender team.** A second manual entry
  for the same team is refused (409, with the existing entry's id) so the
  overlay's answer is never ambiguous - add squads to the existing entry
  instead. Each entry holds ranked counter squads, each with optional notes
  ("kill Reva first"), stored on `counter_recommendations.notes`.

## Squad identity & matching

- A squad's identity is **its leader + its set of members**. Member order
  past the leader doesn't matter, but the leader does - the lead ability
  changes how a team plays, so "Vader lead" and "Sidious lead" with the same
  five units are different defense teams. Squads are shared, immutable rows:
  entering the same team again reuses the existing squad, and squads no
  counter points at any more are deleted after edits.
- Two lookups: `/api/counters/lookup` (exact team) and `/api/counters/match`
  ("best match"). Opponents often run a known team with one or two members
  swapped, so `match` scores every known defense team by member overlap plus
  a leader bonus and returns the closest ones with their counters. This is
  what the overlay should call once it can read the screen; it also works
  with just a leader ("every team led by X").

## Unit catalog

- Unit names + `definition_id`s come from the game's own data via Comlink
  (`POST /api/units/import-game-data`: `/metadata` for versions, `/data`
  segment 3 for the `units` collection, `/localization` for English names).
  Only obtainable, already-released units are kept, one per `baseId`. Safe to
  re-run whenever new units come out; a unit added by hand with the same
  name gets its `definition_id` attached instead of being duplicated.
- Comlink roster entries name units `BASEID:SEVEN_STAR` - the part before the
  colon is what matches `units.definition_id`.

## Web admin UI

- React + Vite, built into static files and **served by the api container**
  (one image, same origin - no CORS, nothing extra to deploy). Mobile-first
  and installable to the phone's home screen (web manifest + icons).
- Signs in with the same shared `API_TOKEN` the phone app uses, kept in the
  browser's localStorage. Good enough for you + one trusted friend; put
  Authentik in front of the UI's path if that ever changes (the `/api` path
  has to stay outside forward-auth, see below).

## Schema changes

- `db/init.sql` is the base schema. The api applies it itself when the
  database has no tables (so a Dockge stack doesn't need the file copied
  next to it), then runs the idempotent statements in
  `backend/src/migrate.js` on every startup. New columns/indexes go there,
  never as edits to an already-deployed `init.sql`.

## Auth & hosting

- Phone app never talks to Postgres directly — always through the backend
  API, same as your other self-hosted projects.
- API auth is a simple shared bearer token (env var), **independent of
  Authentik** — Authentik's forward-auth pattern expects a browser
  (redirect + cookie), which breaks a plain JSON API client. Authentik stays
  reserved for guarding a future browser-based admin panel (for when/if a
  friend gets access); the API itself should stay on its own path/subdomain,
  excluded from forward-auth, protected by its own token instead.
- Reachable two ways once this leaves local-only testing: your private
  Netbird network (no extra auth needed, the mesh network is the access
  control) or your public domain + the bearer token.

## Used-squad tracking (per GAC round)

- This is **client-side, local app state** — not stored server-side. It's a
  transient "what have I already committed to this round" list, not a fact
  about the world worth persisting centrally.
- Reset behavior: on app open, if more than 24h since last open, prompt
  "reset squad tracking?" rather than deciding silently. Also exposed as a
  manual "Reset Squads" button in Settings for any time you want to clear it
  early.

## Explicitly out of scope for now

- Live screen-capture-driven auto-detection of the enemy squad is the target
  end state, but the recommended build order is: manual/searchable team
  selection first (no CV needed, ships something usable immediately), then
  layer in automatic icon recognition once the matching engine (built for
  unit registration) has been proven out on real screenshots.
- No gear/level-aware filtering of counter recommendations (see above).
- No GAC-bracket-opponent live scouting (HotUtils/DSR-style real-account
  scouting) — deliberately avoided; that mechanism isn't something EA has
  ever endorsed, just long-tolerated, and ally-code-only access keeps this
  project entirely on the clean side of that line.
