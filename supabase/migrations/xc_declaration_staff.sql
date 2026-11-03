-- A school's staff for the packet table (desk schema 64, 2026-11-02).
--
-- The desk sends each school's coaches and staff with the portal: names, and
-- each person's roles with the side of the field each covers ("Head Coach",
-- 'F'), and whether the state association approved them. No phones or
-- emails. The packet table offers the staff who cover a packet's side and
-- marks anyone else "not on the staff list".
--
-- Run it BEFORE the deploy that reads it: drizzle selects every column, so
-- the pages would fail on a table without it.

ALTER TABLE "team_declaration_access" ADD COLUMN IF NOT EXISTS "staff_json" text NOT NULL DEFAULT '[]';

-- Staff checked in at the packet table: a coach pass (or another credential)
-- handed to one of the school's staff, by name, so the table can count how
-- many have gone out. staff_id is the desk's id for someone on the staff
-- list; a walk-up not on it has only a name. item names what was handed
-- over ('Coach pass'), so a wristband or a parking pass is a row, not a
-- column. One live row per person and item; Undo marks it undone.
CREATE TABLE IF NOT EXISTS declaration_staff_checkins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meet_session_id uuid NOT NULL REFERENCES meet_declaration_sessions(id) ON DELETE CASCADE,
  team_access_id uuid NOT NULL REFERENCES team_declaration_access(id) ON DELETE CASCADE,
  staff_id text,
  name text NOT NULL,
  item text NOT NULL DEFAULT 'Coach pass',
  device text,
  created_at timestamptz DEFAULT now(),
  undone_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_staff_checkins_session ON declaration_staff_checkins (meet_session_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_checkins_person ON declaration_staff_checkins (team_access_id, lower(name), item)
  WHERE undone_at IS NULL;

ALTER TABLE declaration_staff_checkins ENABLE ROW LEVEL SECURITY;
