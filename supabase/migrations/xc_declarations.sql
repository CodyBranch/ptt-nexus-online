-- Cross country declarations: the coach portal's own tables.
--
-- Written by hand rather than generated. This database has no drizzle
-- migration history, so `drizzle-kit generate` emits a full baseline that
-- would try to create every table that is already there. This is the delta,
-- and only the delta.
--
-- Run it against the database before publishing a meet for coaches.

CREATE TABLE IF NOT EXISTS "meet_declaration_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "meet_token" text NOT NULL,
  "meet_name" text NOT NULL,
  "meet_date" text,
  "races_json" text DEFAULT '[]' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  CONSTRAINT "meet_declaration_sessions_meet_token_unique" UNIQUE("meet_token")
);

CREATE TABLE IF NOT EXISTS "team_declaration_access" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "meet_session_id" uuid NOT NULL,
  "team_token" text NOT NULL,
  "team_id" text NOT NULL,
  "team_name" text NOT NULL,
  "roster_json" text DEFAULT '[]' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now(),
  CONSTRAINT "team_declaration_access_team_token_unique" UNIQUE("team_token")
);

CREATE TABLE IF NOT EXISTS "declaration_submissions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "team_access_id" uuid NOT NULL,
  "meet_session_id" uuid NOT NULL,
  "athlete_id" text NOT NULL,
  "status" text NOT NULL,
  "race_id" text,
  "updated_at" timestamp with time zone DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE "team_declaration_access"
    ADD CONSTRAINT "team_declaration_access_meet_session_id_fk"
    FOREIGN KEY ("meet_session_id")
    REFERENCES "public"."meet_declaration_sessions"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "declaration_submissions"
    ADD CONSTRAINT "declaration_submissions_team_access_id_fk"
    FOREIGN KEY ("team_access_id")
    REFERENCES "public"."team_declaration_access"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "idx_decl_sessions_token"
  ON "meet_declaration_sessions" USING btree ("meet_token");
CREATE INDEX IF NOT EXISTS "idx_decl_team_session"
  ON "team_declaration_access" USING btree ("meet_session_id");
CREATE INDEX IF NOT EXISTS "idx_decl_team_token"
  ON "team_declaration_access" USING btree ("team_token");
CREATE INDEX IF NOT EXISTS "idx_decl_sub_team"
  ON "declaration_submissions" USING btree ("team_access_id");
CREATE INDEX IF NOT EXISTS "idx_decl_sub_session"
  ON "declaration_submissions" USING btree ("meet_session_id");

-- One answer per runner per school: a coach changing their mind updates the
-- row rather than adding a second one, which is what makes the save
-- idempotent and the sync back unambiguous.
CREATE UNIQUE INDEX IF NOT EXISTS "idx_decl_sub_athlete"
  ON "declaration_submissions" USING btree ("team_access_id","athlete_id");
