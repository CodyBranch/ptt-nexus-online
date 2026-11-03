-- A practice run at the packet table (2026-11-03): test the scanners, the
-- sign-off tablet and coach passes against the real meet, then throw the test
-- away.
--
-- While a session's pickup_practice_at is set, every pickup and coach pass is
-- written with practice = true, and the table shows only those. The desk never
-- pulls them. Ending the practice run deletes them and clears the column.
--
-- Run AFTER xc_declaration_staff.sql (it alters that file's table), and BEFORE
-- the deploy that reads it: drizzle selects every column.

ALTER TABLE "meet_declaration_sessions" ADD COLUMN IF NOT EXISTS "pickup_practice_at" timestamptz;

ALTER TABLE "declaration_packet_pickups" ADD COLUMN IF NOT EXISTS "practice" boolean NOT NULL DEFAULT false;
DROP INDEX IF EXISTS idx_packet_pickups_team;
CREATE UNIQUE INDEX IF NOT EXISTS idx_packet_pickups_team ON declaration_packet_pickups (team_access_id, side, practice)
  WHERE undone_at IS NULL;

ALTER TABLE "declaration_staff_checkins" ADD COLUMN IF NOT EXISTS "practice" boolean NOT NULL DEFAULT false;
DROP INDEX IF EXISTS idx_staff_checkins_person;
CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_checkins_person ON declaration_staff_checkins (team_access_id, lower(name), item, practice)
  WHERE undone_at IS NULL;
