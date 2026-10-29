-- Cross country declarations: the meet's tablet code.
--
-- The PTT Nexus Tablet app scans one code per meet on the desk
-- (/declare/kiosk/{token}) and trades it at /api/declare/kiosk/{token} for
-- the live dashboard, the clerks' page and every school's coach form.
--
-- Its own token: it opens every coach form, so it is shown on the desk
-- only and never printed. Made on publish, and on the next update of a
-- session from before it.
--
-- Hand-written, like the other deltas here: run it once, by hand.

ALTER TABLE meet_declaration_sessions
  ADD COLUMN IF NOT EXISTS kiosk_token text UNIQUE;
