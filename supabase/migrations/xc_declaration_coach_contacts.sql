-- Cross country declarations: coaches signing up for the meet's texts.
--
-- The meet sends one link to every coach (/declare/coaches/{token}). A coach
-- picks their school and leaves their name, role, email and mobile, agreeing
-- to the meet's texts; a text back confirms it. The desk pulls the sign-ups
-- into its own list of each school's coaches and sends the announcements
-- from there (weather, schedule changes, declaration reminders).
--
-- The token is its own, like the dashboard's and the returns desk's: handed
-- to every coach, it must not open anything else.
--
-- Hand-written, like the other deltas here: run it once, by hand.

ALTER TABLE meet_declaration_sessions
  ADD COLUMN IF NOT EXISTS contacts_token text UNIQUE;

CREATE TABLE IF NOT EXISTS declaration_coach_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meet_session_id uuid NOT NULL REFERENCES meet_declaration_sessions(id) ON DELETE CASCADE,
  team_access_id uuid NOT NULL REFERENCES team_declaration_access(id) ON DELETE CASCADE,
  name text NOT NULL,
  role text,
  email text NOT NULL,
  -- E.164 (+15551234567)
  phone text NOT NULL,
  -- The words the coach agreed to, as shown, and when: the record a carrier
  -- asks for.
  consent_text text NOT NULL,
  opted_in_at timestamptz NOT NULL DEFAULT now(),
  -- The confirming text: 'sent', 'failed', 'opted_out' (STOP earlier), or
  -- 'not_configured' (no texting account on this server).
  confirm_status text,
  confirm_id text,
  confirm_error text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Signing up again with the same mobile for the same school updates the one
-- sign-up rather than adding a second.
CREATE UNIQUE INDEX IF NOT EXISTS idx_coach_contacts_team_phone ON declaration_coach_contacts(team_access_id, phone);
CREATE INDEX IF NOT EXISTS idx_coach_contacts_session ON declaration_coach_contacts(meet_session_id);

ALTER TABLE declaration_coach_contacts ENABLE ROW LEVEL SECURITY;
