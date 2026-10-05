-- Cross country declarations: the live dashboard.
--
-- A dashboard for a meet's declarations, open to anyone holding its link and
-- to nobody else, the way the coach links work: possession is the key. It is
-- a token of its own, not the meet token, so it can be handed to a meet
-- director or put on a screen without handing out what the desk publishes
-- with.
--
-- And each school's Nexus Online organization, when the desk knows it, so the
-- dashboard can show the school's logo and colors and its runners' headshots.
--
-- Hand-written, like the other deltas here: run it once, by hand.

ALTER TABLE meet_declaration_sessions
  ADD COLUMN IF NOT EXISTS dashboard_token text UNIQUE;

ALTER TABLE team_declaration_access
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL;

-- When each school first opened its form, and most recently: the dashboard
-- tells a school that never opened its link from one that opened it and has
-- not answered yet.
ALTER TABLE team_declaration_access
  ADD COLUMN IF NOT EXISTS opened_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_opened_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_decl_sessions_dashboard ON meet_declaration_sessions(dashboard_token);
