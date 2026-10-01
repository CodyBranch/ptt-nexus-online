-- Athlete headshots, kept once and found again by school, season and name.
--
-- Hand-written and additive. Nothing existing is touched.
--
-- Fetching a meet's headshots means finding every school's roster site,
-- downloading the photos and cutting each one out: an evening's work for one
-- meet. Kept here, the next meet with the same schools asks for them instead.
--
-- A headshot is keyed by the school (an organization), the season and the
-- runner's name - not a TFRRS or results-service id, which an entry file does
-- not reliably carry and which changes when a runner transfers. Two runners
-- with the same name on one team in one season are rare; the unique key makes
-- the second one a conflict to look at rather than a silent overwrite.
--
-- The files live in the Headshots storage bucket:
--   {season}/cutouts/{school}/{last-first}-{hash}.webp    background removed
--   {season}/originals/{school}/{last-first}-{hash}.jpg   as downloaded
-- The hash is the file's own, so a replaced photo gets a new address and no
-- cache anywhere keeps showing the old face.

BEGIN;

CREATE TABLE IF NOT EXISTS "athlete_headshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,

  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  -- The cross country season by its fall year: 2026 for 2026-27.
  "season" integer NOT NULL,
  "first_name" text NOT NULL,
  "last_name" text NOT NULL,
  -- "last|first", letters only, lower case, accents off: what a name is
  -- matched on, so "O'Brien" and "OBrien", "José" and "Jose" are one runner.
  "name_key" text NOT NULL,
  -- 'M' | 'F', when known.
  "gender" text,
  -- FR, SO, JR, SR, GR - as the meet or the roster had it.
  "class_year" text,

  -- Where it came from: the roster page, the site's own player id, and the
  -- photo's address there.
  "roster_url" text,
  "roster_player_id" text,
  "photo_source_url" text,

  -- Paths in the Headshots bucket.
  "cutout_path" text,
  "original_path" text,
  "width" integer,
  "height" integer,
  "bytes" integer,
  "sha256" text,

  -- 'ok' | 'review' (the cutter flagged something worth a look) | 'hidden'
  -- (a person said not to use it).
  "status" text DEFAULT 'ok' NOT NULL,
  -- What the cutter flagged, in words: "photo is narrower than the mold".
  "review" text[] DEFAULT '{}' NOT NULL,

  "fetched_at" timestamp with time zone,
  "uploaded_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_athlete_headshots_key"
  ON "athlete_headshots" ("organization_id", "season", "name_key");
CREATE INDEX IF NOT EXISTS "idx_athlete_headshots_season" ON "athlete_headshots" ("season", "organization_id");

-- Closed to the public REST API like every other table here; the app reads
-- through DATABASE_URL.
ALTER TABLE "athlete_headshots" ENABLE ROW LEVEL SECURITY;

COMMIT;
