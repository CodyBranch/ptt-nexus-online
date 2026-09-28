-- Venues, courses and meet series; records that know where and at what level
-- they were set; and a history that can put any old record back.
--
-- Written by hand, like xc_declarations.sql: this database has no drizzle
-- migration history, so this is the delta and only the delta. Safe to run
-- twice. Checked against production before writing (Postgres 17.6; one record
-- set, no records, no history — nothing here has data to carry).
--
-- What it is for:
--   * A course is set up once at its venue and pulled into every meet there,
--     instead of re-entering the trace, difficulty and split points each time.
--   * Venue records are records pinned to a course. Meet records belong to a
--     meet series (Gans Creek Classic College and Gans Creek Classic HS are
--     two). Race records (Gold, Blue, Open) are a division inside the series.
--   * Every record carries a level, so a college 5K is never a high school
--     5K record even on the same course in the same set.
--   * A pushed record goes live at once. Every change is logged with the
--     record as it was before and after, and any of them can be reverted.

BEGIN;

-- ── Venues ─────────────────────────────────────────────────────────────────
-- The place: a cross country park, a track facility. For track the venue is
-- the facility and its records carry no course.
CREATE TABLE IF NOT EXISTS "venues" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "city" text,
  "state" text,
  "country" text DEFAULT 'USA',
  "organization_id" uuid REFERENCES "public"."organizations"("id"),
  -- 'outdoor' | 'indoor' | NULL (both, or not a track)
  "setting" text,
  "notes" text,
  "is_active" boolean DEFAULT true,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_venues_name" ON "venues" USING btree (lower("name"));

-- ── Courses ────────────────────────────────────────────────────────────────
-- One layout at a venue. A reroute is a new row pointing at the one it
-- replaced (replaces_course_id), and the old row is retired rather than
-- edited, so records set on the old layout still say which layout that was.
CREATE TABLE IF NOT EXISTS "courses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "venue_id" uuid NOT NULL REFERENCES "public"."venues"("id") ON DELETE cascade,
  "name" text NOT NULL,
  "distance_meters" real NOT NULL,
  -- The map trace as KML, and the elevation profile built from it
  -- ([{lon,lat,elevation,distanceMeters}]).
  "kml" text,
  "profile_json" jsonb,
  "total_gain_meters" real,
  "total_loss_meters" real,
  -- [{fromMeters,toMeters,difficulty,gainMeters,lossMeters,surface,notes}]
  "difficulty_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
  -- [{label,distanceMeters}]: where the split points usually are.
  "split_points_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "notes" text,
  -- Bumped on every change; a desk pushing an edit says which revision it
  -- started from, and is told when someone else changed it first.
  "revision" integer DEFAULT 1 NOT NULL,
  "replaces_course_id" uuid REFERENCES "public"."courses"("id"),
  "is_active" boolean DEFAULT true,
  "updated_by_key_id" uuid,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_courses_venue" ON "courses" USING btree ("venue_id");

-- ── Course ratings, logged ─────────────────────────────────────────────────
-- How hard each stretch of a course is: what a desk turns split times into
-- predictions with. Re-rated as the history grows, so every set of ratings a
-- course has had is kept, when and from which meet, and any can be put back.
CREATE TABLE IF NOT EXISTS "course_rating_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "course_id" uuid NOT NULL REFERENCES "public"."courses"("id") ON DELETE cascade,
  -- The ratings as they became: [{fromMeters,toMeters,difficulty,...}].
  -- Empty = the ratings were cleared.
  "difficulty_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "segment_count" integer DEFAULT 0 NOT NULL,
  -- 'saved' | 'restored'
  "change_kind" text DEFAULT 'saved' NOT NULL,
  "meet_name" text,
  "changed_by" text,
  "desktop_key_id" uuid,
  "restored_from_id" uuid REFERENCES "public"."course_rating_log"("id"),
  "created_at" timestamp with time zone DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_course_rating_log" ON "course_rating_log" USING btree ("course_id", "created_at");

-- ── Meet series ────────────────────────────────────────────────────────────
-- A meet as it comes round each year. What meet records belong to.
CREATE TABLE IF NOT EXISTS "meet_series" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "venue_id" uuid REFERENCES "public"."venues"("id"),
  "organization_id" uuid REFERENCES "public"."organizations"("id"),
  -- 'high_school' | 'college' | 'middle_school' | 'youth' | 'open' | NULL
  "level" text,
  "notes" text,
  "is_active" boolean DEFAULT true,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_meet_series_name" ON "meet_series" USING btree (lower("name"));

-- ── Record sets: what they are anchored to ────────────────────────────────
ALTER TABLE "record_sets" ADD COLUMN IF NOT EXISTS "venue_id" uuid REFERENCES "public"."venues"("id");
ALTER TABLE "record_sets" ADD COLUMN IF NOT EXISTS "meet_series_id" uuid REFERENCES "public"."meet_series"("id");
CREATE INDEX IF NOT EXISTS "idx_record_sets_venue" ON "record_sets" USING btree ("venue_id");
CREATE INDEX IF NOT EXISTS "idx_record_sets_series" ON "record_sets" USING btree ("meet_series_id");

-- ── Records: course, level, division, tied holders, revision ──────────────
ALTER TABLE "records" ADD COLUMN IF NOT EXISTS "course_id" uuid REFERENCES "public"."courses"("id");
ALTER TABLE "records" ADD COLUMN IF NOT EXISTS "level" text;
ALTER TABLE "records" ADD COLUMN IF NOT EXISTS "division_key" text;
-- 1 for the record; 2, 3… for anyone who tied it.
ALTER TABLE "records" ADD COLUMN IF NOT EXISTS "holder_no" integer DEFAULT 1 NOT NULL;
ALTER TABLE "records" ADD COLUMN IF NOT EXISTS "revision" integer DEFAULT 1 NOT NULL;
-- Set when the record was carried over from a layout that was replaced.
ALTER TABLE "records" ADD COLUMN IF NOT EXISTS "carried_from_course_id" uuid REFERENCES "public"."courses"("id");
CREATE INDEX IF NOT EXISTS "idx_records_course" ON "records" USING btree ("course_id");
CREATE INDEX IF NOT EXISTS "idx_records_updated" ON "records" USING btree ("updated_at");

-- One record per set, event, gender, course, level, division and holder.
-- NULLS NOT DISTINCT: a record with no course is one record, not one per NULL.
DROP INDEX IF EXISTS "idx_records_unique";
DO $$ BEGIN
  ALTER TABLE "records" ADD CONSTRAINT "records_key_unique"
    UNIQUE NULLS NOT DISTINCT ("record_set_id","event_code","gender","course_id","level","division_key","holder_no");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

-- ── Record splits ──────────────────────────────────────────────────────────
-- The holder's splits, keyed by distance (split names change year to year;
-- the distance is what stays). Track laps fit the same shape.
CREATE TABLE IF NOT EXISTS "record_splits" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "record_id" uuid NOT NULL REFERENCES "public"."records"("id") ON DELETE cascade,
  "distance_meters" real NOT NULL,
  "label" text,
  "seconds" real NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_record_splits_key" ON "record_splits" USING btree ("record_id","distance_meters");

-- ── Record history: every change, revertible ──────────────────────────────
-- A deleted record must keep its history, or the delete could not be undone:
-- the link to the record is dropped instead of the row.
ALTER TABLE "record_history" DROP CONSTRAINT IF EXISTS "record_history_record_id_records_id_fk";
ALTER TABLE "record_history" ALTER COLUMN "record_id" DROP NOT NULL;
DO $$ BEGIN
  ALTER TABLE "record_history" ADD CONSTRAINT "record_history_record_id_records_id_fk"
    FOREIGN KEY ("record_id") REFERENCES "public"."records"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- The old columns described only "broken"; a creation has no previous mark
-- and a deletion no new one.
ALTER TABLE "record_history" ALTER COLUMN "previous_mark" DROP NOT NULL;
ALTER TABLE "record_history" ALTER COLUMN "previous_mark_sortable" DROP NOT NULL;
ALTER TABLE "record_history" ALTER COLUMN "new_mark" DROP NOT NULL;

-- 'created' | 'broken' | 'edited' | 'deleted' | 'reverted' | 'carried_over'
ALTER TABLE "record_history" ADD COLUMN IF NOT EXISTS "change_kind" text;
ALTER TABLE "record_history" ADD COLUMN IF NOT EXISTS "record_set_id" uuid;
-- The whole record (and its splits) before and after. NULL before = it was
-- created; NULL after = it was deleted. Reverting puts "before" back.
ALTER TABLE "record_history" ADD COLUMN IF NOT EXISTS "before_json" jsonb;
ALTER TABLE "record_history" ADD COLUMN IF NOT EXISTS "after_json" jsonb;
ALTER TABLE "record_history" ADD COLUMN IF NOT EXISTS "reverted_from_id" uuid REFERENCES "public"."record_history"("id");
ALTER TABLE "record_history" ADD COLUMN IF NOT EXISTS "desktop_key_id" uuid;
-- An admin's email, or "desk: <meet name>" for a pushed change.
ALTER TABLE "record_history" ADD COLUMN IF NOT EXISTS "changed_by" text;
CREATE INDEX IF NOT EXISTS "idx_record_history_set" ON "record_history" USING btree ("record_set_id", "created_at");

-- ── Cross country events ──────────────────────────────────────────────────
-- Keyed by distance. The course pins the distance for a course record; the
-- code is what lets a state or meet set hold a "6K" without a course.
INSERT INTO "event_definitions"
  ("id","name","short_name","event_type","category","ind_rel","distance","units","venue_filter","sort_order","is_wind_affected","lower_is_better","mark_format","event_code")
VALUES
  ('XC-2MI',  '2 Mile XC', '2 Mi', 'cross_country','XC','I', 3218.69,'M','outdoor',900,false,true,'time','XC-2MI'),
  ('XC-4000', '4K XC',     '4K',   'cross_country','XC','I', 4000,   'M','outdoor',901,false,true,'time','XC-4000'),
  ('XC-3MI',  '3 Mile XC', '3 Mi', 'cross_country','XC','I', 4828.03,'M','outdoor',902,false,true,'time','XC-3MI'),
  ('XC-5000', '5K XC',     '5K',   'cross_country','XC','I', 5000,   'M','outdoor',903,false,true,'time','XC-5000'),
  ('XC-6000', '6K XC',     '6K',   'cross_country','XC','I', 6000,   'M','outdoor',904,false,true,'time','XC-6000'),
  ('XC-8000', '8K XC',     '8K',   'cross_country','XC','I', 8000,   'M','outdoor',905,false,true,'time','XC-8000'),
  ('XC-10000','10K XC',    '10K',  'cross_country','XC','I', 10000,  'M','outdoor',906,false,true,'time','XC-10000')
ON CONFLICT ("id") DO NOTHING;

-- ── Closed to the public API, like every other table ──────────────────────
-- See lock_down_public_tables.sql: row level security on, no policies, and
-- the API roles have no grants. The app reads through DATABASE_URL.
ALTER TABLE "venues" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "courses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "meet_series" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "record_splits" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "course_rating_log" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "venues", "courses", "meet_series", "record_splits", "course_rating_log" FROM anon, authenticated;

COMMIT;
