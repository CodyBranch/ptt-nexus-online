-- Cross country declarations: packet pickup.
--
-- The packet table (/declare/pickup/{token}) scans the code on each school's
-- team label (NXPKT-<desk team id>-<F|M|A>) or marks a packet by hand, and
-- can ask who took it and for their signature, on its own screen or on a
-- sign-off tablet facing the coach. The desk pulls the pickups with its
-- answers.
--
-- Its own token, like the bib returns': it writes, so it is never the
-- dashboard's. Made on publish, and on the next update of an older session.
--
-- Hand-written, like the other deltas here: run it once, by hand.

ALTER TABLE meet_declaration_sessions
  ADD COLUMN IF NOT EXISTS pickup_token text UNIQUE;

CREATE TABLE IF NOT EXISTS declaration_packet_pickups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meet_session_id uuid NOT NULL REFERENCES meet_declaration_sessions(id) ON DELETE CASCADE,
  team_access_id uuid NOT NULL REFERENCES team_declaration_access(id) ON DELETE CASCADE,
  side text NOT NULL,
  status text NOT NULL,
  picked_up_by text,
  signature text,
  via text NOT NULL DEFAULT 'scan',
  device text,
  created_at timestamptz DEFAULT now(),
  signed_at timestamptz,
  undone_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_packet_pickups_session ON declaration_packet_pickups (meet_session_id, created_at);
-- One live pickup per packet: two stations scanning the same label at the
-- same moment make one row, and the second is told it was already picked up.
CREATE UNIQUE INDEX IF NOT EXISTS idx_packet_pickups_team ON declaration_packet_pickups (team_access_id, side)
  WHERE undone_at IS NULL;

-- Supabase: like the other declaration tables, reached only through the
-- server's own connection.
ALTER TABLE declaration_packet_pickups ENABLE ROW LEVEL SECURITY;
