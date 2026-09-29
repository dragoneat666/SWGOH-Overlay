-- SWGOH Overlay schema
-- Runs automatically on first container start (see docker-compose.yml).

CREATE TABLE units (
    id              SERIAL PRIMARY KEY,
    definition_id   TEXT UNIQUE,        -- SWGoH's own internal unit id, once known (from Comlink game data / roster pulls); nullable because units can be registered by name before we've matched a definition_id
    name            TEXT NOT NULL UNIQUE,
    image_path      TEXT,               -- relative path under /app/uploads, identity-only cropped portrait
    is_ship         BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A "squad" is just an ordered list of units. Used for both defender squads
-- and recommended counter squads - same shape either way.
CREATE TABLE squads (
    id          SERIAL PRIMARY KEY,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE squad_members (
    squad_id    INTEGER NOT NULL REFERENCES squads(id) ON DELETE CASCADE,
    unit_id     INTEGER NOT NULL REFERENCES units(id) ON DELETE RESTRICT,
    position    SMALLINT NOT NULL,      -- 0 = leader
    PRIMARY KEY (squad_id, position)
);

CREATE INDEX idx_squad_members_unit ON squad_members(unit_id);

-- One counter entry = "this defender squad is countered by these attacker
-- squads, in this rank order."
CREATE TABLE counters (
    id              SERIAL PRIMARY KEY,
    defender_squad_id INTEGER NOT NULL REFERENCES squads(id) ON DELETE CASCADE,
    status          TEXT NOT NULL DEFAULT 'approved'
                        CHECK (status IN ('pending', 'approved', 'rejected')),
    source          TEXT NOT NULL DEFAULT 'manual'
                        CHECK (source IN ('manual', 'ocr', 'import')),
    submitted_by    TEXT,               -- free-text for now (your name / friend's name); revisit if this grows past a couple of trusted contributors
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    reviewed_at     TIMESTAMPTZ,
    reviewed_by     TEXT
);

CREATE TABLE counter_recommendations (
    id              SERIAL PRIMARY KEY,
    counter_id      INTEGER NOT NULL REFERENCES counters(id) ON DELETE CASCADE,
    counter_squad_id INTEGER NOT NULL REFERENCES squads(id) ON DELETE CASCADE,
    rank            SMALLINT NOT NULL,  -- 1 = best recommendation
    UNIQUE (counter_id, rank)
);

-- Full raw Comlink player payload, append-only, one row per pull. Never
-- overwritten - see docs/ARCHITECTURE.md on why we keep everything even if
-- unused today.
CREATE TABLE roster_snapshots (
    id          SERIAL PRIMARY KEY,
    ally_code   TEXT NOT NULL,
    fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    raw_json    JSONB NOT NULL
);

CREATE INDEX idx_roster_snapshots_ally_code ON roster_snapshots(ally_code, fetched_at DESC);

-- Normalized "current state" view, upserted from the latest snapshot.
-- Only the fields the app actually reads today live here as real columns;
-- anything else stays in roster_snapshots.raw_json until it's needed.
CREATE TABLE roster_units (
    ally_code           TEXT NOT NULL,
    unit_definition_id  TEXT NOT NULL,
    gear_tier           SMALLINT,
    relic_tier          SMALLINT,
    purchased_ability_ids TEXT[] NOT NULL DEFAULT '{}',
    last_snapshot_id    INTEGER REFERENCES roster_snapshots(id),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (ally_code, unit_definition_id)
);
