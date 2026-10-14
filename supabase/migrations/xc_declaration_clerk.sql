-- Cross country declarations: the clerks' page.
--
-- A read-only page for clerks and line clerks (/declare/clerk/{token}), on a
-- phone or tablet: every race, each school's start box, and every runner's
-- bib and status - declared, not declared, checked in, scratched, DNS.
--
-- The desk is the truth for that (a scratch at the tent, a check-in, a box
-- moved on race morning), so the desk sends the whole picture with its pull
-- each minute when it has changed, and it is kept here as it came.
--
-- Its own token, like the dashboard's: it is handed to officials, not
-- coaches, and opens nothing else.
--
-- Hand-written, like the other deltas here: run it once, by hand.

ALTER TABLE meet_declaration_sessions
  ADD COLUMN IF NOT EXISTS clerk_token text UNIQUE,
  ADD COLUMN IF NOT EXISTS clerk_json text,
  ADD COLUMN IF NOT EXISTS clerk_updated_at timestamptz;
