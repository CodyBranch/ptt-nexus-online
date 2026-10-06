-- Cross country declarations: bibs handed back for scratched runners.
--
-- A coach scratches a runner on the portal and hands the bib in at the desk.
-- The bib is scanned there (RaceResult TagTool calls the returns link with
-- the bib) or typed in, and the scratch is confirmed by the bib being back -
-- the one thing that stops it being run by somebody else.
--
-- Every scan is kept, whatever it matched: a bib for a runner who is not
-- scratched, or one on nobody's roster, is staff's to look at, and a scan
-- undone keeps its row with undone_at set.
--
-- Hand-written, like the other deltas here: run it once, by hand.

ALTER TABLE meet_declaration_sessions
  ADD COLUMN IF NOT EXISTS returns_token text UNIQUE;

CREATE TABLE IF NOT EXISTS declaration_bib_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meet_session_id uuid NOT NULL REFERENCES meet_declaration_sessions(id) ON DELETE CASCADE,
  -- The runner the bib belongs to, when it is on a roster.
  team_access_id uuid REFERENCES team_declaration_access(id) ON DELETE SET NULL,
  athlete_id text,
  -- What was scanned or typed: a bib, or one of the runner's other tags
  -- (bib 101 can carry tag 10101) - and the bib it turned out to be.
  code text NOT NULL,
  bib text,
  -- 'returned': a scratched runner's bib, back.
  -- 'not_scratched': the runner has not been scratched - for staff to decide.
  -- 'unknown_bib': no bib or tag in this meet.
  -- 'ambiguous': a code on more than one runner - for staff to decide.
  status text NOT NULL,
  via text NOT NULL DEFAULT 'scan',          -- 'scan' | 'manual'
  device text,                               -- what the scanner said it was, if anything
  created_at timestamptz DEFAULT now(),
  undone_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_bib_returns_session ON declaration_bib_returns(meet_session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_bib_returns_athlete ON declaration_bib_returns(team_access_id, athlete_id);
