-- Pickup items at the packet table (2026-11-03): besides its packets, a
-- school picks up a count of the meet's other items - hats, water bottles, a
-- banner - at one grouped station or at a station per item.
--
-- The meet's items are a JSON list on the session, set on the packet table's
-- page: { id, name, count, per } with per 'team' (each side of the field),
-- 'runner' or 'school'. Each hand-over is a row: the count given, who took
-- it and when, at which station. A short count topped up later is a second
-- row. Undo marks a row undone; a practice run's rows are deleted when it ends.
--
-- Run AFTER xc_packet_pickup_practice.sql, and BEFORE the deploy that reads
-- it: drizzle selects every column.

ALTER TABLE "meet_declaration_sessions" ADD COLUMN IF NOT EXISTS "pickup_items_json" text NOT NULL DEFAULT '[]';

CREATE TABLE IF NOT EXISTS declaration_item_pickups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meet_session_id uuid NOT NULL REFERENCES meet_declaration_sessions(id) ON DELETE CASCADE,
  team_access_id uuid NOT NULL REFERENCES team_declaration_access(id) ON DELETE CASCADE,
  item_id text NOT NULL,
  item_name text NOT NULL,
  side text NOT NULL,
  count integer NOT NULL,
  picked_up_by text,
  device text,
  created_at timestamptz DEFAULT now(),
  undone_at timestamptz,
  practice boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_item_pickups_session ON declaration_item_pickups (meet_session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_item_pickups_team ON declaration_item_pickups (team_access_id, item_id);

ALTER TABLE declaration_item_pickups ENABLE ROW LEVEL SECURITY;
