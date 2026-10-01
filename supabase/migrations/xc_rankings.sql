-- Cross country polls and rankings, from the USTFCCCA.
--
-- Hand-written and additive, like the others here. Nothing existing is
-- touched.
--
-- The USTFCCCA publishes its coaches' polls (national) and rankings
-- (regional) weekly through a public read API. Nexus Online reads it once a
-- day, keeps every week it has seen, and matches each USTFCCCA team to one of
-- our organizations once, so every desk can ask "what is this school ranked"
-- by the organization it already knows.
--
--   ranking_teams    every team the USTFCCCA has ranked, and which of our
--                    organizations it is (when somebody, or the matcher,
--                    has said so)
--   ranking_lists    one released list: a season, gender, poll or regional
--                    ranking, division, region and week
--   ranking_entries  a team's place on one list
--   ranking_pulls    each read of the API, for the dashboard and for the
--                    ETag that makes an unchanged read cost nothing
--
-- A list is keyed the way the USTFCCCA asks a copy to be keyed: season,
-- gender, type, division, region and week. Their collection id is kept but
-- is a row id on their side, not a name.

BEGIN;

CREATE TABLE IF NOT EXISTS "ranking_teams" (
  -- The USTFCCCA's own team id: stable across seasons, and not an AthNET id.
  "ustfccca_team_id" integer PRIMARY KEY NOT NULL,

  "team_name" text NOT NULL,        -- full: "University of New Mexico"
  "team_short" text,                -- "New Mexico"
  "abbrev" text,
  "division_id" integer,
  "division" text,                  -- "NCAA DI"
  "conference" text,
  "region" text,
  -- The AthNET team id from the USTFCCCA's mapping. Null when they have none;
  -- they never guess it.
  "athnet_team_id" integer,

  -- Which of our organizations this is. Null until matched.
  "organization_id" uuid REFERENCES "organizations"("id") ON DELETE SET NULL,
  -- 'auto'      the matcher was sure
  -- 'confirmed' a person said so
  -- 'review'    the matcher had candidates but was not sure
  -- 'unmatched' nothing here looks like it
  -- 'ignored'   a person said it is none of ours
  "match_status" text DEFAULT 'unmatched' NOT NULL,
  -- How it was matched, or why it was not: for whoever reviews it.
  "match_note" text,
  "matched_at" timestamp with time zone,
  "matched_by" text,

  "first_seen_at" timestamp with time zone DEFAULT now(),
  "last_seen_at" timestamp with time zone DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_ranking_teams_org" ON "ranking_teams" ("organization_id");
CREATE INDEX IF NOT EXISTS "idx_ranking_teams_status" ON "ranking_teams" ("match_status");

CREATE TABLE IF NOT EXISTS "ranking_lists" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,

  "season" integer NOT NULL,
  "gender" text NOT NULL,           -- 'men' | 'women'
  -- 'national' (a poll, or a national ranking some divisions use instead)
  -- or 'regional'.
  "kind" text NOT NULL,
  "type_id" integer NOT NULL,       -- 6 poll, 19 national ranking, 10 regional
  "list_type" text,                 -- 'poll' | 'ranking', as sent
  "division_id" integer NOT NULL,
  "division_name" text,
  -- 0 for a national list, so the key below has no nulls in it.
  "region_id" integer DEFAULT 0 NOT NULL,
  "region_name" text,
  -- 0 preseason, 99 final, otherwise the numbered week.
  "week" integer NOT NULL,
  -- As sent: US Eastern local time, no zone.
  "release_date_et" text,
  -- The same moment, as a real timestamp.
  "released_at" timestamp with time zone,
  "collection_id" integer,

  "first_seen_at" timestamp with time zone DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_ranking_lists_key"
  ON "ranking_lists" ("season", "gender", "type_id", "division_id", "region_id", "week");
CREATE INDEX IF NOT EXISTS "idx_ranking_lists_released" ON "ranking_lists" ("released_at");

CREATE TABLE IF NOT EXISTS "ranking_entries" (
  "list_id" uuid NOT NULL REFERENCES "ranking_lists"("id") ON DELETE CASCADE,
  "ustfccca_team_id" integer NOT NULL REFERENCES "ranking_teams"("ustfccca_team_id") ON DELETE CASCADE,

  -- Order on the list as sent: ranked teams first, then receiving votes.
  "position" integer NOT NULL,
  -- Null for a team receiving votes, which then has is_rv true.
  "rank" integer,
  "is_rv" boolean DEFAULT false NOT NULL,
  "score" real,
  "first_place_votes" integer,
  -- Last week's rank. Their 999 sentinel ("receiving votes last week") is
  -- stored as null with prev_is_rv true.
  "prev_rank" integer,
  "prev_is_rv" boolean DEFAULT false NOT NULL,
  "rank_change" integer,
  -- As of this list's season.
  "conference" text,
  "region" text,

  PRIMARY KEY ("list_id", "ustfccca_team_id")
);

CREATE INDEX IF NOT EXISTS "idx_ranking_entries_team" ON "ranking_entries" ("ustfccca_team_id");

CREATE TABLE IF NOT EXISTS "ranking_pulls" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  -- 'cron' | 'manual'
  "trigger" text NOT NULL,
  -- 'ok' | 'unchanged' | 'failed'
  "status" text NOT NULL,
  "http_status" integer,
  "etag" text,
  "generated_at" timestamp with time zone,
  "season" integer,
  "lists_seen" integer DEFAULT 0,
  "lists_new" integer DEFAULT 0,
  "teams_seen" integer DEFAULT 0,
  "teams_new" integer DEFAULT 0,
  "auto_matched" integer DEFAULT 0,
  "error" text,
  "started_at" timestamp with time zone DEFAULT now(),
  "finished_at" timestamp with time zone
);

CREATE INDEX IF NOT EXISTS "idx_ranking_pulls_started" ON "ranking_pulls" ("started_at");

-- Closed to the public REST API like every other table here
-- (lock_down_public_tables.sql): the app reads through DATABASE_URL.
ALTER TABLE "ranking_teams" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ranking_lists" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ranking_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ranking_pulls" ENABLE ROW LEVEL SECURITY;

COMMIT;
