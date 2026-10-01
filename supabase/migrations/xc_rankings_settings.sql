-- Switches for the USTFCCCA rankings reader.
--
-- Hand-written and additive. One row per setting; the only one so far is
-- 'auto_pull', which is whether the daily read runs. Off once the season is
-- over (the final polls are out and nothing changes until August), back on
-- for the preseason poll. "Pull now" on the dashboard works either way.
--
-- The Vercel cron still calls the route every day; with this off the route
-- answers without asking the USTFCCCA anything.

BEGIN;

CREATE TABLE IF NOT EXISTS "ranking_settings" (
  "key" text PRIMARY KEY NOT NULL,
  "value" text NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now(),
  "updated_by" text
);

ALTER TABLE "ranking_settings" ENABLE ROW LEVEL SECURITY;

COMMIT;
