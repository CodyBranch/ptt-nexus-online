-- Schools a meet met that the org database does not have.
--
-- Written by hand rather than generated, for the same reason the
-- declarations migration was: this database has no drizzle migration
-- history, so `drizzle-kit generate` emits a full baseline that would try to
-- create every table already there. This is the delta, and only the delta.
--
-- Nothing here touches `organizations`. A submission is a school somebody
-- has yet to look at; approving one is what creates the organisation, and
-- that happens through the API rather than in SQL.

CREATE TABLE IF NOT EXISTS "organization_submissions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,

  -- What the meet knew.
  "name" text NOT NULL,
  -- Lower case, punctuation stripped: what "seen this one already" means.
  "name_key" text NOT NULL,
  "abbreviation" text,
  "organization_type" text NOT NULL,
  "city" text,
  "state" text,

  -- Where it came from, so a reviewer can go and look.
  "meet_name" text,
  "meet_date" date,
  "athlete_count" integer,

  -- pending | approved | rejected
  "status" text DEFAULT 'pending' NOT NULL,
  -- The organisation an approval created, so the decision is traceable.
  "organization_id" uuid REFERENCES "organizations"("id") ON DELETE SET NULL,
  "review_note" text,

  -- How many times it has been pushed, across every meet.
  "times_seen" integer DEFAULT 1 NOT NULL,
  "first_seen_at" timestamp with time zone DEFAULT now(),
  "last_seen_at" timestamp with time zone DEFAULT now(),
  "reviewed_at" timestamp with time zone
);

-- One row per school per level, however many meets ask for it. Fourteen
-- races at one meet all wanting the same school is one thing to review.
CREATE UNIQUE INDEX IF NOT EXISTS "idx_org_subs_key"
  ON "organization_submissions" ("name_key", "organization_type");
CREATE INDEX IF NOT EXISTS "idx_org_subs_status"
  ON "organization_submissions" ("status");
CREATE INDEX IF NOT EXISTS "idx_org_subs_seen"
  ON "organization_submissions" ("last_seen_at");
