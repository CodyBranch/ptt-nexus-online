-- Cross country declarations: whether each school's declaration form asks
-- the coach to sign up for the meet's texts (a card at the top of the form,
-- linking to the meet's coach sign-up with the school picked).
--
-- Set by the desk when it publishes or updates the portal. On by default, so
-- a portal published before this asks too once it has a sign-up link.
--
-- Hand-written, like the other deltas here: run it once, by hand.

ALTER TABLE meet_declaration_sessions
  ADD COLUMN IF NOT EXISTS text_signup boolean NOT NULL DEFAULT true;
